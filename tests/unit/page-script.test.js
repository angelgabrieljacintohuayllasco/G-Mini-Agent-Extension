import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { CSP_BLOCKED_MESSAGE, evaluateInPage, runScriptInPage } from '../../src/background/page-script.js';

const MODULE_URL = new URL('../../src/background/page-script.js', import.meta.url).href;

/** Ejecuta runScriptInPage en un Node que prohíbe generar código, como una CSP sin 'unsafe-eval'. */
function runWithCodeGenerationBlocked(code) {
  const program = `import(${JSON.stringify(MODULE_URL)}).then(async ({ runScriptInPage }) => {
    console.log(JSON.stringify(await runScriptInPage(${JSON.stringify(code)})));
  });`;
  const output = execFileSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e', program], {
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

describe('runScriptInPage (se ejecuta dentro de la página)', () => {
  it('devuelve el valor del return', async () => {
    assert.deepEqual(await runScriptInPage('return 1 + 1'), { ok: true, value: 2 });
    assert.deepEqual(await runScriptInPage('return "hola"'), { ok: true, value: 'hola' });
  });

  it('sin return devuelve null, como la extensión anterior', async () => {
    assert.deepEqual(await runScriptInPage('const x = 1;'), { ok: true, value: null });
  });

  it('admite await y devuelve valores serializables', async () => {
    const outcome = await runScriptInPage('await Promise.resolve(); return { lista: [1, 2], texto: "x", nada: undefined }');
    assert.deepEqual(outcome, { ok: true, value: { lista: [1, 2], texto: 'x' } });
  });

  it('lo que no se puede serializar se devuelve como texto', async () => {
    assert.deepEqual(await runScriptInPage('return 10n'), { ok: true, value: '10' });
    assert.deepEqual(await runScriptInPage('const a = {}; a.a = a; return a'), { ok: true, value: '[object Object]' });
  });

  it('informa los errores del script sin confundirlos con la CSP', async () => {
    assert.deepEqual(await runScriptInPage('throw new Error("fallo del script")'), {
      ok: false,
      blockedByCsp: false,
      message: 'fallo del script',
    });
    const syntax = await runScriptInPage('return (');
    assert.equal(syntax.ok, false);
    assert.equal(syntax.blockedByCsp, false);
  });

  it('detecta cuando la página prohíbe evaluar código', () => {
    const outcome = runWithCodeGenerationBlocked('return 1');
    assert.equal(outcome.ok, false);
    assert.equal(outcome.blockedByCsp, true);
    assert.match(outcome.message, /disallowed/);
  });

  it('no depende de nada fuera de su cuerpo (el navegador la serializa)', async () => {
    // Reconstruye la función desde su texto, como hace el navegador al inyectarla.
    // eslint-disable-next-line no-new-func -- la prueba reproduce la serialización de scripting.executeScript
    const isolated = new Function(`return (${runScriptInPage.toString()})`)();
    assert.deepEqual(await isolated('return 3 * 3'), { ok: true, value: 9 });
  });
});

describe('evaluateInPage', () => {
  const tab = { id: 7, windowId: 1, active: true, url: 'https://example.com/ruta?token=1', title: 'Example' };

  function fakeApi(executeScript) {
    const calls = [];
    return {
      calls,
      api: {
        tabs: { query: async () => [tab] },
        scripting: {
          executeScript: async (injection) => {
            calls.push(injection);
            return executeScript(injection);
          },
        },
      },
    };
  }

  it('inyecta en el mundo principal de la pestaña activa y devuelve result', async () => {
    const { api, calls } = fakeApi(async ({ func, args }) => [{ result: await func(...args) }]);
    assert.deepEqual(await evaluateInPage(api, { script: 'return 40 + 2' }), { success: true, result: 42 });
    assert.deepEqual(calls[0].target, { tabId: 7 });
    assert.equal(calls[0].world, 'MAIN');
    assert.equal(calls[0].func, runScriptInPage);
    assert.deepEqual(calls[0].args, ['return 40 + 2']);
  });

  it('con una CSP sin unsafe-eval responde el error claro', async () => {
    const { api } = fakeApi(async () => [{ result: { ok: false, blockedByCsp: true, message: 'Refused to evaluate...' } }]);
    assert.deepEqual(await evaluateInPage(api, { script: 'return 1' }), {
      success: false,
      error: CSP_BLOCKED_MESSAGE,
      code: 'csp_blocked',
    });
    assert.equal(CSP_BLOCKED_MESSAGE, 'Esta página no permite ejecutar código (CSP); usa browser_extract o browser_snapshot');
  });

  it('los errores del script conservan el prefijo Eval error', async () => {
    const { api } = fakeApi(async () => [{ result: { ok: false, blockedByCsp: false, message: 'x is not defined' } }]);
    assert.deepEqual(await evaluateInPage(api, { script: 'return x' }), { success: false, error: 'Eval error: x is not defined' });
  });

  it('en páginas internas del navegador explica que no se puede acceder', async () => {
    const { api } = fakeApi(async () => {
      throw new Error('Cannot access a chrome:// URL');
    });
    assert.deepEqual(await evaluateInPage(api, { script: 'return 1' }), {
      success: false,
      error: 'Cannot access this page (https://example.com): Cannot access a chrome:// URL',
    });
  });

  it('responde antes del plazo del núcleo si el script no termina', async () => {
    const { api } = fakeApi(() => new Promise(() => {}));
    const result = await evaluateInPage(api, { script: 'await new Promise(() => {})' }, { timeoutMs: 30 });
    assert.deepEqual(result, { success: false, error: 'Eval error: the script did not finish within 30ms' });
  });

  it('si la página no devuelve resultado lo informa', async () => {
    const { api } = fakeApi(async () => []);
    assert.deepEqual(await evaluateInPage(api, { script: 'return 1' }), {
      success: false,
      error: 'Eval error: the page returned no result',
    });
  });
});
