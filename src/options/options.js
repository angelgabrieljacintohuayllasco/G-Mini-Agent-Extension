import { api } from '../shared/browser-api.js';
import { detectBrowser } from '../shared/browser-info.js';
import { UI_MESSAGES } from '../shared/messages.js';
import {
  checkServerUrl,
  DEFAULT_SERVER_URL,
  loadSettings,
  resetSettings,
  saveSettings,
  SETTINGS_KEY,
} from '../shared/settings.js';
import { describeConnection } from '../shared/status.js';
import { byId, setFieldError, showNotice } from '../ui/dom.js';

const view = {
  statusPill: byId('status-pill'),
  statusPillLabel: byId('status-pill-label'),
  statusDetail: byId('status-detail'),
  enabledToggle: byId('enabled-toggle'),
  portForm: byId('port-form'),
  portInput: byId('port-input'),
  portError: byId('port-error'),
  serverForm: byId('server-form'),
  serverInput: byId('server-url'),
  serverErrorRow: byId('server-error-row'),
  serverError: byId('server-error'),
  requestRemote: byId('request-remote'),
  remoteToggle: byId('remote-toggle'),
  testButton: byId('test-connection'),
  testLabel: byId('test-connection-label'),
  testResult: byId('test-result'),
  activitySummary: byId('activity-summary'),
  clearActivity: byId('clear-activity'),
  resetButton: byId('reset-settings'),
  resetResult: byId('reset-result'),
  remoteDialog: byId('remote-dialog'),
  remoteDialogWarning: byId('remote-dialog-warning'),
  resetDialog: byId('reset-dialog'),
  resetDefaultUrl: byId('reset-default-url'),
  factVersion: byId('fact-version'),
  factBrowser: byId('fact-browser'),
  factExtensionId: byId('fact-extension-id'),
};

let settings = null;
let status = null;
let testInProgress = false;
let lastStatusKey = null;
// Dirección remota que la persona intentó guardar antes de permitirla.
let pendingRemoteUrl = null;

function portOf(serverUrl) {
  try {
    const parsed = new URL(serverUrl);
    return parsed.port || (parsed.protocol === 'wss:' ? '443' : '80');
  } catch {
    return '';
  }
}

function renderSettings() {
  view.enabledToggle.checked = settings.enabled;
  view.remoteToggle.checked = settings.allowRemoteServer;
  if (document.activeElement !== view.serverInput) {
    view.serverInput.value = settings.serverUrl;
  }
  if (document.activeElement !== view.portInput) {
    view.portInput.value = portOf(settings.serverUrl);
  }
}

function renderStatus() {
  const description = describeConnection(status);
  // Un resultado de prueba deja de ser cierto cuando cambia el estado.
  if (description.key !== lastStatusKey && !testInProgress) {
    showNotice(view.testResult);
  }
  lastStatusKey = description.key;
  view.statusPill.dataset.tone = description.tone;
  view.statusPillLabel.textContent = description.label;
  view.statusDetail.textContent = description.detail;
}

function renderActivitySummary(entries) {
  const count = entries.length;
  view.activitySummary.textContent = count === 0 ? 'Ninguna.' : `${count} ${count === 1 ? 'acción' : 'acciones'} en esta sesión.`;
  view.clearActivity.disabled = count === 0;
}

function applyState(state) {
  if (state.status !== undefined) {
    status = state.status;
    renderStatus();
  }
  if (Array.isArray(state.activity)) {
    renderActivitySummary(state.activity);
  }
}

async function requestBackground(type) {
  const response = await api.runtime.sendMessage({ type });
  if (response?.error) {
    throw new Error(response.error);
  }
  return response;
}

/** Abre un diálogo modal y resuelve true si la persona confirma. */
function confirmWithDialog(dialog) {
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.returnValue = '';
    dialog.showModal();
  });
}

async function confirmRemote(url) {
  const check = url ? checkServerUrl(url, { allowRemote: true }) : null;
  const unencrypted = check?.ok && !check.isLocal && !check.isEncrypted;
  showNotice(view.remoteDialogWarning, {
    tone: 'warning',
    message: unencrypted ? 'Esta dirección usa ws:// sin cifrado: el tráfico viaja en claro por la red.' : '',
  });
  return confirmWithDialog(view.remoteDialog);
}

function showServerError(message, { offerRemote = false } = {}) {
  setFieldError(view.serverInput, view.serverError, message);
  view.serverErrorRow.hidden = !message;
  view.requestRemote.hidden = !offerRemote;
}

