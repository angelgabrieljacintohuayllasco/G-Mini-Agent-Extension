/**
 * Comando press: eventos de teclado sobre el elemento con foco.
 *
 * Los eventos sintéticos no tienen acción por defecto, así que se replica la
 * del navegador cuando la página no la cancela: Enter envía el formulario o
 * activa el botón, Espacio activa botones y casillas, y Tab mueve el foco.
 */

const KEY_ALIASES = Object.freeze({
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  space: ' ',
  spacebar: ' ',
  arrowdown: 'ArrowDown',
  down: 'ArrowDown',
  arrowup: 'ArrowUp',
  up: 'ArrowUp',
  arrowleft: 'ArrowLeft',
  left: 'ArrowLeft',
  arrowright: 'ArrowRight',
  right: 'ArrowRight',
  delete: 'Delete',
  del: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
});

const MODIFIERS = Object.freeze({
  control: ['ctrlKey', 'Control'],
  ctrl: ['ctrlKey', 'Control'],
  shift: ['shiftKey', 'Shift'],
  alt: ['altKey', 'Alt'],
  option: ['altKey', 'Alt'],
  meta: ['metaKey', 'Meta'],
  cmd: ['metaKey', 'Meta'],
  command: ['metaKey', 'Meta'],
});

const TABBABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(',');

function resolveKey(name) {
  return KEY_ALIASES[name.toLowerCase()] ?? name;
}

function keyCode(key) {
  if (key === ' ') {
    return 'Space';
  }
  if (/^[a-z]$/i.test(key)) {
    return `Key${key.toUpperCase()}`;
  }
  if (/^\d$/.test(key)) {
    return `Digit${key}`;
  }
  return key;
}

/** "Control+Shift+a" -> tecla 'a' con ctrlKey y shiftKey. Lo demás es una tecla literal. */
export function parseKeyCombo(rawKey) {
  const parts = rawKey.length > 1 ? rawKey.split('+') : [rawKey];
  const keyName = parts.pop();
  const allModifiers = parts.every((part) => Object.hasOwn(MODIFIERS, part.trim().toLowerCase()));
  if (!keyName || !allModifiers) {
    const key = resolveKey(rawKey);
    return { key, code: keyCode(key), modifiers: {}, label: key };
  }
  const modifiers = {};
  const labels = [];
  for (const part of parts) {
    const [flag, label] = MODIFIERS[part.trim().toLowerCase()];
    modifiers[flag] = true;
    labels.push(label);
  }
  const key = resolveKey(keyName);
  return { key, code: keyCode(key), modifiers, label: [...labels, key].join('+') };
}

function isVisible(element) {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
}

function tabbableElements() {
  const candidates = Array.from(document.querySelectorAll(TABBABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && isVisible(element),
  );
  const positive = candidates.filter((element) => element.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex);
  return [...positive, ...candidates.filter((element) => element.tabIndex === 0)];
}

function moveFocus(current, backwards) {
  const order = tabbableElements();
  if (order.length === 0) {
    return;
  }
  const index = order.indexOf(current);
  const step = backwards ? -1 : 1;
  const next = index === -1 ? order[backwards ? order.length - 1 : 0] : order[(index + step + order.length) % order.length];
  next.focus();
}

function isActivatable(element) {
  return (
    element instanceof HTMLButtonElement ||
    (element instanceof HTMLAnchorElement && element.hasAttribute('href')) ||
    element.getAttribute('role') === 'button' ||
    element.getAttribute('role') === 'link'
  );
}

function submitForm(form) {
  if (typeof form.requestSubmit === 'function') {
    form.requestSubmit();
  } else {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
}

function runDefaultAction(target, combo) {
  const { key, modifiers } = combo;
  const plain = !modifiers.ctrlKey && !modifiers.altKey && !modifiers.metaKey;
  if (key === 'Tab' && plain) {
    moveFocus(target, Boolean(modifiers.shiftKey));
  } else if (key === 'Enter' && plain) {
    if (target instanceof HTMLInputElement && target.form) {
      submitForm(target.form);
    } else if (isActivatable(target)) {
      target.click();
    }
  } else if (key === ' ' && plain) {
    const toggles = target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio');
    if (toggles || isActivatable(target)) {
      target.click();
    }
  }
}

export async function press({ key }) {
  const combo = parseKeyCombo(key);
  const target = document.activeElement || document.body;
  const init = { key: combo.key, code: combo.code, bubbles: true, cancelable: true, composed: true, ...combo.modifiers };
  const notCancelled = target.dispatchEvent(new KeyboardEvent('keydown', init));
  if (notCancelled) {
    target.dispatchEvent(new KeyboardEvent('keypress', init));
    runDefaultAction(target, combo);
  }
  target.dispatchEvent(new KeyboardEvent('keyup', init));
  return { success: true, key: combo.label };
}
