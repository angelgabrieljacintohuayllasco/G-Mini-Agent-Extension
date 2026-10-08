import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeReconnectDelay, RECONNECT_POLICY } from '../../src/shared/backoff.js';

describe('computeReconnectDelay', () => {
  it('duplica la espera en cada intento hasta 30 s', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 20].map((attempt) => computeReconnectDelay(attempt, () => 0.5));
    assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it('el jitter se mantiene dentro del 20 % y nunca supera el tope', () => {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      for (const random of [0, 0.25, 0.75, 0.999]) {
        const delay = computeReconnectDelay(attempt, () => random);
        const base = Math.min(RECONNECT_POLICY.maxDelayMs, 1000 * 2 ** (attempt - 1));
        assert.ok(delay <= RECONNECT_POLICY.maxDelayMs, `intento ${attempt}: ${delay}`);
        assert.ok(delay >= base * 0.8 - 1, `intento ${attempt}: ${delay}`);
      }
    }
  });

  it('tolera intentos fuera de rango', () => {
    assert.equal(computeReconnectDelay(0, () => 0.5), 1000);
    assert.equal(computeReconnectDelay(-3, () => 0.5), 1000);
  });
});
