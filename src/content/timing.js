export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pausa breve tras scrollIntoView para que la página reaccione (lazy load, sticky headers). */
export const SCROLL_SETTLE_MS = 100;
export const FOCUS_SETTLE_MS = 50;
