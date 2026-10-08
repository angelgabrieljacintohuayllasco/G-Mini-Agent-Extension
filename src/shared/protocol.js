/**
 * Protocolo entre la extensión y el núcleo de G-Mini Agent.
 *
 * Refleja `backend/automation/extension_bridge.py` del repositorio principal:
 *   núcleo -> extensión: {"event": "ext:command", "data": {"id", "command", "params"}}
 *   extensión -> núcleo: {"event": "ext:response", "data": {"id", "success", ...}}
 *
 * Todo mensaje que llega por el socket pasa por este módulo antes de tocar el
 * navegador: solo se aceptan los comandos de COMMAND_SPECS y sus parámetros se
 * validan y normalizan aquí. La especificación completa está en
 * docs/protocol.md.
 */

export const EVENTS = Object.freeze({
  hello: 'ext:hello',
  command: 'ext:command',
  response: 'ext:response',
  ping: 'ext:ping',
  pong: 'ext:pong',
});

export const FRAME_LIMITS = Object.freeze({
  maxChars: 4 * 1024 * 1024,
  maxIdLength: 128,
  maxReportedCommandLength: 64,
});

const text = (options = {}) => ({ kind: 'text', ...options });
const integer = (options = {}) => ({ kind: 'integer', ...options });
const decimal = (options = {}) => ({ kind: 'decimal', ...options });
const flag = (options = {}) => ({ kind: 'flag', ...options });
const choice = (values, fallback) => ({ kind: 'choice', values, fallback });

const SELECTOR = text({ required: true, maxLength: 4096 });
const SELECTOR_OR_BODY = text({ maxLength: 4096, fallback: 'body', emptyAsMissing: true });
const URL_TEXT = { maxLength: 32768 };

/**
 * Comandos que el núcleo puede pedir y sus parámetros. Los valores por
 * defecto replican los de la extensión original (por ejemplo `amount || 3`),
 * por eso varios campos tratan el 0 como ausente.
 */
export const COMMAND_SPECS = Object.freeze({
  navigate: { url: text({ required: true, ...URL_TEXT }) },
  go_back: {},
  go_forward: {},
  wait_load: { timeout_ms: integer({ min: 0, max: 120000, fallback: 30000, zeroAsMissing: true }) },
  click: { selector: SELECTOR, force: flag({ fallback: false }) },
  type: {
    selector: SELECTOR,
    text: text({ required: true, allowEmpty: true, maxLength: 100000 }),
    clear: flag({ fallback: true }),
  },
  fill: { selector: SELECTOR, text: text({ required: true, allowEmpty: true, maxLength: 1000000 }) },
  press: { key: text({ required: true, maxLength: 64 }) },
  scroll: {
    direction: choice(['down', 'up', 'left', 'right'], 'down'),
    amount: decimal({ min: 0, max: 100, fallback: 3, zeroAsMissing: true }),
  },
  hover: { selector: SELECTOR },
  select: { selector: SELECTOR, value: text({ required: true, allowEmpty: true, maxLength: 4096 }) },
  wait_for: {
    selector: SELECTOR,
    timeout_ms: integer({ min: 0, max: 120000, fallback: 15000, zeroAsMissing: true }),
    state: choice(['visible', 'hidden', 'attached', 'detached'], 'visible'),
  },
  remove_overlays: {},
  extract: { selector: SELECTOR_OR_BODY },
  get_dom: {
    selector: SELECTOR_OR_BODY,
    max_depth: integer({ min: 1, max: 64, fallback: 6, zeroAsMissing: true }),
    max_length: integer({ min: 1, max: 1000000, fallback: 12000, zeroAsMissing: true }),
  },
  snapshot: {},
  eval: { script: text({ required: true, maxLength: 1000000 }) },
  screenshot: {},
  page_info: {},
  tabs_list: {},
  tab_switch: { index: integer({ required: true }) },
  tab_new: { url: text({ fallback: 'about:blank', emptyAsMissing: true, ...URL_TEXT }) },
  tab_close: { index: integer() },
  downloads_list: { limit: integer({ min: 1, max: 1000, fallback: 20, zeroAsMissing: true }) },
});

export const COMMAND_NAMES = Object.freeze(Object.keys(COMMAND_SPECS));

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Convierte un frame de texto en {event, data}. Nunca lanza: un frame inválido
 * se descarta en el router.
 */
