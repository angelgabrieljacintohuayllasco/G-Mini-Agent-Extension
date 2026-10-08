/**
 * API de extensiones falsa para probar los comandos sin navegador. Las cargas
 * de página emiten onUpdated de forma asíncrona, como en Chrome y Firefox.
 */

const LOAD_STEP_MS = 5;

function createEvent() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => [...listeners].forEach((listener) => listener(...args)),
    size: () => listeners.size,
  };
}

export function createFakeBrowser({ tabs, focusedWindowId = 1, downloads = [], contentScript = null, history = {} }) {
  const calls = [];
  let nextTabId = 100;
  const onUpdated = createEvent();
  const onRemoved = createEvent();
  const findTab = (tabId) => tabs.find((tab) => tab.id === tabId);

  function simulateLoad(tab, url) {
    setTimeout(() => {
      tab.status = 'loading';
      tab.url = url;
      onUpdated.emit(tab.id, { status: 'loading', url }, { ...tab });
      setTimeout(() => {
        tab.status = 'complete';
        tab.title = `Título de ${url}`;
        onUpdated.emit(tab.id, { status: 'complete' }, { ...tab });
      }, LOAD_STEP_MS);
    }, LOAD_STEP_MS);
  }

  const api = {
    tabs: {
      async query(query) {
        return tabs
          .filter((tab) => !query.lastFocusedWindow || tab.windowId === focusedWindowId)
          .filter((tab) => query.windowId === undefined || tab.windowId === query.windowId)
          .filter((tab) => !query.active || tab.active)
          .map((tab) => ({ ...tab }));
      },
      async get(tabId) {
        const tab = findTab(tabId);
        if (!tab) {
          throw new Error(`No tab with id: ${tabId}.`);
        }
        return { ...tab };
      },
      async update(tabId, properties) {
        calls.push(['tabs.update', tabId, properties]);
        const tab = findTab(tabId);
        if (properties.active) {
          tabs.filter((other) => other.windowId === tab.windowId).forEach((other) => {
            other.active = other.id === tabId;
          });
        }
        if (properties.url) {
          simulateLoad(tab, properties.url);
        }
        return { ...tab };
      },
      async create(properties) {
        calls.push(['tabs.create', properties]);
        const windowTabs = tabs.filter((tab) => tab.windowId === (properties.windowId ?? focusedWindowId));
        const tab = { id: nextTabId++, windowId: properties.windowId ?? focusedWindowId, index: windowTabs.length, active: true, status: 'complete', url: 'about:blank', title: '' };
        tabs.push(tab);
        if (properties.url !== 'about:blank') {
          simulateLoad(tab, properties.url);
        }
        return { ...tab };
      },
      async remove(tabId) {
        calls.push(['tabs.remove', tabId]);
        tabs.splice(tabs.indexOf(findTab(tabId)), 1);
        onRemoved.emit(tabId);
      },
      async captureVisibleTab(windowId, options) {
        calls.push(['tabs.captureVisibleTab', windowId, options]);
        return 'data:image/png;base64,iVBORw0KGgo=';
      },
      async sendMessage(tabId, message) {
        if (!contentScript) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        calls.push(['tabs.sendMessage', tabId, message.action, message.params]);
        return contentScript(message, { tab: findTab(tabId), simulateLoad });
      },
      async goBack(tabId) {
        calls.push(['tabs.goBack', tabId]);
        if (!history.back) {
          throw new Error('Cannot find a next page in history.');
        }
        simulateLoad(findTab(tabId), history.back);
      },
      onUpdated,
      onRemoved,
    },
    windows: {
      async getLastFocused() {
        return { id: focusedWindowId };
      },
    },
    scripting: {
      async executeScript() {
        throw new Error('Cannot access contents of url "chrome://newtab/".');
      },
    },
    downloads: {
      async search(query) {
        calls.push(['downloads.search', query]);
        return downloads.slice(0, query.limit);
      },
    },
  };
  return { api, calls, tabs, onUpdated, onRemoved };
}
