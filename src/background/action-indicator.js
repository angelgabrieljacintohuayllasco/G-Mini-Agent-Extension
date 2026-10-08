/**
 * Indicador en el icono de la barra: el título siempre describe el estado y
 * la insignia "ON" aparece solo mientras G-Mini Agent tiene el control del
 * navegador, para que se note a simple vista.
 */
const CONNECTED_BADGE = Object.freeze({ text: 'ON', background: '#3563e9', foreground: '#ffffff' });

export async function updateActionIndicator(api, view, log = console) {
  const action = api.action;
  if (!action) {
    return;
  }
  const connected = view.key === 'connected';
  try {
    await action.setTitle({ title: `G-Mini Agent Bridge: ${view.label}` });
    await action.setBadgeText({ text: connected ? CONNECTED_BADGE.text : '' });
    if (connected) {
      await action.setBadgeBackgroundColor({ color: CONNECTED_BADGE.background });
      await action.setBadgeTextColor?.({ color: CONNECTED_BADGE.foreground });
    }
  } catch (error) {
    log.warn(`[G-Mini] No se pudo actualizar el icono: ${error.message}`);
  }
}
