/**
 * "Probar conexión".
 *
 * No abre un segundo WebSocket: el núcleo acepta una sola extensión y uno
 * nuevo cerraría el actual. La prueba consulta la ruta pública /api/health y,
 * si no hay conexión, pide un reintento inmediato y espera su resultado.
 */
import { CONNECTION_STATES as STATES } from '../shared/messages.js';

const HEALTH_PATHS = ['/api/health', '/api/v1/health'];
const HEALTH_TIMEOUT_MS = 3000;
const OPEN_TIMEOUT_MS = 6000;
const POLL_INTERVAL_MS = 100;

export function healthUrlsFor(serverUrl) {
  const base = new URL(serverUrl);
  base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:';
  return HEALTH_PATHS.map((path) => new URL(path, base.origin).href);
}

export async function probeCoreHealth(serverUrl, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  for (const url of healthUrlsFor(serverUrl)) {
    const startedAt = now();
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS), cache: 'no-store' });
    } catch {
      // Conexión rechazada o sin respuesta: el núcleo no está escuchando.
      return { reachable: false };
    }
    if (response.ok) {
      const body = await response.json().catch(() => ({}));
      return { reachable: true, version: typeof body.version === 'string' ? body.version : '', latencyMs: now() - startedAt };
    }
  }
  return { reachable: false };
}

async function waitForOpen(connection, { timeoutMs, sleep, now }) {
  const deadline = now() + timeoutMs;
  let attemptStarted = false;
  while (now() < deadline) {
    const { state } = connection.status;
    if (state === STATES.open) {
      return true;
    }
    if (state === STATES.connecting) {
      attemptStarted = true;
    } else if (attemptStarted) {
      return false;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

function hostOf(serverUrl) {
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}

function describeCore(health) {
  return health.version ? `El núcleo G-Mini ${health.version} respondió en ${health.latencyMs} ms.` : 'El núcleo respondió.';
}

export async function runConnectionTest({ connection, serverUrl, probe, sleep, now = () => Date.now() }) {
  const { state, lastError } = connection.status;
  if (state === STATES.disabled) {
    return { ok: false, tone: 'neutral', message: 'La conexión está en pausa. Reactívala para probarla.' };
  }
  if (state === STATES.blocked) {
    return { ok: false, tone: 'danger', message: lastError };
  }

  const healthCheck = probe(serverUrl);
  if (state === STATES.displaced) {
    const health = await healthCheck;
    const reachability = health.reachable ? 'G-Mini Agent responde, pero' : 'Además, G-Mini Agent no responde y';
    return {
      ok: false,
      tone: 'danger',
      message: `${reachability} otro navegador tiene la conexión. Pulsa "Conectar aquí" para usar este.`,
    };
  }
  if (state !== STATES.open) {
    connection.reconnectNow();
  }
  const opened = state === STATES.open || (await waitForOpen(connection, { timeoutMs: OPEN_TIMEOUT_MS, sleep, now }));
  const health = await healthCheck;

  if (opened) {
    return { ok: true, tone: 'success', message: `Conexión verificada. ${health.reachable ? describeCore(health) : ''}`.trim() };
  }
  if (health.reachable) {
    return {
      ok: false,
      tone: 'danger',
      message: 'G-Mini Agent responde, pero rechazó la conexión de la extensión. Revisa que la ruta sea /ws/extension.',
    };
  }
  return {
    ok: false,
    tone: 'neutral',
    message: `No hay respuesta en ${hostOf(serverUrl)}. Abre G-Mini Agent y vuelve a probar.`,
  };
}
