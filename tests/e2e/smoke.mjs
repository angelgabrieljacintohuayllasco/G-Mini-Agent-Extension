/**
 * Prueba de humo de extremo a extremo.
 *
 *   CHROME_PATH=<Chrome for Testing o Chromium> npm run test:e2e
 *   CHROME_PATH=... GMINI_CORE_DIR=<repo G-Mini-Agent> npm run test:e2e -- --core=real
 *
 * Carga dist/chromium en un Chromium sin interfaz con un perfil temporal, lo
 * conecta a un núcleo en un puerto libre (nunca el 8765 de la app abierta) y
 * recorre los comandos del protocolo, el popup y la página de opciones.
 *
 *   --core=mock  núcleo simulado en Node (por defecto, no necesita Python)
 *   --core=real  núcleo real de G-Mini Agent: las acciones pasan por
 *                POST /api/actions/execute -> planner -> ExtensionBridge
 *
 * Chrome estable 137+ ignora --load-extension: usa Chrome for Testing o Chromium.
 * Las capturas quedan en tests/e2e/.output/.
 */
import { once } from 'node:events';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { WebSocket } from 'ws';
import { startMockCore } from './mock-core.mjs';
import { startRealCore } from './real-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUT = path.join(ROOT, 'tests', 'e2e', '.output');
const FIXTURES = path.join(ROOT, 'tests', 'e2e', 'fixtures');
const DEFAULT_SERVER_URL = 'ws://127.0.0.1:8765/ws/extension';

const mode = (process.argv.find((arg) => arg.startsWith('--core=')) ?? '--core=mock').slice('--core='.length);
const results = [];

// ---------------------------------------------------------------- utilidades

