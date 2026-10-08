import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCommandHandlers } from '../../src/background/commands/index.js';
import { downloadsList } from '../../src/background/commands/downloads.js';
import { goBack, navigate } from '../../src/background/commands/navigation.js';
import { pageInfo, screenshot, snapshot } from '../../src/background/commands/page.js';
import { tabClose, tabNew, tabSwitch, tabsList } from '../../src/background/commands/tabs.js';
import { COMMAND_NAMES } from '../../src/shared/protocol.js';
import { createFakeBrowser } from './helpers/fake-browser.js';

function threeTabs() {
  return [
    { id: 1, windowId: 1, index: 0, active: false, status: 'complete', url: 'https://example.com/', title: 'Example', width: 1280, height: 720 },
    { id: 2, windowId: 1, index: 1, active: true, status: 'complete', url: 'chrome://newtab/', title: 'Nueva pestaña', width: 1280, height: 720 },
    { id: 3, windowId: 1, index: 2, active: false, status: 'complete', url: 'https://docs.example.com/', title: 'Docs', width: 1280, height: 720 },
    { id: 9, windowId: 2, index: 0, active: true, status: 'complete', url: 'https://otra-ventana.example/', title: 'Otra', width: 800, height: 600 },
  ];
}

describe('tabla de comandos', () => {
  it('hay un manejador por cada comando permitido y ninguno más', () => {
    const handlers = createCommandHandlers({});
    assert.deepEqual(Object.keys(handlers).sort(), [...COMMAND_NAMES].sort());
  });
});

describe('navegación', () => {
  it('completa el esquema, navega y espera a que cargue', async () => {
    const browser = createFakeBrowser({ tabs: threeTabs() });
    const result = await navigate(browser.api, { url: 'example.org/precios' });
    assert.deepEqual(browser.calls[0], ['tabs.update', 2, { url: 'https://example.org/precios' }]);
    assert.deepEqual(result, {
      success: true,
      url: 'https://example.org/precios',
      title: 'Título de https://example.org/precios',
      status: 'complete',
    });
    assert.equal(browser.onUpdated.size(), 0, 'los listeners temporales se retiran');
  });

  it('no navega a javascript:', async () => {
    const browser = createFakeBrowser({ tabs: threeTabs() });
    const result = await navigate(browser.api, { url: 'javascript:alert(1)' });
    assert.deepEqual(result, { success: false, error: 'Blocked URL scheme: javascript' });
    assert.equal(browser.calls.length, 0);
  });
});

describe('historial', () => {
  const PREVIOUS = 'https://example.com/anterior';

  it('go_back usa tabs.goBack cuando el navegador lo permite', async () => {
    const browser = createFakeBrowser({ tabs: threeTabs(), history: { back: PREVIOUS } });
    const result = await goBack(browser.api);
    assert.equal(result.url, PREVIOUS);
    assert.equal(browser.calls.some(([name]) => name === 'tabs.sendMessage'), false);
  });

  it('si Chromium omite la entrada anterior, retrocede con history.back() desde la página', async () => {
    const browser = createFakeBrowser({
      tabs: threeTabs(),
      contentScript: (message, { tab, simulateLoad }) => {
        if (message.action === 'history' && message.params.direction === 'back') {
          simulateLoad(tab, PREVIOUS);
        }
        return { success: true };
      },
    });
    const result = await goBack(browser.api);
    assert.equal(result.url, PREVIOUS);
    assert.deepEqual(browser.calls.at(-1), ['tabs.sendMessage', 2, 'history', { direction: 'back' }]);
  });

  it('conserva el error original si tampoco se puede retroceder desde la página', async () => {
    const internalPage = createFakeBrowser({ tabs: threeTabs() });
    await assert.rejects(goBack(internalPage.api), /Cannot find a next page in history/);

    const firstEntry = createFakeBrowser({ tabs: threeTabs(), contentScript: () => ({ success: true }) });
    await assert.rejects(goBack(firstEntry.api), /Cannot find a next page in history/);
  });
});

