import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BridgeConnection } from '../../src/background/connection.js';
import { describeConnection } from '../../src/shared/status.js';
import { createFakeClock, createSocketFactory, silentLog } from './helpers/fakes.js';

const URL_A = 'ws://127.0.0.1:8765/ws/extension';
const URL_B = 'ws://127.0.0.1:9000/ws/extension';

function setup() {
  const clock = createFakeClock();
  const factory = createSocketFactory();
  const received = [];
  let opens = 0;
  let keepAlives = 0;
  const connection = new BridgeConnection({
    createSocket: factory.create,
    clock,
    random: () => 0.5, // sin jitter: esperas exactas
    onText: (text) => received.push(text),
    onOpen: () => {
      opens += 1;
    },
    onKeepAlive: () => {
      keepAlives += 1;
    },
    log: silentLog,
  });
  return {
    clock,
    factory,
    connection,
    received,
    opens: () => opens,
    keepAlives: () => keepAlives,
  };
}

const enabled = (url = URL_A) => ({ enabled: true, url, blockedReason: null });

describe('BridgeConnection', () => {
  it('conecta, avisa al abrir y envía keepalive cada 20 s', () => {
    const { connection, factory, clock, opens, keepAlives } = setup();
    connection.configure(enabled());
    assert.equal(factory.last().url, URL_A);
    assert.equal(connection.status.state, 'connecting');

    factory.last().acceptConnection();
    assert.equal(connection.status.state, 'open');
    assert.equal(opens(), 1);

    clock.advance(20000);
    assert.equal(factory.last().sent.at(-1).event, 'ext:ping');
    assert.equal(keepAlives(), 1);
  });

  it('entrega al callback el texto de cada mensaje', () => {
    const { connection, factory, received } = setup();
    connection.configure(enabled());
    factory.last().acceptConnection();
    factory.last().receive({ event: 'ext:command', data: { id: '1' } });
    assert.equal(received.length, 1);
  });

  it('reintenta con espera exponencial y tope de 30 s', () => {
    const { connection, factory, clock } = setup();
    connection.configure(enabled());
    const waits = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      factory.last().closeFromServer(1006);
      const { nextRetryAt } = connection.status;
      waits.push(nextRetryAt - clock.now());
      clock.advance(nextRetryAt - clock.now());
    }
    assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    assert.equal(factory.sockets.length, 8);
  });

  it('muestra "Sin app" a partir del tercer intento fallido', () => {
    const { connection, factory, clock } = setup();
    connection.configure(enabled());
    factory.last().closeFromServer(1006);
    assert.equal(describeConnection(connection.status, clock.now()).label, 'Reconectando');
    clock.advance(1000);
    factory.last().closeFromServer(1006);
    clock.advance(2000);
    factory.last().closeFromServer(1006);
    assert.equal(describeConnection(connection.status, clock.now()).label, 'Sin app');
  });

  it('tras perder una conexión abierta reintenta en 1 s', () => {
    const { connection, factory } = setup();
    connection.configure(enabled());
    factory.last().acceptConnection();
    factory.last().closeFromServer(1006);
    assert.equal(connection.status.state, 'waiting');
    assert.equal(connection.status.attempt, 1);
  });

  it('si el núcleo la cierra con 1000 (otra extensión tomó el lugar) no reconecta sola', () => {
    const { connection, factory, clock } = setup();
    connection.configure(enabled());
    factory.last().acceptConnection();
    factory.last().closeFromServer(1000);
    assert.equal(connection.status.state, 'displaced');

    clock.advance(10 * 60 * 1000);
    connection.ensureConnected();
    assert.equal(factory.sockets.length, 1);

    connection.reconnectNow();
    assert.equal(factory.sockets.length, 2);
    assert.equal(connection.status.state, 'connecting');
  });

  it('en pausa cierra el socket y no reintenta', () => {
    const { connection, factory, clock } = setup();
    connection.configure(enabled());
    const socket = factory.last();
    socket.acceptConnection();

    connection.configure({ enabled: false, url: null, blockedReason: null });
    assert.equal(connection.status.state, 'disabled');
    assert.deepEqual(socket.closedWith, { code: 1000, reason: 'client closing' });

    socket.closeFromServer(1000);
    clock.advance(60000);
    assert.equal(connection.status.state, 'disabled');
    assert.equal(factory.sockets.length, 1);
  });

  it('con una dirección bloqueada no abre ningún socket', () => {
    const { connection, factory } = setup();
    connection.configure({ enabled: true, url: null, blockedReason: 'Servidor remoto no permitido' });
    assert.equal(connection.status.state, 'blocked');
    assert.equal(connection.status.lastError, 'Servidor remoto no permitido');
    assert.equal(factory.sockets.length, 0);
  });

  it('al cambiar la dirección cierra el socket anterior y abre uno nuevo', () => {
    const { connection, factory } = setup();
    connection.configure(enabled(URL_A));
    const first = factory.last();
    first.acceptConnection();
    connection.configure(enabled(URL_B));
    assert.equal(first.closedWith.code, 1000);
    assert.equal(factory.last().url, URL_B);
  });

  it('volver a aplicar los mismos ajustes no reconecta', () => {
    const { connection, factory } = setup();
    connection.configure(enabled());
    factory.last().acceptConnection();
    connection.configure(enabled());
    assert.equal(factory.sockets.length, 1);
    assert.equal(connection.status.state, 'open');
  });

  it('corta el intento si el servidor no responde en 10 s', () => {
    const { connection, factory, clock } = setup();
    connection.configure(enabled());
    const socket = factory.last();
    clock.advance(10000);
    assert.equal(socket.closedWith.code, 1000);
    assert.equal(connection.status.state, 'waiting');
    assert.match(connection.status.lastError, /tiempo de espera/);
  });

  it('la alarma de vigilancia solo reconecta cuando toca', () => {
    const { connection, factory, clock } = setup();
    connection.configure(enabled());
    factory.last().closeFromServer(1006);
    connection.ensureConnected();
    assert.equal(factory.sockets.length, 1);
    clock.advance(999);
    connection.ensureConnected();
    assert.equal(factory.sockets.length, 1);
  });

  it('send devuelve false si no hay conexión abierta', () => {
    const { connection } = setup();
    assert.equal(connection.send({ event: 'ext:pong', data: {} }), false);
  });

  it('un fallo al crear el WebSocket se trata como intento fallido', () => {
    const clock = createFakeClock();
    const connection = new BridgeConnection({
      createSocket: () => {
        throw new SyntaxError('The URL is invalid');
      },
      clock,
      random: () => 0.5,
      onText: () => {},
      log: silentLog,
    });
    connection.configure(enabled());
    assert.equal(connection.status.state, 'waiting');
    assert.match(connection.status.lastError, /The URL is invalid/);
  });
});