class SkipStep extends Error {}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function expectEqual(actual, expected, label) {
  expect(actual === expected, `${label}: se esperaba ${JSON.stringify(expected)} y llegó ${JSON.stringify(actual)}`);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: sin respuesta en ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function step(name, run) {
  const startedAt = Date.now();
  try {
    const detail = await run();
    results.push({ name, status: 'OK', detail: detail ?? '', ms: Date.now() - startedAt });
  } catch (error) {
    const status = error instanceof SkipStep ? 'OMITIDA' : 'FALLA';
    results.push({ name, status, detail: error.message, ms: Date.now() - startedAt });
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startFixtureServer() {
  const server = http.createServer(async (request, response) => {
    const name = path.basename(new URL(request.url, 'http://x').pathname);
    try {
      const body = await readFile(path.join(FIXTURES, name));
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    } catch {
      response.writeHead(404).end('no encontrado');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close() {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      return closed;
    },
  };
}

/** Copia dist/chromium apuntando al puerto de prueba en lugar del 8765. */
async function prepareExtension(serverUrl) {
  const source = path.join(ROOT, 'dist', 'chromium');
  const target = path.join(OUTPUT, `extension-${mode}`);
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
  let replacements = 0;
  for (const file of await readdir(target)) {
    if (file.endsWith('.js') || file.endsWith('.html')) {
      const text = await readFile(path.join(target, file), 'utf8');
      replacements += text.split(DEFAULT_SERVER_URL).length - 1;
      await writeFile(path.join(target, file), text.replaceAll(DEFAULT_SERVER_URL, serverUrl));
    }
  }
  expect(replacements > 0, 'no se encontró la dirección por defecto en dist/chromium: ejecuta npm run build');
  return target;
}

// ------------------------------------------------- acciones del agente

// Traducción acción del agente -> comando del bridge, como BrowserController.
const ACTION_TO_COMMAND = {
  browser_navigate: (p) => ['navigate', { url: p.url }],
  browser_click: (p) => ['click', { selector: p.selector, force: Boolean(p.force) }],
  browser_type: (p) => ['type', { selector: p.selector, text: p.text, clear: p.clear ?? true }],
  browser_fill: (p) => ['fill', { selector: p.selector, text: p.text }],
  browser_press: (p) => ['press', { key: p.key }],
  browser_scroll: (p) => ['scroll', { direction: p.direction ?? 'down', amount: p.amount ?? 3 }],
  browser_hover: (p) => ['hover', { selector: p.selector }],
  browser_select: (p) => ['select', { selector: p.selector, value: p.value }],
  browser_wait_for: (p) => ['wait_for', { selector: p.selector, timeout_ms: p.timeout_ms ?? 15000, state: p.state ?? 'visible' }],
  browser_wait_load: () => ['wait_load', { timeout_ms: 30000 }],
  browser_go_back: () => ['go_back', {}],
  browser_go_forward: () => ['go_forward', {}],
  browser_remove_overlays: () => ['remove_overlays', {}],
  browser_extract: (p) => ['extract', { selector: p.selector ?? 'body' }],
  browser_snapshot: () => ['snapshot', {}],
  browser_eval: (p) => ['eval', { script: p.script }],
  browser_screenshot: () => ['screenshot', {}],
  browser_page_info: () => ['page_info', {}],
  browser_tabs: () => ['tabs_list', {}],
  browser_switch_tab: (p) => ['tab_switch', { index: p.index }],
  browser_new_tab: (p) => ['tab_new', { url: p.url || 'about:blank' }],
  browser_close_tab: (p) => ['tab_close', p.index === undefined ? {} : { index: p.index }],
};

function commandTimeout(command, params) {
  if (command === 'wait_for' || command === 'wait_load') {
    return params.timeout_ms + 2000;
  }
  return command === 'screenshot' ? 10000 : 15000;
}

function createMockDriver(getCore) {
  return {
    async act(action, params = {}) {
      const [command, commandParams] = ACTION_TO_COMMAND[action](params);
      return getCore().sendCommand(command, commandParams, commandTimeout(command, commandParams));
    },
  };
}

function createRealDriver(core) {
  return {
    async act(action, params = {}) {
      // Sin extensión, el núcleo intentaría browser-use o abrir Chrome: no se envía nada.
      expect(core.isConnected(), 'la extensión no está conectada al núcleo');
      const response = await core.execute(action, params);
      if (response.policy_blocked) {
        throw new SkipStep(`la política del núcleo la bloquea: ${response.policy_reason}`);
      }
      expect(response.success, `el planner respondió success=false: ${response.error ?? response.result?.message ?? ''}`);
      return response.result?.data;
    },
  };
}

function protocolScenario(driver, fixture) {
  const act = (action, params) => driver.act(action, params);
  const textOf = async (selector) => (await act('browser_extract', { selector })).text;
  return [
    ['navegar a una página', async () => {
      const data = await act('browser_navigate', { url: fixture('form.html') });
      expect(data.success, data.error);
      expectEqual(data.title, 'Formulario G-Mini', 'title');
      return data.url;
    }],
    ['esperar un elemento que aparece tarde', async () => {
      const data = await act('browser_wait_for', { selector: '#later', timeout_ms: 5000, state: 'visible' });
      expect(data.success, data.error);
      return `${data.waited_ms} ms`;
    }],
    ['escribir en un input (eventos input)', async () => {
      const data = await act('browser_type', { selector: '#name', text: 'Ada Lovelace' });
      expectEqual(data.typed, 12, 'typed');
      expectEqual(await textOf('#echo-name'), 'Ada Lovelace', 'eco del input');
    }],
    ['rellenar un textarea', async () => {
      const data = await act('browser_fill', { selector: '#bio', text: 'Matemática' });
      expectEqual(data.filled, 10, 'filled');
      expectEqual(await textOf('#echo-bio'), 'Matemática', 'eco del textarea');
    }],
    ['rellenar un editor contenteditable', async () => {
      await act('browser_fill', { selector: '#editor', text: 'Hola editor' });
      expectEqual(await textOf('#editor'), 'Hola editor', 'texto del editor');
    }],
    ['seleccionar una opción por su etiqueta', async () => {
      const data = await act('browser_select', { selector: '#color', value: 'Azul' });
      expectEqual(data.selectedValue, 'blue', 'selectedValue');
    }],
    ['clic en un botón', async () => {
      const data = await act('browser_click', { selector: '#counter-button' });
      expectEqual(data.tag, 'BUTTON', 'tag');
      expectEqual(await textOf('#counter'), '1', 'contador');
    }],
    ['pasar el cursor', async () => {
      await act('browser_hover', { selector: '#hover-target' });
      expectEqual(await textOf('#hover-state'), 'hover', 'estado hover');
    }],
    ['Enter envía el formulario', async () => {
      await act('browser_click', { selector: '#name' });
      const data = await act('browser_press', { key: 'enter' });
      expectEqual(data.key, 'Enter', 'key');
      expectEqual(await textOf('#submitted'), 'yes', 'formulario enviado');
    }],
    ['desplazar la página', async () => {
      const data = await act('browser_scroll', { direction: 'down', amount: 2 });
      expect(data.scrollY > 0, `scrollY=${data.scrollY}`);
      return `scrollY=${data.scrollY}`;
    }],
    ['quitar superposiciones', async () => {
      const data = await act('browser_remove_overlays');
      expect(data.removed_elements >= 1, `removed_elements=${data.removed_elements}`);
      return `${data.removed_elements} elementos`;
    }],
    ['page_info mide la ventana sin eval', async () => {
      const data = await act('browser_page_info');
      expect(data.viewport.width > 0 && data.viewport.height > 0, `viewport=${JSON.stringify(data.viewport)}`);
      return `${data.viewport.width}x${data.viewport.height}`;
    }],
    ['instantánea de la página', async () => {
      const data = await act('browser_snapshot');
      expect(data.text.includes('Formulario de prueba'), 'el texto no incluye el título');
      return `${data.text.length} caracteres`;
    }],
    ['captura de pantalla', async () => {
      const data = await act('browser_screenshot');
      expect(data.success, data.error);
      expect(data.image_base64.startsWith('iVBORw0KGgo'), 'no es un PNG en base64');
      expect(data.url.endsWith('/form.html'), 'falta la URL');
      return `${Math.round((data.image_base64.length * 3) / 4 / 1024)} KB`;
    }],
    ['eval (mecanismo original, informativo)', async () => {
      const data = await act('browser_eval', { script: 'return document.title' });
      if (data.success) {
        expectEqual(data.result, 'Formulario G-Mini', 'result');
        return 'el navegador permitió new Function en el content script';
      }
      expect(/^Eval error: /.test(data.error), `error inesperado: ${data.error}`);
      return `bloqueado por el navegador, como con la extensión anterior: ${data.error.slice(0, 90)}`;
    }],
    ['listar pestañas (count)', async () => {
      const data = await act('browser_tabs');
      expect(data.count === data.tabs.length && data.count >= 1, `count=${data.count}`);
      return `${data.count} pestañas`;
    }],
    ['abrir, cambiar y cerrar pestañas', async () => {
      const before = (await act('browser_tabs')).count;
      const created = await act('browser_new_tab', { url: fixture('second.html') });
      expect(created.url.endsWith('/second.html'), `url=${created.url}`);
      expectEqual((await act('browser_tabs')).count, before + 1, 'pestañas tras abrir');
      const switched = await act('browser_switch_tab', { index: before });
      expect(switched.url.endsWith('/second.html'), `url=${switched.url}`);
      const closed = await act('browser_close_tab', { index: before });
      expectEqual(closed.remaining_tabs, before, 'remaining_tabs');
      await act('browser_switch_tab', { index: 0 });
      return `remaining_tabs=${closed.remaining_tabs}`;
    }],
    ['historial: atrás y adelante', async () => {
      const second = await act('browser_navigate', { url: fixture('second.html') });
      expect(second.success, `navegar: ${second.error}`);
      // Las páginas que abre el agente no reciben interacción real del usuario:
      // Chromium las omite en tabs.goBack y la extensión recurre a history.back().
      const back = await act('browser_go_back');
      expect(back.success, `atrás: ${back.error}`);
      expect(back.url.endsWith('/form.html'), `atrás: ${back.url}`);
      const forward = await act('browser_go_forward');
      expect(forward.success, `adelante: ${forward.error}`);
      expect(forward.url.endsWith('/second.html'), `adelante: ${forward.url}`);
      await act('browser_go_back');
    }],
    ['esperar la carga', async () => {
      const data = await act('browser_wait_load');
      expectEqual(data.status, 'complete', 'status');
    }],
  ];
}

function mockOnlyScenario(getCore, fixture) {
  const core = () => getCore();
  return [
    ['ext:ping del núcleo recibe ext:pong', async () => {
      const pong = once(core().events, 'ext:pong');
      core().sendRaw({ event: 'ext:ping', data: { ts: Date.now() } });
      const [data] = await withTimeout(pong, 3000, 'ext:pong');
      expect(typeof data.ts === 'number', 'pong sin ts');
    }],
    ['get_dom', async () => {
      await core().bridge.navigate(fixture('form.html'));
      const data = await core().bridge.get_dom('#form', 4, 5000);
      expect(data.html.includes('<input id="name" name="name">'), data.html.slice(0, 120));
      return `${data.html.length} caracteres`;
    }],
    ['downloads_list', async () => {
      const data = await core().bridge.list_downloads(5);
      expect(data.success && Array.isArray(data.downloads), JSON.stringify(data).slice(0, 120));
      return `${data.count} descargas`;
    }],
    ['comando desconocido', async () => {
      const data = await core().sendCommand('format_disk', {});
      expectEqual(data.error, 'Unknown command: format_disk', 'error');
    }],
    ['parámetros inválidos', async () => {
      const data = await core().sendCommand('click', {});
      expect(!data.success && /'selector' is required/.test(data.error), data.error);
    }],
    ['navigate no acepta javascript:', async () => {
      const data = await core().sendCommand('navigate', { url: 'javascript:alert(1)' });
      expectEqual(data.error, 'Blocked URL scheme: javascript', 'error');
    }],
  ];
}

// ------------------------------------------------------------------ interfaz

async function statusLabel(page) {
  return page.$eval('#status-label', (element) => element.textContent);
}

async function waitForLabel(page, label, timeout = 15000) {
  await page.waitForFunction((expected) => document.getElementById('status-label')?.textContent === expected, { timeout }, label);
}

async function capture(page, name, scheme) {
  // Las capturas sirven para la documentación: los campos muestran la
  // dirección por defecto en lugar del puerto aleatorio de la prueba (no se guarda).
  await page.evaluate((defaultUrl) => {
    const serverInput = document.getElementById('server-url');
    const portInput = document.getElementById('port-input');
    if (serverInput && !serverInput.value.includes('example.com')) {
      serverInput.value = defaultUrl;
    }
    if (portInput) {
      portInput.value = new URL(defaultUrl).port;
    }
  }, DEFAULT_SERVER_URL);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await page.screenshot({ path: path.join(OUTPUT, `${name}-${scheme}.png`), fullPage: true });
}

async function openExtensionPage(browser, extensionId, file, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(`chrome-extension://${extensionId}/${file}`);
  return page;
}

// ---------------------------------------------------------------- ejecución

async function main() {
  expect(['mock', 'real'].includes(mode), `--core debe ser mock o real, no "${mode}"`);
  expect(process.env.CHROME_PATH, 'define CHROME_PATH con la ruta de Chrome for Testing o Chromium');
  await mkdir(OUTPUT, { recursive: true });

  const workerLog = [];
  let fixtures;
  let core;
  let browser;
  try {
    fixtures = await startFixtureServer();
    const fixture = (name) => `${fixtures.base}/${name}`;
    const port = await freePort();
    const serverUrl = `ws://127.0.0.1:${port}/ws/extension`;

    if (mode === 'real') {
      expect(process.env.GMINI_CORE_DIR, 'define GMINI_CORE_DIR con la ruta del repositorio G-Mini-Agent');
      core = await startRealCore({ coreDir: process.env.GMINI_CORE_DIR, python: process.env.GMINI_CORE_PYTHON, port, workDir: OUTPUT });
      console.log(`Núcleo real ${core.health.version} en 127.0.0.1:${port} (GMINI_HOME=${core.home})`);
    } else {
      core = await startMockCore({ port });
      console.log(`Núcleo simulado en 127.0.0.1:${port}`);
    }

    const extensionDir = await prepareExtension(serverUrl);
    const connection = once(core.events, mode === 'real' ? 'hello' : 'ext:hello');
    const handshake = once(core.events, 'connected');
    const keepalive = mode === 'mock' ? once(core.events, 'ext:ping') : null;
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH,
      headless: true,
      timeout: 30000,
      userDataDir: path.join(OUTPUT, `profile-${mode}-${Date.now()}`),
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
      defaultViewport: { width: 1280, height: 800 },
    });

    const worker = await browser.waitForTarget(
      (target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'),
      { timeout: 15000 },
    );
    const extensionId = new URL(worker.url()).host;
    (await worker.worker())?.on('console', (message) => workerLog.push(`[${message.type()}] ${message.text()}`));
    console.log(`${(await browser.version())}, extensión ${extensionId}`);

    await step('handshake ext:hello', async () => {
      const [hello] = await withTimeout(connection, 20000, 'ext:hello');
      if (mode === 'real') {
        expect(hello.includes(`extensionId=${extensionId}`), hello);
        return hello.slice(hello.indexOf('Handshake'));
      }
      expectEqual(hello.extensionId, extensionId, 'extensionId');
      expect(typeof hello.tabUrl === 'string' && typeof hello.userAgent === 'string', 'faltan campos originales');
      expectEqual(hello.extensionVersion, '1.0.0', 'extensionVersion');
      expectEqual(hello.commands.length, 24, 'comandos anunciados');
      return `${hello.browser.name} ${hello.browser.version}, build ${hello.build}`;
    });

    if (mode === 'mock') {
      await step('origen y host aceptados por el núcleo', async () => {
        const [{ origin, host }] = await handshake;
        expectEqual(origin, `chrome-extension://${extensionId}`, 'Origin');
        expectEqual(host, `127.0.0.1:${port}`, 'Host');
        return origin;
      });
    }

    const driver = mode === 'real' ? createRealDriver(core) : createMockDriver(() => core);
    // Los casos de error van primero: así la actividad del popup termina con el flujo normal.
    if (mode === 'mock') {
      for (const [name, run] of mockOnlyScenario(() => core, fixture)) {
        await step(name, run);
      }
    }
    for (const [name, run] of protocolScenario(driver, fixture)) {
      await step(name, run);
    }
    if (mode === 'mock') {
      // Antes de cualquier reconexión: el primer ping llega 20 s después de conectar.
      await step('keepalive ext:ping cada 20 s', async () => {
        await withTimeout(keepalive, 25000, 'ext:ping');
      });
    }

    const popup = await openExtensionPage(browser, extensionId, 'popup.html', { width: 360, height: 600 });
    await step('popup: estado y actividad', async () => {
      await waitForLabel(popup, 'Conectado');
      const items = await popup.$$eval('#activity-list .activity-item', (elements) => elements.length);
      expect(items > 0, 'la actividad está vacía');
      await capture(popup, 'popup-connected', 'dark');
      await capture(popup, 'popup-connected', 'light');
      return `${items} acciones en la lista`;
    });

    await step('popup: Probar conexión', async () => {
      await popup.click('#test-connection');
      await popup.waitForFunction(() => {
        const result = document.getElementById('test-result');
        return !result.hidden && result.textContent.length > 0;
      }, { timeout: 12000 });
      const message = await popup.$eval('#test-result', (element) => element.textContent);
      expect(message.startsWith('Conexión verificada'), message);
      return message;
    });

    await step('otra instancia toma la conexión y se recupera con "Conectar aquí"', async () => {
      const intruder = new WebSocket(serverUrl, { origin: 'chrome-extension://instancia-de-prueba' });
      await withTimeout(once(intruder, 'open'), 5000, 'segundo cliente');
      await waitForLabel(popup, 'Error');
      const button = await popup.$eval('#reconnect', (element) => !element.hidden && element.textContent.trim());
      expectEqual(button, 'Conectar aquí', 'botón');
      await capture(popup, 'popup-displaced', 'dark');
      await new Promise((resolve) => setTimeout(resolve, 2500));
      expectEqual(await statusLabel(popup), 'Error', 'no debe reconectar sola');
      intruder.close();
      await once(intruder, 'close');
      await popup.click('#reconnect');
      await waitForLabel(popup, 'Conectado');
    });

    await step('pausar y reanudar desde el popup', async () => {
      await popup.click('#enabled-toggle');
      await waitForLabel(popup, 'En pausa');
      await withTimeout(
        (async () => {
          while (core.isConnected()) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        })(),
        5000,
        'desconexión en el núcleo',
      );
      await capture(popup, 'popup-paused', 'light');
      await popup.click('#enabled-toggle');
      await waitForLabel(popup, 'Conectado');
    });

    if (mode === 'mock') {
      await step('reconexión con backoff tras reiniciar el núcleo', async () => {
        await core.stop();
        await waitForLabel(popup, 'Reconectando', 5000);
        await capture(popup, 'popup-reconnecting', 'dark');
        const startedAt = Date.now();
        core = await startMockCore({ port });
        await waitForLabel(popup, 'Conectado', 20000);
        return `reconectó en ${Date.now() - startedAt} ms`;
      });
    }

    const options = await openExtensionPage(browser, extensionId, 'options.html', { width: 1280, height: 900 });
    await step('opciones: estado, capturas y servidor remoto con confirmación', async () => {
      await options.waitForFunction(() => document.getElementById('status-pill-label')?.textContent === 'Conectado', { timeout: 15000 });
      await capture(options, 'options-1280', 'dark');
      await capture(options, 'options-1280', 'light');
      await options.setViewport({ width: 375, height: 900 });
      await capture(options, 'options-375', 'dark');
      await options.setViewport({ width: 1280, height: 900 });

      await options.$eval('#server-url', (input) => {
        input.value = '';
      });
      await options.type('#server-url', 'wss://agente.example.com/ws/extension');
      await options.click('#server-form button[type=submit]');
      await options.waitForFunction(() => !document.getElementById('request-remote').hidden);
      await options.click('#request-remote');
      await options.waitForFunction(() => document.getElementById('remote-dialog').open);
      await capture(options, 'options-remote-dialog', 'dark');
      await options.click('#remote-dialog button[value=cancel]');
      await options.waitForFunction(() => !document.getElementById('remote-dialog').open);
      const stored = await options.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
      expect(!stored || stored.allowRemoteServer === false, 'al cancelar no debe permitir servidores remotos');
      expect(!stored || !stored.serverUrl.includes('example.com'), 'al cancelar no debe guardar la dirección remota');
      return 'cancelar no guarda nada';
    });
  } finally {
    for (const release of [() => browser?.close(), () => core?.stop(), () => fixtures?.close()]) {
      await withTimeout(Promise.resolve().then(release), 15000, 'limpieza').catch((error) => console.warn(error.message));
    }
  }

  report(workerLog);
}

function report(workerLog) {
  console.log('');
  for (const { name, status, detail, ms } of results) {
    console.log(`${status.padEnd(7)} ${name}${detail ? ` - ${detail}` : ''} (${ms} ms)`);
  }
  const failed = results.filter((result) => result.status === 'FALLA').length;
  const skipped = results.filter((result) => result.status === 'OMITIDA').length;
  console.log(`\n${results.length - failed - skipped} OK, ${failed} FALLA, ${skipped} OMITIDA (núcleo ${mode})`);
  if (failed > 0 && workerLog.length > 0) {
    console.log('\nConsola del service worker:');
    workerLog.slice(-30).forEach((line) => console.log(`  ${line}`));
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(`Error en la prueba de humo: ${error.message}`);
  report([]);
  process.exitCode = 1;
});
