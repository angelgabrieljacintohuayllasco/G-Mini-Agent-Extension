import { normalizeNavigationUrl } from '../navigation-url.js';
import { runContentAction } from '../page-relay.js';
import { describeTab, getActiveTab, waitForTabComplete } from '../tabs.js';

// El núcleo espera 15 s por comando. Se responde antes, con el estado que
// tenga la pestaña, para que el agente reciba la URL aunque la página siga
// cargando en lugar de un TimeoutError.
export const NAVIGATION_WAIT_MS = 13500;
const HISTORY_WAIT_MS = 10000;
const PAGE_HISTORY_TIMEOUT_MS = 3000;
const NO_HISTORY_ENTRY = /Cannot find a next page in history/i;

export async function navigate(api, { url }) {
  const target = normalizeNavigationUrl(url);
  if (!target.ok) {
    return { success: false, error: target.error };
  }
  const tab = await getActiveTab(api);
  await api.tabs.update(tab.id, { url: target.url });
  await waitForTabComplete(api, tab.id, { timeoutMs: NAVIGATION_WAIT_MS, expectNavigation: true });
  return describeTab(await api.tabs.get(tab.id));
}

/**
 * Atrás/adelante desde la propia página. Chromium marca como "omitibles" las
 * entradas de páginas que se abandonaron sin interacción del usuario
 * (intervención contra la manipulación del historial), y así quedan casi todas
 * las que abre el agente: tabs.goBack las salta y falla, pero history.back()
 * ejecutado en la página sí las recorre.
 */
async function traverseFromPage(api, tab, direction) {
  try {
    await runContentAction(api, tab, 'history', { direction }, { timeoutMs: PAGE_HISTORY_TIMEOUT_MS });
  } catch {
    // Página interna del navegador: no hay otra vía.
    return false;
  }
  const outcome = await waitForTabComplete(api, tab.id, { timeoutMs: HISTORY_WAIT_MS, expectNavigation: true });
  if (outcome !== 'unchanged') {
    return true;
  }
  const current = await api.tabs.get(tab.id);
  return current.url !== tab.url;
}

async function traverseHistory(api, direction) {
  const tab = await getActiveTab(api);
  try {
    await (direction === 'back' ? api.tabs.goBack(tab.id) : api.tabs.goForward(tab.id));
  } catch (error) {
    if (!NO_HISTORY_ENTRY.test(error?.message ?? '') || !(await traverseFromPage(api, tab, direction))) {
      throw error;
    }
    return describeTab(await api.tabs.get(tab.id));
  }
  await waitForTabComplete(api, tab.id, { timeoutMs: HISTORY_WAIT_MS, expectNavigation: true });
  return describeTab(await api.tabs.get(tab.id));
}

export function goBack(api) {
  return traverseHistory(api, 'back');
}

export function goForward(api) {
  return traverseHistory(api, 'forward');
}

export async function waitLoad(api, { timeout_ms: timeoutMs }) {
  const tab = await getActiveTab(api);
  await waitForTabComplete(api, tab.id, { timeoutMs, expectNavigation: false });
  return describeTab(await api.tabs.get(tab.id));
}
