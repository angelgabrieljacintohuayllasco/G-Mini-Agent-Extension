/**
 * Enrutador de mensajes del núcleo.
 *
 * Recibe el texto crudo de cada frame y devuelve el frame de respuesta (o
 * null si no corresponde responder). No conoce el WebSocket ni el navegador:
 * los manejadores se inyectan, lo que permite probarlo en Node.
 */
import { EVENTS, isPlainObject, parseIncomingFrame, readCommandEnvelope } from '../shared/protocol.js';

export function createCommandRouter({ handlers, onCommandSettled = () => {}, now = () => Date.now(), log = console }) {
  async function handleFrame(frameText) {
    const frame = parseIncomingFrame(frameText);
    if (!frame.ok) {
      log.warn(`[G-Mini] Mensaje del núcleo descartado: ${frame.reason}`);
      return null;
    }
    if (frame.event === EVENTS.ping) {
      return { event: EVENTS.pong, data: { ts: now() } };
    }
    if (frame.event === EVENTS.command) {
      return executeCommand(frame.data);
    }
    return null;
  }

  async function executeCommand(data) {
    const startedAt = now();
    const envelope = readCommandEnvelope(data);
    if (!envelope.answerable) {
      log.warn(`[G-Mini] Comando descartado: ${envelope.reason}`);
      return null;
    }
    const result = envelope.ok ? await runHandler(envelope) : { success: false, error: envelope.error };
    reportSettled({
      id: envelope.id,
      command: envelope.command,
      params: envelope.params ?? {},
      result,
      startedAt,
      finishedAt: now(),
    });
    // El id va al final para que ningún resultado pueda reemplazarlo.
    return { event: EVENTS.response, data: { ...result, id: envelope.id } };
  }

  async function runHandler({ command, params }) {
    if (!Object.hasOwn(handlers, command)) {
      return { success: false, error: `Command not implemented: ${command}` };
    }
    try {
      return normalizeResult(await handlers[command](params));
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  }

  function reportSettled(event) {
    try {
      onCommandSettled(event);
    } catch (error) {
      log.warn(`[G-Mini] No se pudo registrar la actividad: ${error.message}`);
    }
  }

  return { handleFrame };
}

function normalizeResult(result) {
  if (!isPlainObject(result)) {
    return { success: false, error: 'Command returned no result' };
  }
  return { ...result, success: result.success === true };
}
