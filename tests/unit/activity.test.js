import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACTIVITY_LIMIT,
  appendActivity,
  COMMAND_LABELS,
  createActivityEntry,
  describeCommandTarget,
  summarizeUrl,
} from '../../src/shared/activity.js';
import { COMMAND_NAMES } from '../../src/shared/protocol.js';

const settle = (command, params, result = { success: true }) =>
  createActivityEntry({ id: 'x', command, params, result, startedAt: 1000, finishedAt: 1250 });

describe('registro de actividad', () => {
  it('cada comando permitido tiene una etiqueta en español', () => {
    assert.deepEqual(Object.keys(COMMAND_LABELS).sort(), [...COMMAND_NAMES].sort());
  });

  it('las URL se muestran sin parámetros ni fragmento', () => {
    assert.equal(summarizeUrl('https://mail.example.com/inbox?token=secreto#msg'), 'mail.example.com/inbox');
    assert.equal(summarizeUrl('https://example.com/'), 'example.com');
    assert.equal(summarizeUrl('about:blank'), 'about:blank');
    assert.equal(summarizeUrl('chrome://settings/passwords?search=x'), 'chrome://settings/passwords');
    assert.equal(summarizeUrl('javascript:alert(document.cookie)'), 'javascript:');
  });

  it('nunca guarda el texto escrito ni el contenido de un script', () => {
    const typed = settle('type', { selector: '#password', text: 'hunter2', clear: true });
    assert.equal(typed.target, '#password');
    assert.equal(JSON.stringify(typed).includes('hunter2'), false);

    const filled = settle('fill', { selector: '#card', text: '4111 1111 1111 1111' });
    assert.equal(JSON.stringify(filled).includes('4111'), false);

    const script = settle('eval', { script: 'return localStorage.getItem("token")' });
    assert.equal(script.target, 'script de 36 caracteres');
    assert.equal(JSON.stringify(script).includes('localStorage'), false);
  });

  it('describe el objetivo de cada comando', () => {
    assert.equal(describeCommandTarget('scroll', { direction: 'up', amount: 2 }), 'arriba x2');
    assert.equal(describeCommandTarget('tab_close', {}), 'pestaña activa');
    assert.equal(describeCommandTarget('tab_switch', { index: 3 }), 'pestaña 3');
    assert.equal(describeCommandTarget('press', { key: 'Enter' }), 'Enter');
    assert.equal(describeCommandTarget('snapshot', {}), '');
  });

  it('registra el error y la duración', () => {
    const entry = settle('click', { selector: '#ok' }, { success: false, error: 'Element not found: #ok' });
    assert.equal(entry.ok, false);
    assert.equal(entry.error, 'Element not found: #ok');
    assert.equal(entry.durationMs, 250);
    assert.equal(entry.label, 'Clic');
  });

  it('marca los comandos desconocidos sin romper', () => {
    const entry = settle('format_disk', {}, { success: false, error: 'Unknown command: format_disk' });
    assert.equal(entry.label, 'Comando desconocido');
    assert.equal(entry.target, 'format_disk');
  });

  it('conserva solo las últimas 20, la más reciente primero', () => {
    let entries = [];
    for (let index = 0; index < 25; index += 1) {
      entries = appendActivity(entries, { id: String(index) });
    }
    assert.equal(entries.length, ACTIVITY_LIMIT);
    assert.equal(entries[0].id, '24');
    assert.equal(entries.at(-1).id, '5');
  });
});
