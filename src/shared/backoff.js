export const RECONNECT_POLICY = Object.freeze({
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  factor: 2,
  jitterRatio: 0.2,
});

/**
 * Espera antes del reintento número `attempt` (1 = primer reintento).
 *
 * Crece de forma exponencial (1 s, 2 s, 4 s ...) hasta `maxDelayMs`. El jitter
 * evita que varios navegadores reconecten en el mismo instante cuando el
 * núcleo se reinicia. El resultado nunca supera `maxDelayMs`.
 */
export function computeReconnectDelay(attempt, random = Math.random, policy = RECONNECT_POLICY) {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(policy.maxDelayMs, policy.baseDelayMs * policy.factor ** exponent);
  const jitter = base * policy.jitterRatio * (random() * 2 - 1);
  const floor = policy.baseDelayMs / 2;
  return Math.round(Math.min(policy.maxDelayMs, Math.max(floor, base + jitter)));
}
