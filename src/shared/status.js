/**
 * Traduce el estado técnico de la conexión al estado que ve la persona.
 *
 *   Conectado     el núcleo está conectado y puede operar el navegador
 *   Reconectando  se perdió la conexión o está intentando por primera vez
 *   Sin app       varios intentos sin respuesta: G-Mini Agent no está abierto
 *   Error         algo requiere atención (otra instancia, dirección no válida)
 *   En pausa      la persona desactivó la conexión
 */
import { CONNECTION_STATES as STATES, PERSISTENT_FAILURE_THRESHOLD } from './messages.js';

export function formatClock(timestamp, { withSeconds = false } = {}) {
  if (!timestamp) {
    return '';
  }
  return new Date(timestamp).toLocaleTimeString('es', {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  });
}

function secondsUntil(timestamp, now) {
  return Math.max(1, Math.ceil((timestamp - now) / 1000));
}

function describeRetry(status, now) {
  const nextStep =
    status.state === STATES.waiting && status.nextRetryAt
      ? `Nuevo intento en ${secondsUntil(status.nextRetryAt, now)} s.`
      : 'Intentando conectar…';
  if (status.attempt >= PERSISTENT_FAILURE_THRESHOLD) {
    return {
      key: 'no-app',
      tone: 'neutral',
      label: 'Sin app',
      detail: `G-Mini Agent no responde. ${nextStep}`,
    };
  }
  return { key: 'reconnecting', tone: 'warning', label: 'Reconectando', detail: nextStep };
}

export function describeConnection(status, now = Date.now()) {
  if (!status) {
    return { key: 'unknown', tone: 'neutral', label: 'Sin datos', detail: 'Leyendo el estado de la extensión…' };
  }
  switch (status.state) {
    case STATES.open:
      return { key: 'connected', tone: 'success', label: 'Conectado', detail: `Desde las ${formatClock(status.connectedAt)}.` };
    case STATES.disabled:
      return { key: 'paused', tone: 'paused', label: 'En pausa', detail: 'No se conectará hasta que la reactives.' };
    case STATES.blocked:
      return { key: 'error', tone: 'danger', label: 'Error', detail: status.lastError ?? 'La dirección del servidor no es válida.' };
    case STATES.displaced:
      return {
        key: 'error',
        tone: 'danger',
        label: 'Error',
        detail: 'Otro navegador o perfil tomó la conexión con G-Mini Agent.',
      };
    default:
      return describeRetry(status, now);
  }
}
