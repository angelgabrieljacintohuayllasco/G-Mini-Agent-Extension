import { findElement } from './selectors.js';
import { sleep } from './timing.js';

const POLL_INTERVAL_MS = 200;

/**
 * Visible = tiene caja con tamaño y no está oculto por CSS. La extensión
 * original usaba offsetParent, que da null en elementos position: fixed aunque
 * se vean.
 */
export function isVisible(element) {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
  }
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function matchesState(element, state) {
  switch (state) {
    case 'attached':
      return element !== null;
    case 'detached':
      return element === null;
    case 'hidden':
      return element === null || !isVisible(element);
    default:
      return element !== null && isVisible(element);
  }
}

export async function waitFor({ selector, timeout_ms: timeoutMs, state }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const element = findElement(selector);
    if (matchesState(element, state)) {
      return { success: true, found: element !== null, waited_ms: Date.now() - startedAt };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return { success: false, error: `Timeout waiting for '${selector}' (${timeoutMs}ms)` };
}
