/**
 * Ajustes de la extensión y la política de servidores.
 *
 * Los ajustes viven en `storage.local` bajo una sola clave. El fondo los lee al
 * arrancar y reacciona a `storage.onChanged`; el popup y las opciones solo
 * escriben. Por defecto solo se aceptan servidores en la propia máquina
 * (loopback); un servidor remoto exige que el usuario lo permita en Opciones.
 */
import { isPlainObject } from './protocol.js';

export const SETTINGS_KEY = 'settings';
export const DEFAULT_SERVER_URL = 'ws://127.0.0.1:8765/ws/extension';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  serverUrl: DEFAULT_SERVER_URL,
  allowRemoteServer: false,
});

const SERVER_URL_MESSAGES = Object.freeze({
  empty: 'Escribe la dirección del servidor.',
  invalid: 'La dirección no es válida.',
  scheme: 'La dirección debe empezar con ws:// o wss://.',
  credentials: 'No incluyas usuario ni contraseña en la dirección.',
  fragment: 'La dirección no puede llevar un fragmento (#).',
  remote: 'Es un servidor remoto. Permítelo en Opciones para usarlo.',
});

const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/;

export function isLoopbackHost(hostname) {
  const host = String(hostname).toLowerCase();
  return host === 'localhost' || host === '[::1]' || host === '::1' || IPV4_LOOPBACK.test(host);
}

/**
 * Valida la dirección del núcleo. Devuelve la URL normalizada o el motivo del
 * rechazo con un mensaje listo para mostrar.
 */
export function checkServerUrl(input, { allowRemote = false } = {}) {
  const candidate = typeof input === 'string' ? input.trim() : '';
  if (!candidate) {
    return rejectServerUrl('empty');
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return rejectServerUrl('invalid');
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return rejectServerUrl('scheme');
  }
  if (parsed.username || parsed.password) {
    return rejectServerUrl('credentials');
  }
  if (parsed.hash) {
    return rejectServerUrl('fragment');
  }
  const isLocal = isLoopbackHost(parsed.hostname);
  if (!isLocal && !allowRemote) {
    return rejectServerUrl('remote');
  }
  return { ok: true, url: parsed.href, isLocal, isEncrypted: parsed.protocol === 'wss:' };
}

function rejectServerUrl(reason) {
  return { ok: false, reason, message: SERVER_URL_MESSAGES[reason] };
}

export function normalizeSettings(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const serverUrl = typeof source.serverUrl === 'string' ? source.serverUrl.trim() : '';
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_SETTINGS.enabled,
    serverUrl: serverUrl || DEFAULT_SETTINGS.serverUrl,
    allowRemoteServer: source.allowRemoteServer === true,
  };
}

/**
 * Traduce los ajustes a lo que necesita la conexión: si debe conectarse, a qué
 * URL, o por qué no puede hacerlo. El fondo aplica la política aunque la UI ya
 * la haya validado.
 */
export function resolveConnectionTarget(settings) {
  if (!settings.enabled) {
    return { enabled: false, url: null, blockedReason: null };
  }
  const check = checkServerUrl(settings.serverUrl, { allowRemote: settings.allowRemoteServer });
  if (!check.ok) {
    return { enabled: true, url: null, blockedReason: check.message };
  }
  return { enabled: true, url: check.url, blockedReason: null };
}

export async function loadSettings(storageArea) {
  const stored = await storageArea.get(SETTINGS_KEY);
  return normalizeSettings(stored?.[SETTINGS_KEY]);
}

export async function saveSettings(storageArea, changes) {
  const current = await loadSettings(storageArea);
  const next = normalizeSettings({ ...current, ...changes });
  await storageArea.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function resetSettings(storageArea) {
  const defaults = { ...DEFAULT_SETTINGS };
  await storageArea.set({ [SETTINGS_KEY]: defaults });
  return defaults;
}
