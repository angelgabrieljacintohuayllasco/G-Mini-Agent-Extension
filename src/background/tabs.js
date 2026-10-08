/**
 * Pestaña y ventana sobre las que actúa el agente.
 *
 * El objetivo es la pestaña activa de la última ventana enfocada. Si esa
 * ventana no tiene pestañas (por ejemplo, unas DevTools desacopladas), se usa
 * la última ventana normal.
 */

// Tras pedir una navegación, si en este tiempo la pestaña no pasa a "loading"
// se asume una navegación dentro del mismo documento (solo cambió el #hash).
const NAVIGATION_START_GRACE_MS = 1000;

export async function getActiveTab(api) {
  const [focusedTab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  if (focusedTab) {
    return focusedTab;
  }
  const windowId = await findLastNormalWindowId(api);
  if (windowId !== null) {
    const [activeTab] = await api.tabs.query({ active: true, windowId });
    if (activeTab) {
      return activeTab;
    }
  }
  throw new Error('No active tab found');
}

async function findLastNormalWindowId(api) {
  try {
    const window = await api.windows.getLastFocused({ windowTypes: ['normal'] });
    return window?.id ?? null;
  } catch {
    // Sin ventanas abiertas (navegador en segundo plano): no hay pestaña activa.
    return null;
  }
}

/** Pestañas de la ventana del agente, en el orden en que se ven. */
export async function getWindowTabs(api) {
  const activeTab = await getActiveTab(api);
  return api.tabs.query({ windowId: activeTab.windowId });
}

/**
 * Espera a que la pestaña termine de cargar. Nunca rechaza: al vencer el plazo
 * resuelve con 'timeout' para que el comando responda con el estado actual,
 * igual que la extensión original.
 *
 * Con expectNavigation, si la carga nunca empieza resuelve 'unchanged' (no
 * hubo navigación, o solo cambió el #hash).
 */
export function waitForTabComplete(api, tabId, { timeoutMs, expectNavigation }) {
  return new Promise((resolve) => {
    let navigationStarted = !expectNavigation;
    let settled = false;
    const timers = [];

    const finish = (outcome) => {
      if (settled) {
        return;
      }
      settled = true;
      timers.forEach((timer) => clearTimeout(timer));
      api.tabs.onUpdated.removeListener(onUpdated);
      api.tabs.onRemoved.removeListener(onRemoved);
      resolve(outcome);
    };

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) {
        return;
      }
      if (changeInfo.status === 'loading') {
        navigationStarted = true;
      }
      if (changeInfo.status === 'complete' && navigationStarted) {
        finish('complete');
      }
    }

    function onRemoved(removedTabId) {
      if (removedTabId === tabId) {
        finish('closed');
      }
    }

    async function settleIfAlreadyComplete() {
      try {
        const tab = await api.tabs.get(tabId);
        if (tab.status === 'complete') {
          finish(navigationStarted ? 'complete' : 'unchanged');
        } else {
          navigationStarted = true;
        }
      } catch {
        finish('closed');
      }
    }

    api.tabs.onUpdated.addListener(onUpdated);
    api.tabs.onRemoved.addListener(onRemoved);
    timers.push(setTimeout(() => finish('timeout'), timeoutMs));
    timers.push(setTimeout(settleIfAlreadyComplete, expectNavigation ? NAVIGATION_START_GRACE_MS : 0));
  });
}

export function describeTab(tab) {
  return { success: true, url: tab.url, title: tab.title, status: tab.status };
}