describe('pestañas', () => {
  it('tabs_list lista la ventana enfocada e incluye count', async () => {
    const browser = createFakeBrowser({ tabs: threeTabs() });
    const result = await tabsList(browser.api);
    assert.equal(result.count, 3);
    assert.deepEqual(result.tabs[1], { index: 1, id: 2, url: 'chrome://newtab/', title: 'Nueva pestaña', active: true });
  });

  it('tab_switch fuera de rango responde con el mensaje original', async () => {
    const browser = createFakeBrowser({ tabs: threeTabs() });
    assert.deepEqual(await tabSwitch(browser.api, { index: 5 }), { success: false, error: 'Tab index 5 out of range (0-2)' });
  });

  it('tab_switch activa la pestaña pedida', async () => {
    const browser = createFakeBrowser({ tabs: threeTabs() });
    const result = await tabSwitch(browser.api, { index: 2 });
    assert.deepEqual(result, { success: true, index: 2, url: 'https://docs.example.com/', title: 'Docs' });
    assert.deepEqual(browser.calls[0], ['tabs.update', 3, { active: true }]);
  });

  it('tab_close sin índice cierra la activa e informa remaining_tabs', async () => {
    const browser = createFakeBrowser({ tabs: threeTabs() });
    assert.deepEqual(await tabClose(browser.api, {}), { success: true, closed_index: 1, remaining_tabs: 2 });
    assert.deepEqual(browser.calls[0], ['tabs.remove', 2]);
  });

  it('tab_close no cierra la última pestaña', async () => {
    const browser = createFakeBrowser({ tabs: [threeTabs()[1]] });
    assert.deepEqual(await tabClose(browser.api, {}), { success: false, error: 'Cannot close the last tab' });
  });

  it('tab_new abre la pestaña en la ventana del agente y espera la carga', async () => {
    const browser = createFakeBrowser({ tabs: threeTabs() });
    const result = await tabNew(browser.api, { url: 'https://example.net' });
    assert.deepEqual(browser.calls[0], ['tabs.create', { url: 'https://example.net/', windowId: 1 }]);
    assert.equal(result.success, true);
    assert.equal(result.url, 'https://example.net/');
    assert.equal(result.index, 3);
    assert.equal(result.id, undefined, '`id` está reservado para correlacionar la respuesta');
    assert.equal(typeof result.tab_id, 'number');
  });
});

describe('estado de la página', () => {
  it('screenshot quita el prefijo data: y añade la URL', async () => {
    const browser = createFakeBrowser({ tabs: threeTabs() });
    const result = await screenshot(browser.api);
    assert.deepEqual(result, {
      success: true,
      image_base64: 'iVBORw0KGgo=',
      format: 'png',
      url: 'chrome://newtab/',
      title: 'Nueva pestaña',
    });
    assert.deepEqual(browser.calls[0], ['tabs.captureVisibleTab', 1, { format: 'png' }]);
  });

  it('snapshot responde con texto de reemplazo en páginas internas', async () => {
    const browser = createFakeBrowser({ tabs: threeTabs() });
    assert.deepEqual(await snapshot(browser.api), {
      success: true,
      url: 'chrome://newtab/',
      title: 'Nueva pestaña',
      text: '[No se pudo extraer texto]',
    });
  });

  it('page_info usa el tamaño de la pestaña si no puede medir la página', async () => {
    const browser = createFakeBrowser({ tabs: threeTabs() });
    assert.deepEqual(await pageInfo(browser.api), {
      success: true,
      url: 'chrome://newtab/',
      title: 'Nueva pestaña',
      viewport: { width: 1280, height: 720 },
    });
  });
});

describe('descargas', () => {
  it('lista las descargas más recientes con count', async () => {
    const download = { id: 4, filename: 'C:\\informe.pdf', url: 'https://x.example/informe.pdf', state: 'complete', fileSize: 10, startTime: 'a', endTime: 'b', mime: 'application/pdf', danger: 'safe' };
    const browser = createFakeBrowser({ tabs: threeTabs(), downloads: [download] });
    const result = await downloadsList(browser.api, { limit: 20 });
    assert.equal(result.count, 1);
    assert.equal(result.downloads[0].danger, undefined, 'solo se envían los campos del protocolo');
    assert.deepEqual(browser.calls[0], ['downloads.search', { limit: 20, orderBy: ['-startTime'] }]);
  });

  it('informa si el navegador no tiene API de descargas (Safari)', async () => {
    assert.deepEqual(await downloadsList({}, { limit: 5 }), {
      success: false,
      error: 'Downloads API is not available in this browser',
    });
  });
});
