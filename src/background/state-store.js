/**
 * Estado visible para la UI: la conexión y las últimas acciones.
 *
 * La actividad se guarda en storage.session cuando existe: sobrevive a los
 * reinicios del service worker pero se borra al cerrar el navegador y nunca
 * se escribe en disco.
 */
import { ACTIVITY_LIMIT, appendActivity } from '../shared/activity.js';

const ACTIVITY_KEY = 'activity';

export function createStateStore({ sessionArea, onChange, log = console }) {
  let status = null;
  let activity = [];

  const snapshot = () => ({ status, activity });
  const notify = () => onChange(snapshot());

  function persistActivity() {
    if (!sessionArea) {
      return;
    }
    sessionArea.set({ [ACTIVITY_KEY]: activity }).catch((error) => {
      log.warn(`[G-Mini] No se pudo guardar la actividad: ${error.message}`);
    });
  }

  return {
    snapshot,

    async restore() {
      if (!sessionArea) {
        return;
      }
      const stored = await sessionArea.get(ACTIVITY_KEY);
      if (Array.isArray(stored?.[ACTIVITY_KEY])) {
        activity = stored[ACTIVITY_KEY].slice(0, ACTIVITY_LIMIT);
      }
    },

    setStatus(nextStatus) {
      status = nextStatus;
      notify();
    },

    addActivity(entry) {
      activity = appendActivity(activity, entry);
      persistActivity();
      notify();
    },

    clearActivity() {
      activity = [];
      persistActivity();
      notify();
    },
  };
}
