/**
 * Conexión WebSocket con el núcleo de G-Mini Agent.
 *
 * Máquina de estados con reconexión exponencial (tope de 30 s) y keepalive.
 * El WebSocket, los temporizadores y el azar se inyectan para poder probarla
 * sin navegador.
 *
 * Estados: disabled, blocked, idle, connecting, open, waiting (esperando el
 * siguiente reintento) y displaced (otra instancia tomó la conexión).
 */
import { computeReconnectDelay } from '../shared/backoff.js';
import { CONNECTION_STATES as STATES } from '../shared/messages.js';
import { EVENTS } from '../shared/protocol.js';

export const CONNECTION_TIMING = Object.freeze({
  // Chrome 116+ mantiene vivo el service worker mientras haya tráfico en el
  // WebSocket al menos cada 30 s.
  keepAliveMs: 20000,
  connectTimeoutMs: 10000,
});

const NORMAL_CLOSURE = 1000;
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

const INITIAL_STATUS = Object.freeze({
  state: STATES.idle,
  url: null,
  attempt: 0,
  nextRetryAt: null,
  connectedAt: null,
  lastError: null,
  lastCloseCode: null,
});

export class BridgeConnection {
  #createSocket;
  #clock;
  #random;
  #timing;
  #onText;
  #onOpen;
  #onKeepAlive;
  #onStatusChange;
  #log;

  #socket = null;
  #generation = 0;
  #status = { ...INITIAL_STATUS };
  #target = { enabled: false, url: null, blockedReason: null };
  #retryTimer = null;
  #connectTimer = null;
  #keepAliveTimer = null;

  constructor({ createSocket, clock, random = Math.random, timing = CONNECTION_TIMING, onText, onOpen, onKeepAlive, onStatusChange, log = console }) {
    this.#createSocket = createSocket;
    this.#clock = clock;
    this.#random = random;
    this.#timing = timing;
    this.#onText = onText;
    this.#onOpen = onOpen;
    this.#onKeepAlive = onKeepAlive;
    this.#onStatusChange = onStatusChange;
    this.#log = log;
  }

  get status() {
    return { ...this.#status };
  }

  /** Aplica los ajustes. Solo reconecta si cambió algo relevante. */
  configure(target) {
    const changed =
      target.enabled !== this.#target.enabled ||
      target.url !== this.#target.url ||
      target.blockedReason !== this.#target.blockedReason;
    this.#target = { enabled: target.enabled, url: target.url, blockedReason: target.blockedReason };

    if (!target.enabled) {
      this.#teardown();
      this.#update({ ...INITIAL_STATUS, state: STATES.disabled });
      return;
    }
    if (target.blockedReason) {
      this.#teardown();
      this.#update({ ...INITIAL_STATUS, state: STATES.blocked, lastError: target.blockedReason });
      return;
    }
    if (changed) {
      this.#teardown();
      this.#update({ ...INITIAL_STATUS });
      this.#connect();
      return;
    }
    this.ensureConnected();
  }

  /**
   * Llamado por la alarma de vigilancia: reconecta si no hay conexión ni
   * reintento pendiente. Respeta el estado displaced para no quitarle la
   * conexión a la otra instancia.
   */
  ensureConnected() {
    if (!this.#isActive()) {
      return;
    }
    const { state, nextRetryAt } = this.#status;
    const retryIsDue = state === STATES.waiting && (nextRetryAt === null || nextRetryAt <= this.#clock.now());
    if (state === STATES.idle || retryIsDue) {
      this.#connect();
    }
  }

  /** Acción del usuario: reintenta ya, también desde el estado displaced. */
  reconnectNow() {
    const { state } = this.#status;
    if (this.#isActive() && state !== STATES.open && state !== STATES.connecting) {
      this.#teardown();
      this.#update({ attempt: 0 });
      this.#connect();
    }
    return this.status;
  }

  send(frame) {
    if (this.#status.state !== STATES.open || this.#socket?.readyState !== SOCKET_OPEN) {
      return false;
    }
    this.#socket.send(JSON.stringify(frame));
    return true;
  }

  #isActive() {
    return this.#target.enabled && !this.#target.blockedReason && Boolean(this.#target.url);
  }

  #connect() {
    this.#clearTimers();
    const url = this.#target.url;
    const generation = ++this.#generation;
    this.#update({ state: STATES.connecting, url, nextRetryAt: null });

    let socket;
    try {
      socket = this.#createSocket(url);
    } catch (error) {
      this.#scheduleRetry(this.#status.attempt + 1, `No se pudo abrir el WebSocket: ${error.message}`);
      return;
    }
    this.#socket = socket;
    socket.onopen = () => this.#handleOpen(generation);
    socket.onmessage = (event) => this.#handleMessage(generation, event);
    socket.onclose = (event) => this.#handleClose(generation, event);
    // onerror siempre va seguido de onclose, que es donde se decide qué hacer.
    socket.onerror = () => {};
    this.#connectTimer = this.#clock.setTimeout(() => this.#handleConnectTimeout(generation), this.#timing.connectTimeoutMs);
  }

