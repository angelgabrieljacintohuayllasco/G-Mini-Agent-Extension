/**
 * Uso interno de go_back/go_forward: recorre el historial desde la página.
 * history.back() no está sujeto a la intervención de Chromium que hace fallar
 * a tabs.goBack con páginas abiertas sin interacción del usuario.
 */
export async function traverseHistory({ direction }) {
  if (direction === 'forward') {
    history.forward();
  } else {
    history.back();
  }
  return { success: true };
}
