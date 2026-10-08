import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCommandRouter } from '../../src/background/router.js';
import { silentLog } from './helpers/fakes.js';

const command = (id, name, params) => JSON.stringify({ event: 'ext:command', data: { id, command: name, params } });

function createRouter(handlers = {}) {
  const settled = [];
  const router = createCommandRouter({
    handlers,
    onCommandSettled: (event) => settled.push(event),
    now: () => 42,
    log: silentLog,
  });
  return { router, settled };
}

describe('createCommandRouter', () => {
  it('responde ext:ping con ext:pong', async () => {
    const { router } = createRouter();
    assert.deepEqual(await router.handleFrame(JSON.stringify({ event: 'ext:ping', data: {} })), {
      event: 'ext:pong',
      data: { ts: 42 },
    });
  });

  it('descarta JSON inválido y eventos que no conoce', async () => {
    const { router, settled } = createRouter();
    assert.equal(await router.handleFrame('{roto'), null);
    assert.equal(await router.handleFrame(JSON.stringify({ event: 'ext:hello', data: {} })), null);
    assert.equal(settled.length, 0);
  });

  it('descarta comandos sin id porque no hay a quién responder', async () => {
    const { router } = createRouter({ snapshot: async () => ({ success: true }) });
    assert.equal(await router.handleFrame(JSON.stringify({ event: 'ext:command', data: { command: 'snapshot' } })), null);
  });

  it('ejecuta el manejador con los parámetros validados y devuelve ext:response con el id', async () => {
    let received;
    const { router, settled } = createRouter({
      scroll: async (params) => {
        received = params;
        return { success: true, scrollY: 900 };
      },
    });
    const reply = await router.handleFrame(command('a1', 'scroll', { amount: '1' }));
    assert.deepEqual(received, { direction: 'down', amount: 1 });
    assert.deepEqual(reply, { event: 'ext:response', data: { success: true, scrollY: 900, id: 'a1' } });
    assert.equal(settled[0].command, 'scroll');
    assert.equal(settled[0].result.success, true);
  });

  it('responde Unknown command sin ejecutar nada', async () => {
    const { router, settled } = createRouter();
    const reply = await router.handleFrame(command('b2', 'rm_rf', {}));
    assert.deepEqual(reply.data, { success: false, error: 'Unknown command: rm_rf', id: 'b2' });
    assert.equal(settled.length, 1);
  });

  it('rechaza parámetros inválidos antes de llegar al manejador', async () => {
    let called = false;
    const { router } = createRouter({
      click: async () => {
        called = true;
        return { success: true };
      },
    });
    const reply = await router.handleFrame(command('c3', 'click', {}));
    assert.equal(called, false);
    assert.equal(reply.data.success, false);
    assert.match(reply.data.error, /'selector' is required/);
  });

  it('convierte una excepción del manejador en success: false', async () => {
    const { router } = createRouter({
      go_back: async () => {
        throw new Error('Cannot find a next page in history.');
      },
    });
    const reply = await router.handleFrame(command('d4', 'go_back', {}));
    assert.deepEqual(reply.data, { success: false, error: 'Cannot find a next page in history.', id: 'd4' });
  });

  it('un resultado no puede reemplazar el id del comando', async () => {
    const { router } = createRouter({ tabs_list: async () => ({ success: true, id: 'falso' }) });
    const reply = await router.handleFrame(command('e5', 'tabs_list', {}));
    assert.equal(reply.data.id, 'e5');
  });

  it('un manejador que no devuelve objeto se informa como error', async () => {
    const { router } = createRouter({ page_info: async () => undefined });
    const reply = await router.handleFrame(command('f6', 'page_info', {}));
    assert.deepEqual(reply.data, { success: false, error: 'Command returned no result', id: 'f6' });
  });

  it('un fallo al registrar la actividad no impide responder', async () => {
    const router = createCommandRouter({
      handlers: { snapshot: async () => ({ success: true }) },
      onCommandSettled: () => {
        throw new Error('storage lleno');
      },
      log: silentLog,
    });
    const reply = await router.handleFrame(command('g7', 'snapshot', {}));
    assert.equal(reply.data.success, true);
  });
});
