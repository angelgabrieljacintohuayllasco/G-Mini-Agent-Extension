import { runContentAction } from '../page-relay.js';
import { getActiveTab } from '../tabs.js';

const SNAPSHOT_TEXT_LIMIT = 8000;
const SNAPSHOT_FALLBACK_TEXT = '[No se pudo extraer texto]';
const VIEWPORT_TIMEOUT_MS = 3000;
// El content script agota su propia espera en `timeout_ms`; este margen deja
// que su respuesta llegue antes de cortar el mensaje.
const WAIT_FOR_MARGIN_MS = 1500;

/** Comando que se resuelve en la página mediante el content script. */
export function relayToPage(api, action) {
  return async (params) => {
    const tab = await getActiveTab(api);
    const options = action === 'wait_for' ? { timeoutMs: params.timeout_ms + WAIT_FOR_MARGIN_MS } : {};
    return runContentAction(api, tab, action, params, options);
  };
}

export async function snapshot(api) {
  const tab = await getActiveTab(api);
  let text;
  try {
    const response = await runContentAction(api, tab, 'extract', { selector: 'body' });
    text = response.text || '';
  } catch {
    // Páginas internas del navegador: se responde igual, con un texto de
    // reemplazo, como hacía la extensión original.
    text = SNAPSHOT_FALLBACK_TEXT;
  }
  return { success: true, url: tab.url, title: tab.title, text: text.slice(0, SNAPSHOT_TEXT_LIMIT) };
}

export async function screenshot(api) {
  const tab = await getActiveTab(api);
  try {
    const dataUrl = await api.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return {
      success: true,
      image_base64: dataUrl.replace(/^data:image\/\w+;base64,/, ''),
      format: 'png',
      url: tab.url,
      title: tab.title,
    };
  } catch (error) {
    return { success: false, error: `Screenshot failed: ${error.message}` };
  }
}

export async function pageInfo(api) {
  const tab = await getActiveTab(api);
  return { success: true, url: tab.url, title: tab.title, viewport: await readViewport(api, tab) };
}

async function readViewport(api, tab) {
  try {
    const response = await runContentAction(api, tab, 'viewport', {}, { timeoutMs: VIEWPORT_TIMEOUT_MS });
    if (response?.success) {
      return { width: response.width, height: response.height };
    }
  } catch {
    // Página donde no se puede inyectar: se usa el tamaño de la pestaña.
  }
  return { width: tab.width ?? 0, height: tab.height ?? 0 };
}
