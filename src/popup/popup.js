import { ACTIVITY_LIMIT } from '../shared/activity.js';
import { api } from '../shared/browser-api.js';
import { CONNECTION_STATES, UI_MESSAGES } from '../shared/messages.js';
import { checkServerUrl, loadSettings, saveSettings, SETTINGS_KEY } from '../shared/settings.js';
import { describeConnection, formatClock } from '../shared/status.js';
import { byId, createElement, setFieldError, showNotice } from '../ui/dom.js';

const view = {
  statusCard: byId('status-card'),
  statusLabel: byId('status-label'),
  statusDetail: byId('status-detail'),
  enabledToggle: byId('enabled-toggle'),
  testButton: byId('test-connection'),
  testLabel: byId('test-connection-label'),
  reconnectButton: byId('reconnect'),
  reconnectLabel: byId('reconnect-label'),
  testResult: byId('test-result'),
  serverForm: byId('server-form'),
  serverInput: byId('server-url'),
  serverHint: byId('server-hint'),
  serverError: byId('server-error'),
  openOptions: byId('open-options'),
  activityList: byId('activity-list'),
  activityEmpty: byId('activity-empty'),
  activityCount: byId('activity-count'),
  version: byId('version'),
};

const DEFAULT_HINT = view.serverHint.textContent;
const HINT_RESET_MS = 2500;

let status = null;
let settings = null;
let testInProgress = false;
let lastStatusKey = null;

function renderStatus() {
  const description = describeConnection(status);
  // Un resultado de prueba deja de ser cierto cuando cambia el estado.
  if (description.key !== lastStatusKey && !testInProgress) {
    showNotice(view.testResult);
  }
  lastStatusKey = description.key;
  view.statusCard.dataset.tone = description.tone;
  view.statusLabel.textContent = description.label;
  view.statusDetail.textContent = description.detail;

  const state = status?.state;
  const canRetry = state === CONNECTION_STATES.waiting || state === CONNECTION_STATES.idle;
  view.reconnectButton.hidden = !(canRetry || state === CONNECTION_STATES.displaced);
  view.reconnectLabel.textContent = state === CONNECTION_STATES.displaced ? 'Conectar aquí' : 'Reintentar ahora';
}

function renderActivityItem(entry) {
  const item = createElement('li', { className: 'activity-item' });
  item.append(
    createElement('span', { className: 'activity-action', text: entry.label }),
    createElement('span', {
      className: `badge ${entry.ok ? 'badge-success' : 'badge-danger'}`,
      text: entry.ok ? 'OK' : 'Error',
    }),
    createElement('span', { className: 'activity-target mono', text: entry.target || '—', title: entry.target }),
    createElement('time', {
      className: 'activity-time',
      text: formatClock(entry.at, { withSeconds: true }),
      attributes: { datetime: new Date(entry.at).toISOString() },
    }),
  );
  if (!entry.ok && entry.error) {
    item.append(createElement('span', { className: 'activity-error', text: entry.error, title: entry.error }));
  }
  return item;
}

function renderActivity(entries) {
  view.activityList.replaceChildren(...entries.map(renderActivityItem));
  view.activityList.hidden = entries.length === 0;
  view.activityEmpty.hidden = entries.length > 0;
  view.activityCount.textContent = `${entries.length} de ${ACTIVITY_LIMIT}`;
}

function renderSettings() {
  view.enabledToggle.checked = settings.enabled;
  if (document.activeElement !== view.serverInput) {
    view.serverInput.value = settings.serverUrl;
  }
}

function applyState(state) {
  if (state.status !== undefined) {
    status = state.status;
    renderStatus();
  }
  if (Array.isArray(state.activity)) {
    renderActivity(state.activity);
  }
}

async function requestBackground(type) {
  const response = await api.runtime.sendMessage({ type });
  if (response?.error) {
    throw new Error(response.error);
  }
  return response;
}

async function testConnection() {
  testInProgress = true;
  view.testButton.disabled = true;
  view.testLabel.textContent = 'Probando…';
  showNotice(view.testResult);
  try {
    const result = await requestBackground(UI_MESSAGES.testConnection);
    renderStatus();
    showNotice(view.testResult, { tone: result.tone, message: result.message });
  } catch (error) {
    showNotice(view.testResult, { tone: 'danger', message: `No se pudo probar la conexión: ${error.message}` });
  } finally {
    testInProgress = false;
    view.testButton.disabled = false;
    view.testLabel.textContent = 'Probar conexión';
  }
}

async function saveServerUrl(event) {
  event.preventDefault();
  const check = checkServerUrl(view.serverInput.value, { allowRemote: settings.allowRemoteServer });
  if (!check.ok) {
    setFieldError(view.serverInput, view.serverError, check.message);
    return;
  }
  setFieldError(view.serverInput, view.serverError, null);
  settings = await saveSettings(api.storage.local, { serverUrl: check.url });
  view.serverInput.value = settings.serverUrl;
  view.serverHint.textContent = 'Guardado. La extensión se reconecta con la nueva dirección.';
  setTimeout(() => {
    view.serverHint.textContent = DEFAULT_HINT;
  }, HINT_RESET_MS);
}

function wireEvents() {
  view.enabledToggle.addEventListener('change', async () => {
    settings = await saveSettings(api.storage.local, { enabled: view.enabledToggle.checked });
    showNotice(view.testResult);
  });
  view.testButton.addEventListener('click', testConnection);
  view.reconnectButton.addEventListener('click', () => {
    showNotice(view.testResult);
    requestBackground(UI_MESSAGES.reconnect).catch((error) =>
      showNotice(view.testResult, { tone: 'danger', message: `No se pudo reconectar: ${error.message}` }),
    );
  });
  view.serverForm.addEventListener('submit', (event) => {
    saveServerUrl(event).catch((error) => setFieldError(view.serverInput, view.serverError, error.message));
  });
  view.serverInput.addEventListener('input', () => setFieldError(view.serverInput, view.serverError, null));
  view.openOptions.addEventListener('click', () => api.runtime.openOptionsPage());

  api.runtime.onMessage.addListener((message) => {
    if (message?.type === UI_MESSAGES.stateChanged) {
      applyState(message);
    }
  });
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[SETTINGS_KEY]) {
      loadSettings(api.storage.local).then((next) => {
        settings = next;
        renderSettings();
      });
    }
  });
}

async function init() {
  view.version.textContent = `v${api.runtime.getManifest().version}`;
  wireEvents();
  settings = await loadSettings(api.storage.local);
  renderSettings();
  applyState(await requestBackground(UI_MESSAGES.getState));
  // Mantiene al día la cuenta regresiva del próximo intento.
  setInterval(renderStatus, 1000);
}

init().catch((error) => {
  view.statusCard.dataset.tone = 'danger';
  view.statusLabel.textContent = 'Error';
  view.statusDetail.textContent = `No se pudo leer el estado de la extensión: ${error.message}`;
});
