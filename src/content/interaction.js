/** Acciones que modifican la página: clic, cursor, escritura, selección y scroll. */
import { createTextEditor } from './editable.js';
import { findElement, notFound } from './selectors.js';
import { FOCUS_SETTLE_MS, SCROLL_SETTLE_MS, sleep } from './timing.js';

// El núcleo espera 15 s por comando: textos largos se escriben por bloques
// para terminar a tiempo (a lo sumo unos 8 s).
const MAX_TYPING_STEPS = 200;
const KEYSTROKE_DELAY_MIN_MS = 15;
const KEYSTROKE_DELAY_SPREAD_MS = 25;
const SCROLL_STEP_PX = 300;

function centerOf(element) {
  const rect = element.getBoundingClientRect();
  return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
}

function pointerInit(element, extra = {}) {
  return { bubbles: true, cancelable: true, composed: true, view: window, ...centerOf(element), ...extra };
}

async function bringIntoView(element) {
  element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
  await sleep(SCROLL_SETTLE_MS);
}

/** Secuencia de un clic real: puntero, ratón, foco y click. */
function pressPointer(element) {
  const down = pointerInit(element, { button: 0, buttons: 1 });
  const up = pointerInit(element, { button: 0, buttons: 0 });
  element.dispatchEvent(new PointerEvent('pointerdown', { ...down, pointerType: 'mouse', isPrimary: true }));
  element.dispatchEvent(new MouseEvent('mousedown', down));
  if (typeof element.focus === 'function') {
    element.focus({ preventScroll: true });
  }
  element.dispatchEvent(new PointerEvent('pointerup', { ...up, pointerType: 'mouse', isPrimary: true }));
  element.dispatchEvent(new MouseEvent('mouseup', up));
}

export async function click({ selector, force }) {
  const element = findElement(selector);
  if (!element) {
    return notFound(selector);
  }
  await bringIntoView(element);
  if (force) {
    // Clic sintético directo: no simula el puntero y atraviesa overlays.
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  } else {
    pressPointer(element);
    element.click();
  }
  return { success: true, tag: element.tagName, text: (element.textContent || '').slice(0, 100) };
}

export async function hover({ selector }) {
  const element = findElement(selector);
  if (!element) {
    return notFound(selector);
  }
  await bringIntoView(element);
  const init = pointerInit(element);
  element.dispatchEvent(new PointerEvent('pointerover', { ...init, pointerType: 'mouse' }));
  element.dispatchEvent(new PointerEvent('pointerenter', { ...init, bubbles: false, pointerType: 'mouse' }));
  element.dispatchEvent(new MouseEvent('mouseover', init));
  element.dispatchEvent(new MouseEvent('mouseenter', { ...init, bubbles: false }));
  element.dispatchEvent(new MouseEvent('mousemove', init));
  return { success: true, tag: element.tagName };
}

function splitForTyping(text) {
  const characters = Array.from(text);
  const size = Math.max(1, Math.ceil(characters.length / MAX_TYPING_STEPS));
  const chunks = [];
  for (let index = 0; index < characters.length; index += size) {
    chunks.push(characters.slice(index, index + size).join(''));
  }
  return chunks;
}

function dispatchKey(element, type, key) {
  element.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, composed: true }));
}

function notEditable(selector) {
  return { success: false, error: `Element is not editable: ${selector}` };
}

export async function type({ selector, text, clear }) {
  const element = findElement(selector);
  if (!element) {
    return notFound(selector);
  }
  const editor = createTextEditor(element);
  if (!editor) {
    return notEditable(selector);
  }
  element.focus();
  await sleep(FOCUS_SETTLE_MS);
  if (clear) {
    editor.clear();
  }
  for (const chunk of splitForTyping(text)) {
    const singleKey = Array.from(chunk).length === 1;
    if (singleKey) {
      dispatchKey(element, 'keydown', chunk);
    }
    editor.insert(chunk);
    if (singleKey) {
      dispatchKey(element, 'keyup', chunk);
    }
    await sleep(KEYSTROKE_DELAY_MIN_MS + Math.random() * KEYSTROKE_DELAY_SPREAD_MS);
  }
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return { success: true, typed: text.length };
}

export async function fill({ selector, text }) {
  const element = findElement(selector);
  if (!element) {
    return notFound(selector);
  }
  const editor = createTextEditor(element);
  if (!editor) {
    return notEditable(selector);
  }
  element.focus();
  await sleep(FOCUS_SETTLE_MS);
  editor.replaceAll(text);
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return { success: true, filled: text.length };
}

function findOption(selectElement, wanted) {
  const options = Array.from(selectElement.options);
  const normalized = wanted.trim().toLowerCase();
  return (
    options.find((option) => option.value === wanted) ??
    options.find((option) => option.label.trim().toLowerCase() === normalized) ??
    options.find((option) => option.text.trim().toLowerCase() === normalized) ??
    null
  );
}

export async function select({ selector, value }) {
  const element = findElement(selector);
  if (!(element instanceof HTMLSelectElement)) {
    return { success: false, error: `Select element not found: ${selector}` };
  }
  const option = findOption(element, value);
  if (!option) {
    return { success: false, error: `Option not found: ${value}` };
  }
  option.selected = true;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return { success: true, selectedValue: element.value };
}

const SCROLL_VECTORS = Object.freeze({
  down: [0, 1],
  up: [0, -1],
  left: [-1, 0],
  right: [1, 0],
});

function canScroll(element, deltaX, deltaY) {
  const style = getComputedStyle(element);
  const scrollableY = /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
  const scrollableX = /(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
  return (deltaY !== 0 && scrollableY) || (deltaX !== 0 && scrollableX);
}

/** Contenedor con scroll bajo el centro de la pantalla (apps con layout propio). */
function findScrollContainer(deltaX, deltaY) {
  let element = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  while (element && element !== document.body && element !== document.documentElement) {
    if (canScroll(element, deltaX, deltaY)) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

export async function scroll({ direction, amount }) {
  const [unitX, unitY] = SCROLL_VECTORS[direction];
  const deltaX = unitX * amount * SCROLL_STEP_PX;
  const deltaY = unitY * amount * SCROLL_STEP_PX;
  const before = [window.scrollX, window.scrollY];
  window.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' });
  let target = 'window';
  if (window.scrollX === before[0] && window.scrollY === before[1]) {
    const container = findScrollContainer(deltaX, deltaY);
    if (container) {
      container.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' });
      target = 'element';
    }
  }
  await sleep(SCROLL_SETTLE_MS);
  return { success: true, scrollX: window.scrollX, scrollY: window.scrollY, target };
}
