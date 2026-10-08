import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { healthUrlsFor, probeCoreHealth, runConnectionTest } from '../../src/background/diagnostics.js';

const SERVER = 'ws://127.0.0.1:8765/ws/extension';

function fakeConnection(initialState, { opensOnRetry = false } = {}) {
  let state = initialState;
  let reconnects = 0;
  return {
    get status() {
      return { state, lastError: state === 'blocked' ? 'Es un servidor remoto.' : null };
    },
    reconnectNow() {
      reconnects += 1;
      state = 'connecting';
      setTimeout(() => {
        state = opensOnRetry ? 'open' : 'waiting';
      }, 20);
    },
    reconnects: () => reconnects,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reachable = async () => ({ reachable: true, version: '0.2.0', latencyMs: 12 });
const unreachable = async () => ({ reachable: false });

describe('healthUrlsFor', () => {
  it('deriva las rutas de salud HTTP desde la dirección del WebSocket', () => {
    assert.deepEqual(healthUrlsFor(SERVER), ['http://127.0.0.1:8765/api/health', 'http://127.0.0.1:8765/api/v1/health']);
    assert.deepEqual(healthUrlsFor('wss://agente.example/ws/extension'), [
      'https://agente.example/api/health',
      'https://agente.example/api/v1/health',
    ]);
  });
});

describe('probeCoreHealth', () => {
  it('lee la versión del núcleo', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ status: 'ok', version: '0.2.0', uptime_seconds: 5 }) });
    const health = await probeCoreHealth(SERVER, { fetchImpl, now: () => 0 });
    assert.deepEqual(health, { reachable: true, version: '0.2.0', latencyMs: 0 });
  });

  it('prueba la ruta v1 si la primera no existe', async () => {
    const requested = [];
    const fetchImpl = async (url) => {
      requested.push(url);
      return url.endsWith('/api/health') ? { ok: false } : { ok: true, json: async () => ({ ok: true, version: '1.0.0' }) };
    };
    assert.equal((await probeCoreHealth(SERVER, { fetchImpl })).version, '1.0.0');
    assert.equal(requested.length, 2);
  });

  it('una conexión rechazada significa que el núcleo no está abierto', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    assert.deepEqual(await probeCoreHealth(SERVER, { fetchImpl }), { reachable: false });
  });
});

describe('runConnectionTest', () => {
  it('en pausa no intenta conectar', async () => {
    const connection = fakeConnection('disabled');
    const result = await runConnectionTest({ connection, serverUrl: SERVER, probe: reachable, sleep });
    assert.equal(result.ok, false);
    assert.equal(connection.reconnects(), 0);
  });

  it('con la conexión abierta informa la versión del núcleo', async () => {
    const result = await runConnectionTest({ connection: fakeConnection('open'), serverUrl: SERVER, probe: reachable, sleep });
    assert.deepEqual(result, {
      ok: true,
      tone: 'success',
      message: 'Conexión verificada. El núcleo G-Mini 0.2.0 respondió en 12 ms.',
    });
  });

  it('sin conexión pide un reintento inmediato y espera el resultado', async () => {
    const connection = fakeConnection('waiting', { opensOnRetry: true });
    const result = await runConnectionTest({ connection, serverUrl: SERVER, probe: reachable, sleep });
    assert.equal(connection.reconnects(), 1);
    assert.equal(result.ok, true);
  });

  it('distingue un núcleo que rechaza el WebSocket de uno que no está abierto', async () => {
    const rejected = await runConnectionTest({ connection: fakeConnection('waiting'), serverUrl: SERVER, probe: reachable, sleep });
    assert.match(rejected.message, /rechazó la conexión/);

    const closed = await runConnectionTest({ connection: fakeConnection('waiting'), serverUrl: SERVER, probe: unreachable, sleep });
    assert.equal(closed.message, 'No hay respuesta en 127.0.0.1:8765. Abre G-Mini Agent y vuelve a probar.');
  });

  it('si otra instancia tiene la conexión no se la quita', async () => {
    const connection = fakeConnection('displaced');
    const result = await runConnectionTest({ connection, serverUrl: SERVER, probe: reachable, sleep });
    assert.equal(connection.reconnects(), 0);
    assert.match(result.message, /Conectar aquí/);
  });
});