  #handleOpen(generation) {
    if (generation !== this.#generation) {
      return;
    }
    this.#clearTimers();
    this.#update({ state: STATES.open, attempt: 0, connectedAt: this.#clock.now(), lastError: null, lastCloseCode: null });
    this.#keepAliveTimer = this.#clock.setInterval(() => this.#sendKeepAlive(), this.#timing.keepAliveMs);
    this.#onOpen?.();
  }

  #handleMessage(generation, event) {
    if (generation === this.#generation) {
      this.#onText(event.data);
    }
  }

  #handleClose(generation, event) {
    if (generation !== this.#generation) {
      return;
    }
    const wasOpen = this.#status.state === STATES.open;
    this.#socket = null;
    this.#clearTimers();

    if (wasOpen && event.code === NORMAL_CLOSURE) {
      // El núcleo acepta una sola extensión: al conectarse otra cierra la
      // anterior con 1000. Reconectar aquí la desconectaría a ella y las dos
      // se quitarían la conexión en bucle, así que se espera al usuario.
      this.#update({
        state: STATES.displaced,
        attempt: 0,
        nextRetryAt: null,
        connectedAt: null,
        lastCloseCode: event.code,
        lastError: 'Otro navegador o perfil se conectó a G-Mini Agent.',
      });
      return;
    }
    this.#update({ lastCloseCode: event.code, connectedAt: null });
    if (wasOpen) {
      this.#scheduleRetry(1, `Se perdió la conexión (código ${event.code}).`);
    } else {
      this.#scheduleRetry(this.#status.attempt + 1, 'G-Mini Agent no respondió.');
    }
  }

  #handleConnectTimeout(generation) {
    if (generation !== this.#generation || this.#status.state !== STATES.connecting) {
      return;
    }
    this.#discardSocket();
    this.#scheduleRetry(this.#status.attempt + 1, 'Se agotó el tiempo de espera al conectar.');
  }

  #scheduleRetry(attempt, reason) {
    const delay = computeReconnectDelay(attempt, this.#random);
    this.#update({ state: STATES.waiting, attempt, nextRetryAt: this.#clock.now() + delay, lastError: reason });
    this.#retryTimer = this.#clock.setTimeout(() => this.#connect(), delay);
  }

  #sendKeepAlive() {
    if (this.send({ event: EVENTS.ping, data: { ts: this.#clock.now() } })) {
      this.#onKeepAlive?.();
    }
  }

  #teardown() {
    this.#clearTimers();
    this.#discardSocket();
  }

  #discardSocket() {
    const socket = this.#socket;
    this.#socket = null;
    // Los eventos que lleguen del socket descartado se ignoran desde aquí.
    this.#generation += 1;
    if (socket && (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN)) {
      try {
        socket.close(NORMAL_CLOSURE, 'client closing');
      } catch (error) {
        this.#log.warn(`[G-Mini] No se pudo cerrar el WebSocket: ${error.message}`);
      }
    }
  }

  #clearTimers() {
    this.#clock.clearTimeout(this.#retryTimer);
    this.#clock.clearTimeout(this.#connectTimer);
    this.#clock.clearInterval(this.#keepAliveTimer);
    this.#retryTimer = null;
    this.#connectTimer = null;
    this.#keepAliveTimer = null;
  }

  #update(changes) {
    this.#status = { ...this.#status, ...changes };
    this.#onStatusChange?.(this.status);
  }
}
