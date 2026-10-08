/**
 * Registro de actividad que muestra el popup.
 *
 * Solo se guarda qué se hizo y sobre qué (URL sin parámetros, selector, tecla,
 * número de pestaña). El texto que se escribe en formularios y el contenido de
 * los scripts nunca entran al registro.
 */

export const ACTIVITY_LIMIT = 20;

const MAX_TARGET_LENGTH = 120;
const MAX_ERROR_LENGTH = 200;

export const COMMAND_LABELS = Object.freeze({
  navigate: 'Navegar',
  go_back: 'Atrás',
  go_forward: 'Adelante',
  wait_load: 'Esperar carga',
  click: 'Clic',
  type: 'Escribir',
  fill: 'Rellenar',
  press: 'Tecla',
  scroll: 'Desplazar',
  hover: 'Pasar el cursor',
  select: 'Seleccionar opción',
  wait_for: 'Esperar elemento',
  remove_overlays: 'Quitar superposiciones',
  extract: 'Extraer texto',
  get_dom: 'Leer DOM',
  snapshot: 'Instantánea',
  eval: 'Ejecutar script',
  screenshot: 'Captura de pantalla',
  page_info: 'Información de página',
  tabs_list: 'Listar pestañas',
  tab_switch: 'Cambiar de pestaña',
  tab_new: 'Nueva pestaña',
  tab_close: 'Cerrar pestaña',
  downloads_list: 'Listar descargas',
});

const SCROLL_DIRECTIONS = Object.freeze({
  down: 'abajo',
  up: 'arriba',
  left: 'izquierda',
  right: 'derecha',
});

export function truncate(value, maxLength = MAX_TARGET_LENGTH) {
  const textValue = String(value ?? '');
  return textValue.length > maxLength ? `${textValue.slice(0, maxLength - 1)}…` : textValue;
}

function stripQueryAndFragment(value) {
  return String(value).split(/[?#]/, 1)[0];
}

/** Host y ruta de una URL, sin parámetros ni fragmento (pueden llevar tokens). */
export function summarizeUrl(rawUrl) {
  if (!rawUrl) {
    return '';
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return truncate(stripQueryAndFragment(rawUrl));
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return truncate(`${parsed.host}${path}`);
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'javascript:') {
    return parsed.protocol;
  }
  return truncate(stripQueryAndFragment(rawUrl));
}

function describeTabIndex(index) {
  return index === undefined ? 'pestaña activa' : `pestaña ${index}`;
}

export function describeCommandTarget(command, params = {}) {
  switch (command) {
    case 'navigate':
    case 'tab_new':
      return summarizeUrl(params.url);
    case 'click':
    case 'type':
    case 'fill':
    case 'hover':
    case 'select':
    case 'wait_for':
    case 'extract':
    case 'get_dom':
      return truncate(params.selector);
    case 'press':
      return truncate(params.key);
    case 'scroll':
      return `${SCROLL_DIRECTIONS[params.direction] ?? params.direction} x${params.amount}`;
    case 'tab_switch':
    case 'tab_close':
      return describeTabIndex(params.index);
    case 'eval':
      return `script de ${params.script?.length ?? 0} caracteres`;
    case 'wait_load':
      return `hasta ${Math.round((params.timeout_ms ?? 0) / 1000)} s`;
    case 'downloads_list':
      return `últimas ${params.limit}`;
    default:
      return '';
  }
}

/** Convierte el resultado de un comando en una entrada del registro. */
export function createActivityEntry({ id, command, params, result, startedAt, finishedAt }) {
  const known = Object.hasOwn(COMMAND_LABELS, command);
  const ok = result?.success === true;
  return {
    id,
    command: known ? command : truncate(command, 64),
    label: known ? COMMAND_LABELS[command] : 'Comando desconocido',
    target: known ? describeCommandTarget(command, params) : truncate(command, 64),
    ok,
    error: ok ? null : truncate(result?.error ?? 'Error sin detalle', MAX_ERROR_LENGTH),
    at: startedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
  };
}

export function appendActivity(entries, entry, limit = ACTIVITY_LIMIT) {
  return [entry, ...entries].slice(0, limit);
}
