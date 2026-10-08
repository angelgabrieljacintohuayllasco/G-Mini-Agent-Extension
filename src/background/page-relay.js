/**
 * Envía acciones DOM al content script de una pestaña.
 *
 * El content script no se declara en el manifiesto: se inyecta la primera vez
 * que el agente lo necesita en una página. Así la extensión no ejecuta nada en
 * las páginas que G-Mini no toca.
 */
import { CONTENT_CHANNEL } from '../shared/messages.js';

const CONTENT_SCRIPT_FILE = 'content.js';
export const CONTENT_TIMEOUT_MS = 15000;
const MISSING_RECEIVER = /Receiving end does not exist|Could not establish connection/i;

export async function runContentAction(api, tab, action, params = {}, { timeoutMs = CONTENT_TIMEOUT_MS } = {}) {
  const message = { channel: CONTENT_CHANNEL, action, params };
  try {
    return await sendWithTimeout(api, tab.id, message, action, timeoutMs);
  } catch (error) {
    if (!MISSING_RECEIVER.test(error?.message ?? '')) {
      throw error;
    }
  }
  await injectContentScript(api, tab);
  return sendWithTimeout(api, tab.id, message, action, timeoutMs);
}

async function injectContentScript(api, tab) {
  try {
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT_FILE] });
  } catch (error) {
    throw new Error(`Cannot access this page (${describePageOrigin(tab.url)}): ${error.message}`, { cause: error });
  }
}

function sendWithTimeout(api, tabId, message, action, timeoutMs) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Content script timeout for '${action}' after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  const request = api.tabs
    .sendMessage(tabId, message, { frameId: 0 })
    .then((response) => response ?? { success: false, error: 'No response from content script' });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

function describePageOrigin(rawUrl) {
  if (!rawUrl) {
    return 'unknown page';
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.host ? `${parsed.protocol}//${parsed.host}` : parsed.protocol;
  } catch {
    return 'unknown page';
  }
}
