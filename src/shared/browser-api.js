/**
 * Acceso único a la API de extensiones.
 *
 * Firefox y Safari exponen `browser.*` con promesas. Chrome, Edge, Brave,
 * Opera, Vivaldi y el resto de Chromium exponen `chrome.*`, que en Manifest V3
 * también devuelve promesas cuando no se pasa callback. El resto del código
 * usa `api` y nunca toca `chrome` ni `browser` directamente.
 *
 * Se comprueba `runtime.id` y no solo la existencia del global: una página con
 * un elemento `id="browser"` crea `window.browser` en el mundo del content
 * script, y ese objeto no es la API.
 */
function pickExtensionApi() {
  const { browser, chrome } = globalThis;
  if (browser?.runtime?.id) {
    return browser;
  }
  if (chrome?.runtime?.id) {
    return chrome;
  }
  return null;
}

export const api = pickExtensionApi();
