import { normalizeNavigationUrl } from '../navigation-url.js';
import { getActiveTab, getWindowTabs, waitForTabComplete } from '../tabs.js';
import { NAVIGATION_WAIT_MS } from './navigation.js';

export async function tabsList(api) {
  const tabs = await getWindowTabs(api);
  return {
    success: true,
    tabs: tabs.map((tab, index) => ({ index, id: tab.id, url: tab.url, title: tab.title, active: tab.active })),
    count: tabs.length,
  };
}

export async function tabSwitch(api, { index }) {
  const tabs = await getWindowTabs(api);
  if (index < 0 || index >= tabs.length) {
    return { success: false, error: `Tab index ${index} out of range (0-${tabs.length - 1})` };
  }
  const target = tabs[index];
  await api.tabs.update(target.id, { active: true });
  return { success: true, index, url: target.url, title: target.title };
}

export async function tabNew(api, { url }) {
  const target = normalizeNavigationUrl(url);
  if (!target.ok) {
    return { success: false, error: target.error };
  }
  const windowId = await getActiveTab(api).then((tab) => tab.windowId, () => undefined);
  const created = await api.tabs.create({ url: target.url, ...(windowId === undefined ? {} : { windowId }) });
  if (target.url !== 'about:blank') {
    await waitForTabComplete(api, created.id, { timeoutMs: NAVIGATION_WAIT_MS, expectNavigation: true });
  }
  const tab = await api.tabs.get(created.id);
  // `id` es la clave del protocolo para correlacionar la respuesta: el id de la
  // pestaña va como tab_id.
  return { success: true, index: tab.index, tab_id: tab.id, url: tab.url, title: tab.title };
}

export async function tabClose(api, { index }) {
  const tabs = await getWindowTabs(api);
  if (tabs.length <= 1) {
    return { success: false, error: 'Cannot close the last tab' };
  }
  let targetIndex;
  if (index === undefined) {
    const activeIndex = tabs.findIndex((tab) => tab.active);
    targetIndex = activeIndex === -1 ? tabs.length - 1 : activeIndex;
  } else if (index < 0 || index >= tabs.length) {
    return { success: false, error: `Tab index ${index} out of range` };
  } else {
    targetIndex = index;
  }
  await api.tabs.remove(tabs[targetIndex].id);
  return { success: true, closed_index: targetIndex, remaining_tabs: tabs.length - 1 };
}
