/**
 * Content script. El fondo lo inyecta bajo demanda en la pestaña activa y le
 * envía acciones por el canal CONTENT_CHANNEL; solo atiende mensajes de su
 * propia extensión.
 */
import { api } from '../shared/browser-api.js';
import { CONTENT_CHANNEL } from '../shared/messages.js';
import { traverseHistory } from './history.js';
import { click, fill, hover, scroll, select, type } from './interaction.js';
import { press } from './keyboard.js';
import { removeOverlays } from './overlays.js';
import { extract, getDom, viewport } from './reading.js';
import { runPageScript } from './run-page-script.js';
import { waitFor } from './waiting.js';

async function evaluateScript({ script }) {
  try {
    return { success: true, result: await runPageScript(script) };
  } catch (error) {
    return { success: false, error: `Eval error: ${error?.message ?? error}` };
  }
}

const ACTIONS = Object.freeze({
  click,
  type,
  fill,
  press,
  scroll,
  hover,
  select,
  extract,
  get_dom: getDom,
  eval: evaluateScript,
  wait_for: waitFor,
  remove_overlays: removeOverlays,
  // Acciones internas del fondo; no son comandos del núcleo.
  viewport,
  history: traverseHistory,
});

// Una pestaña puede recibir varias inyecciones (por ejemplo, tras recargar la
// extensión); el listener se registra una sola vez por documento.
const INSTALLED = Symbol.for('gmini.bridge.content-script');

function handleMessage(message, sender, sendResponse) {
  if (message?.channel !== CONTENT_CHANNEL || sender?.id !== api.runtime.id) {
    return false;
  }
  if (!Object.hasOwn(ACTIONS, message.action)) {
    sendResponse({ success: false, error: `Unknown content action: ${message.action}` });
    return false;
  }
  Promise.resolve()
    .then(() => ACTIONS[message.action](message.params ?? {}))
    .then(sendResponse, (error) => sendResponse({ success: false, error: error?.message ?? String(error) }));
  return true;
}

if (api && !globalThis[INSTALLED]) {
  globalThis[INSTALLED] = true;
  api.runtime.onMessage.addListener(handleMessage);
}
