/**
 * remove_overlays: quita banners de cookies, modales y capas fijas que tapan
 * la página. Mismos criterios que la extensión original, sin tocar nunca
 * html, head ni body.
 */

const FIXED_LAYER_MIN_Z_INDEX = 999;
const MATCHED_LAYER_MIN_Z_INDEX = 100;
const PROTECTED_TAGS = new Set(['HTML', 'HEAD', 'BODY']);
const FIXED_LAYER_EXCEPTIONS = new Set(['HEADER', 'NAV']);
const OVERLAY_SELECTORS = [
  '[class*="modal"]',
  '[class*="overlay"]',
  '[class*="popup"]',
  '[class*="dialog"]',
  '[class*="cookie"]',
  '[class*="consent"]',
  '[class*="backdrop"]',
  '[id*="modal"]',
  '[id*="overlay"]',
  '[id*="popup"]',
  '[id*="cookie"]',
];

function isRemovable(element) {
  return element.isConnected && !PROTECTED_TAGS.has(element.tagName);
}

function isFixedLayer(element) {
  if (FIXED_LAYER_EXCEPTIONS.has(element.tagName)) {
    return false;
  }
  const style = getComputedStyle(element);
  return (style.position === 'fixed' || style.position === 'sticky') && parseFloat(style.zIndex) > FIXED_LAYER_MIN_Z_INDEX;
}

function isPositionedLayer(element) {
  const style = getComputedStyle(element);
  return style.position === 'fixed' || style.position === 'absolute' || parseFloat(style.zIndex) > MATCHED_LAYER_MIN_Z_INDEX;
}

export async function removeOverlays() {
  let removed = 0;
  for (const element of document.querySelectorAll('*')) {
    if (isRemovable(element) && isFixedLayer(element)) {
      element.remove();
      removed += 1;
    }
  }
  for (const element of document.querySelectorAll(OVERLAY_SELECTORS.join(','))) {
    if (isRemovable(element) && isPositionedLayer(element)) {
      element.remove();
      removed += 1;
    }
  }
  // Los modales suelen bloquear el scroll del documento.
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  return { success: true, removed_elements: removed };
}
