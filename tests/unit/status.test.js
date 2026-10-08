import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeConnection } from '../../src/shared/status.js';

const base = { url: 'ws://127.0.0.1:8765/ws/extension', attempt: 0, nextRetryAt: null, connectedAt: null, lastError: null };

describe('describeConnection', () => {
  it('cubre los cinco estados visibles', () => {
    const labels = [
      { ...base, state: 'open', connectedAt: Date.UTC(2026, 9, 7, 15, 4) },
      { ...base, state: 'waiting', attempt: 1, nextRetryAt: 5000 },
      { ...base, state: 'waiting', attempt: 3, nextRetryAt: 31000 },
      { ...base, state: 'displaced' },
      { ...base, state: 'disabled' },
    ].map((status) => describeConnection(status, 1000).label);
    assert.deepEqual(labels, ['Conectado', 'Reconectando', 'Sin app', 'Error', 'En pausa']);
  });

  it('muestra la cuenta regresiva del próximo intento', () => {
    const description = describeConnection({ ...base, state: 'waiting', attempt: 1, nextRetryAt: 5000 }, 1000);
    assert.equal(description.detail, 'Nuevo intento en 4 s.');
    assert.equal(description.tone, 'warning');
  });

  it('sin app usa un tono neutro, no de error', () => {
    const description = describeConnection({ ...base, state: 'connecting', attempt: 4 }, 0);
    assert.equal(description.tone, 'neutral');
    assert.equal(description.detail, 'G-Mini Agent no responde. Intentando conectar…');
  });

  it('una dirección bloqueada muestra el motivo', () => {
    const description = describeConnection({ ...base, state: 'blocked', lastError: 'Es un servidor remoto.' });
    assert.equal(description.label, 'Error');
    assert.equal(description.detail, 'Es un servidor remoto.');
  });

  it('sin datos todavía', () => {
    assert.equal(describeConnection(null).label, 'Sin datos');
  });
});
