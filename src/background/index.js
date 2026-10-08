/**
 * Contexto de fondo: service worker en Chromium y Safari, página de eventos en
 * Firefox.
 *
 * Manifest V3 puede detener este contexto en cualquier momento, así que:
 *   - todos los listeners se registran de forma síncrona al cargar el script;
 *   - una alarma de vigilancia lo despierta cada 30 s y reconecta si hace falta;
 *   - con la conexión abierta, el keepalive lo mantiene vivo.
 */
import { createActivityEntry } from '../shared/activity.js';
import { api } from '../shared/browser-api.js';
import { UI_MESSAGES } from '../shared/messages.js';
import { EVENTS } from '../shared/protocol.js';
import { loadSettings, normalizeSettings, resolveConnectionTarget, SETTINGS_KEY } from '../shared/settings.js';
import { describeConnection } from '../shared/status.js';
import { updateActionIndicator } from './action-indicator.js';
import { createCommandHandlers } from './commands/index.js';
import { BridgeConnection } from './connection.js';
import { probeCoreHealth, runConnectionTest } from './diagnostics.js';
import { buildHelloPayload } from './hello.js';
import { createCommandRouter } from './router.js';
import { createStateStore } from './state-store.js';

const WATCHDOG_ALARM = 'gmini-watchdog';
// Chrome 120+ admite alarmas de 30 s; las versiones anteriores las redondean a 1 min.
const WATCHDOG_PERIOD_MINUTES = 0.5;
const MISSING_RECEIVER = /Receiving end does not exist|Could not establish connection/i;

let currentSettings = normalizeSettings(null);
let lastIndicatorKey = null;

const store = createStateStore({ sessionArea: api.storage.session, onChange: publishState });

const router = createCommandRouter({
  handlers: createCommandHandlers(api),
  onCommandSettled: (event) => store.addActivity(createActivityEntry(event)),
});

const connection = new BridgeConnection({
  createSocket: (url) => new WebSocket(url),
  clock: {
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (timer) => clearTimeout(timer),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (timer) => clearInterval(timer),
  },
  onOpen: sendHello,
  onText: handleCoreFrame,
  onKeepAlive: touchExtensionApi,
  onStatusChange: (status) => store.setStatus(status),
});

const ready = boot().catch((error) => console.error('[G-Mini] No se pudo iniciar la extensión:', error));

api.runtime.onStartup.addListener(() => ready.then(() => connection.ensureConnected()));
api.runtime.onInstalled.addListener(() => ready.then(() => connection.ensureConnected()));
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) {
    ready.then(() => connection.ensureConnected());
  }
});
api.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[SETTINGS_KEY]) {
    ready.then(() => applySettings(changes[SETTINGS_KEY].newValue));
  }
});
api.runtime.onMessage.addListener(handleUiMessage);

async function boot() {
  try {
    await store.restore();
  } catch (error) {
    console.warn(`[G-Mini] No se pudo recuperar la actividad: ${error.message}`);
  }
  await applySettings(await loadSettings(api.storage.local));
}

async function applySettings(rawSettings) {
  currentSettings = normalizeSettings(rawSettings);
  connection.configure(resolveConnectionTarget(currentSettings));
  await syncWatchdog(currentSettings.enabled);
}

async function syncWatchdog(enabled) {
  if (!enabled) {
    await api.alarms.clear(WATCHDOG_ALARM);
    return;
  }
  // Crear la alarma de nuevo reinicia su cuenta; solo se crea si falta.
  if (!(await api.alarms.get(WATCHDOG_ALARM))) {
    await api.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MINUTES });
  }
}

async function sendHello() {
  let payload;
  try {
    payload = await buildHelloPayload(api);
  } catch (error) {
    console.warn(`[G-Mini] Handshake reducido: ${error.message}`);
    payload = { extensionId: api.runtime.id, tabUrl: '', tabTitle: '', userAgent: navigator.userAgent };
  }
  connection.send({ event: EVENTS.hello, data: payload });
}

function handleCoreFrame(frameText) {
  router
    .handleFrame(frameText)
    .then((reply) => {
      if (reply && !connection.send(reply)) {
        console.warn(`[G-Mini] No se envió la respuesta ${reply.data?.id ?? reply.event}: la conexión se cerró.`);
      }
    })
    .catch((error) => console.error('[G-Mini] Error al procesar un mensaje del núcleo:', error));
}

function touchExtensionApi() {
  // Una llamada a la API reinicia el contador de inactividad en Chrome 110-115
  // y en Firefox, donde el tráfico del WebSocket no basta.
  api.runtime.getPlatformInfo().catch((error) => console.warn(`[G-Mini] Keepalive sin respuesta: ${error.message}`));
}

function publishState(snapshot) {
  api.runtime
    .sendMessage({ type: UI_MESSAGES.stateChanged, ...snapshot })
    .catch((error) => {
      // Sin popup ni opciones abiertos no hay receptor: es lo esperado.
      if (!MISSING_RECEIVER.test(error?.message ?? '')) {
        console.warn(`[G-Mini] No se pudo avisar a la interfaz: ${error.message}`);
      }
    });
  const view = describeConnection(snapshot.status);
  if (view.key !== lastIndicatorKey) {
    lastIndicatorKey = view.key;
    updateActionIndicator(api, view);
  }
}

const UI_HANDLERS = Object.freeze({
  [UI_MESSAGES.getState]: () => ({
    ...store.snapshot(),
    settings: currentSettings,
    version: api.runtime.getManifest().version,
  }),
  [UI_MESSAGES.reconnect]: () => ({ status: connection.reconnectNow() }),
  [UI_MESSAGES.testConnection]: () =>
    runConnectionTest({
      connection,
      serverUrl: resolveConnectionTarget(currentSettings).url,
      probe: (url) => probeCoreHealth(url),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    }),
  [UI_MESSAGES.clearActivity]: () => {
    store.clearActivity();
    return { ok: true };
  },
});

function isFromExtensionPage(sender) {
  return sender?.id === api.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(api.runtime.getURL(''));
}

function handleUiMessage(message, sender, sendResponse) {
  if (!isFromExtensionPage(sender) || !Object.hasOwn(UI_HANDLERS, message?.type)) {
    return false;
  }
  ready
    .then(() => UI_HANDLERS[message.type]())
    .then(sendResponse, (error) => sendResponse({ error: error?.message ?? String(error) }));
  return true;
}
