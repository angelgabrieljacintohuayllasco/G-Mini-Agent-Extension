/** Mensajes internos entre el popup/opciones y el service worker. */
export const UI_MESSAGES = Object.freeze({
  getState: 'gmini:get-state',
  reconnect: 'gmini:reconnect',
  testConnection: 'gmini:test-connection',
  clearActivity: 'gmini:clear-activity',
  stateChanged: 'gmini:state-changed',
});

/** Canal de los mensajes entre el service worker y el content script. */
export const CONTENT_CHANNEL = 'gmini:content';

export const CONNECTION_STATES = Object.freeze({
  disabled: 'disabled',
  blocked: 'blocked',
  idle: 'idle',
  connecting: 'connecting',
  waiting: 'waiting',
  open: 'open',
  displaced: 'displaced',
});

/** A partir de cuántos intentos fallidos seguidos se muestra "Desconectado". */
export const PERSISTENT_FAILURE_THRESHOLD = 3;