export function parseIncomingFrame(frameText) {
  if (typeof frameText !== 'string') {
    return { ok: false, reason: 'binary frames are not supported' };
  }
  if (frameText.length > FRAME_LIMITS.maxChars) {
    return { ok: false, reason: `frame exceeds ${FRAME_LIMITS.maxChars} characters` };
  }
  let message;
  try {
    message = JSON.parse(frameText);
  } catch {
    return { ok: false, reason: 'invalid JSON' };
  }
  if (!isPlainObject(message) || typeof message.event !== 'string') {
    return { ok: false, reason: 'frame without event name' };
  }
  return { ok: true, event: message.event, data: isPlainObject(message.data) ? message.data : {} };
}

/**
 * Lee el `data` de un ext:command. Sin un id válido no hay a quién responder,
 * así que se devuelve `answerable: false` y el router descarta el mensaje.
 */
export function readCommandEnvelope(data) {
  const { id, command } = data;
  if (typeof id !== 'string' || id.length === 0 || id.length > FRAME_LIMITS.maxIdLength) {
    return { ok: false, answerable: false, reason: 'command without a valid id' };
  }
  if (typeof command !== 'string' || !Object.hasOwn(COMMAND_SPECS, command)) {
    const reported = String(command).slice(0, FRAME_LIMITS.maxReportedCommandLength);
    return { ok: false, answerable: true, id, command: reported, error: `Unknown command: ${reported}` };
  }
  const validation = validateCommandParams(command, data.params);
  if (!validation.ok) {
    return { ok: false, answerable: true, id, command, error: validation.error };
  }
  return { ok: true, answerable: true, id, command, params: validation.params };
}

export function validateCommandParams(command, rawParams) {
  const spec = COMMAND_SPECS[command];
  if (rawParams !== undefined && rawParams !== null && !isPlainObject(rawParams)) {
    return { ok: false, error: `Invalid params for '${command}': params must be an object` };
  }
  const source = rawParams ?? {};
  const params = {};
  for (const [name, rule] of Object.entries(spec)) {
    const outcome = readField(rule, source[name]);
    if (outcome.error) {
      return { ok: false, error: `Invalid params for '${command}': '${name}' ${outcome.error}` };
    }
    if (outcome.value !== undefined) {
      params[name] = outcome.value;
    }
  }
  return { ok: true, params };
}

function readField(rule, value) {
  switch (rule.kind) {
    case 'text':
      return readText(rule, value);
    case 'integer':
      return readNumber(rule, value, { integerOnly: true });
    case 'decimal':
      return readNumber(rule, value, { integerOnly: false });
    case 'flag':
      return readFlag(rule, value);
    case 'choice':
      return readChoice(rule, value);
    default:
      throw new Error(`Unknown field kind: ${rule.kind}`);
  }
}

function missing(rule) {
  if (rule.fallback !== undefined) {
    return { value: rule.fallback };
  }
  return rule.required ? { error: 'is required' } : { value: undefined };
}

function readText(rule, value) {
  if (value === undefined || value === null || (value === '' && rule.emptyAsMissing)) {
    return missing(rule);
  }
  const textValue = typeof value === 'number' || typeof value === 'boolean' ? String(value) : value;
  if (typeof textValue !== 'string') {
    return { error: 'must be a string' };
  }
  if (textValue.length === 0 && rule.required && !rule.allowEmpty) {
    return { error: 'must not be empty' };
  }
  if (rule.maxLength !== undefined && textValue.length > rule.maxLength) {
    return { error: `must be at most ${rule.maxLength} characters` };
  }
  return { value: textValue };
}

const NUMERIC_TEXT = /^\s*-?\d+(\.\d+)?\s*$/;

function readNumber(rule, value, { integerOnly }) {
  if (value === undefined || value === null || value === '') {
    return missing(rule);
  }
  let numeric = value;
  if (typeof value === 'string' && NUMERIC_TEXT.test(value)) {
    numeric = Number(value);
  }
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    return { error: integerOnly ? 'must be an integer' : 'must be a number' };
  }
  if (integerOnly) {
    numeric = Math.trunc(numeric);
  }
  if (numeric === 0 && rule.zeroAsMissing) {
    return missing(rule);
  }
  return { value: clamp(numeric, rule.min, rule.max) };
}

function clamp(value, min = -Infinity, max = Infinity) {
  return Math.min(Math.max(value, min), max);
}

const TRUE_VALUES = new Set([true, 1, 'true', '1', 'yes']);
const FALSE_VALUES = new Set([false, 0, 'false', '0', 'no']);

function readFlag(rule, value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (TRUE_VALUES.has(normalized)) {
    return { value: true };
  }
  if (FALSE_VALUES.has(normalized)) {
    return { value: false };
  }
  return missing(rule);
}

function readChoice(rule, value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value;
  return { value: rule.values.includes(normalized) ? normalized : rule.fallback };
}
