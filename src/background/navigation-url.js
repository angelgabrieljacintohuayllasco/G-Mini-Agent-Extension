/**
 * Normaliza la URL que pide el núcleo antes de navegar.
 *
 * El agente a veces envía "example.com" o "localhost:3000" sin esquema. Pasado
 * tal cual a tabs.update, el navegador lo resuelve como ruta relativa a la
 * extensión y abre una página de error. Aquí se completa el esquema y se
 * rechazan los esquemas que ejecutan código (javascript:, vbscript:): ejecutar
 * scripts solo es posible con el comando `eval`.
 */

const BLOCKED_SCHEMES = new Set(['javascript', 'vbscript']);
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const HOST_WITH_PORT = /^[a-z0-9.-]+:\d{1,5}(?:[/?#]|$)/i;
const HOST_LIKE = /^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+|\[[0-9a-f:.]+\])(?::\d{1,5})?(?:[/?#]|$)/i;
const PLAIN_HTTP_HOST = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])(?::\d+)?(?:[/?#]|$)/i;

export function normalizeNavigationUrl(input) {
  const candidate = String(input ?? '').trim();
  if (!candidate) {
    return { ok: false, error: 'Invalid URL: empty' };
  }
  if (candidate.startsWith('//')) {
    return finalize(`https:${candidate}`);
  }
  const scheme = HOST_WITH_PORT.test(candidate) ? null : SCHEME.exec(candidate)?.[1];
  if (scheme) {
    return finalize(candidate);
  }
  if (HOST_LIKE.test(candidate)) {
    // Las IP y localhost casi nunca tienen certificado: se abren por http.
    const prefix = PLAIN_HTTP_HOST.test(candidate) ? 'http://' : 'https://';
    return finalize(`${prefix}${candidate}`);
  }
  return { ok: false, error: `Invalid URL: ${candidate.slice(0, 200)}` };
}

function finalize(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: `Invalid URL: ${rawUrl.slice(0, 200)}` };
  }
  const scheme = parsed.protocol.slice(0, -1).toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme)) {
    return { ok: false, error: `Blocked URL scheme: ${scheme}` };
  }
  return { ok: true, url: parsed.href };
}