async function saveServerUrl(rawUrl) {
  const check = checkServerUrl(rawUrl, { allowRemote: settings.allowRemoteServer });
  if (!check.ok) {
    pendingRemoteUrl = check.reason === 'remote' ? rawUrl : null;
    showServerError(check.message, { offerRemote: check.reason === 'remote' });
    return false;
  }
  showServerError(null);
  settings = await saveSettings(api.storage.local, { serverUrl: check.url });
  renderSettings();
  return true;
}

async function allowRemoteAndSave() {
  const url = pendingRemoteUrl;
  if (!(await confirmRemote(url))) {
    return;
  }
  settings = await saveSettings(api.storage.local, { allowRemoteServer: true });
  pendingRemoteUrl = null;
  if (url) {
    await saveServerUrl(url);
  }
  renderSettings();
}

async function savePort(event) {
  event.preventDefault();
  const raw = view.portInput.value.trim();
  const port = Number(raw);
  if (!/^\d{1,5}$/.test(raw) || port < 1 || port > 65535) {
    setFieldError(view.portInput, view.portError, 'Escribe un número entre 1 y 65535.');
    return;
  }
  setFieldError(view.portInput, view.portError, null);
  let base;
  try {
    base = new URL(settings.serverUrl);
  } catch {
    base = new URL(DEFAULT_SERVER_URL);
  }
  base.port = String(port);
  await saveServerUrl(base.href);
}

async function toggleRemote() {
  if (!view.remoteToggle.checked) {
    settings = await saveSettings(api.storage.local, { allowRemoteServer: false });
    return;
  }
  // El cambio solo se guarda si la persona lo confirma en el diálogo.
  view.remoteToggle.checked = false;
  if (await confirmRemote(pendingRemoteUrl)) {
    settings = await saveSettings(api.storage.local, { allowRemoteServer: true });
    renderSettings();
  }
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

async function resetToDefaults() {
  if (!(await confirmWithDialog(view.resetDialog))) {
    return;
  }
  settings = await resetSettings(api.storage.local);
  pendingRemoteUrl = null;
  showServerError(null);
  setFieldError(view.portInput, view.portError, null);
  view.serverInput.value = settings.serverUrl;
  view.portInput.value = portOf(settings.serverUrl);
  renderSettings();
  showNotice(view.resetResult, { tone: 'success', message: 'Se restableció la configuración predeterminada.' });
}

function reportFailure(target) {
  return (error) => showNotice(target, { tone: 'danger', message: error.message });
}

function wireEvents() {
  view.enabledToggle.addEventListener('change', () => {
    saveSettings(api.storage.local, { enabled: view.enabledToggle.checked })
      .then((next) => {
        settings = next;
      })
      .catch(reportFailure(view.testResult));
  });
  view.portForm.addEventListener('submit', (event) => {
    savePort(event).catch((error) => setFieldError(view.portInput, view.portError, error.message));
  });
  view.serverForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveServerUrl(view.serverInput.value).catch((error) => showServerError(error.message));
  });
  view.serverInput.addEventListener('input', () => showServerError(null));
  view.portInput.addEventListener('input', () => setFieldError(view.portInput, view.portError, null));
  view.requestRemote.addEventListener('click', () => allowRemoteAndSave().catch((error) => showServerError(error.message)));
  view.remoteToggle.addEventListener('change', () => toggleRemote().catch(reportFailure(view.testResult)));
  view.testButton.addEventListener('click', testConnection);
  view.clearActivity.addEventListener('click', () => {
    requestBackground(UI_MESSAGES.clearActivity).catch(reportFailure(view.testResult));
  });
  view.resetButton.addEventListener('click', () => resetToDefaults().catch(reportFailure(view.resetResult)));

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

async function renderDiagnostics() {
  view.factVersion.textContent = api.runtime.getManifest().version;
  view.factExtensionId.textContent = api.runtime.id;
  const browser = await detectBrowser(api);
  view.factBrowser.textContent = [browser.name, browser.version].filter(Boolean).join(' ');
}

async function init() {
  view.resetDefaultUrl.textContent = DEFAULT_SERVER_URL;
  wireEvents();
  settings = await loadSettings(api.storage.local);
  renderSettings();
  applyState(await requestBackground(UI_MESSAGES.getState));
  await renderDiagnostics();
  setInterval(renderStatus, 1000);
}

init().catch((error) => {
  view.statusPill.dataset.tone = 'danger';
  view.statusPillLabel.textContent = 'Error';
  view.statusDetail.textContent = `No se pudo leer el estado de la extensión: ${error.message}`;
});
