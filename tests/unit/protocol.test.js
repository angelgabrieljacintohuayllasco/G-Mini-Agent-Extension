import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMMAND_NAMES, parseIncomingFrame, readCommandEnvelope, validateCommandParams } from '../../src/shared/protocol.js';

// Comandos que envía backend/automation/extension_bridge.py del núcleo.
const BRIDGE_COMMANDS = [
  'navigate', 'click', 'type', 'fill', 'press', 'scroll', 'hover', 'select', 'wait_for', 'wait_load',
  'go_back', 'go_forward', 'remove_overlays', 'extract', 'get_dom', 'snapshot', 'eval', 'screenshot',
  'page_info', 'tabs_list', 'tab_switch', 'tab_new', 'tab_close', 'downloads_list',
];

describe('lista de comandos permitidos', () => {
  it('acepta exactamente los comandos del bridge del núcleo', () => {
    assert.deepEqual([...COMMAND_NAMES].sort(), [...BRIDGE_COMMANDS].sort());
  });
});

describe('validateCommandParams', () => {
  it('aplica los valores por defecto de la extensión original', () => {
    assert.deepEqual(validateCommandParams('scroll', {}).params, { direction: 'down', amount: 3 });
    assert.deepEqual(validateCommandParams('wait_for', { selector: '#a' }).params, {
      selector: '#a',
      timeout_ms: 15000,
      state: 'visible',
    });
    assert.deepEqual(validateCommandParams('get_dom', {}).params, { selector: 'body', max_depth: 6, max_length: 12000 });
    assert.deepEqual(validateCommandParams('downloads_list', {}).params, { limit: 20 });
    assert.deepEqual(validateCommandParams('wait_load', {}).params, { timeout_ms: 30000 });
    assert.deepEqual(validateCommandParams('type', { selector: 'input', text: 'hola' }).params, {
      selector: 'input',
      text: 'hola',
      clear: true,
    });
  });

  it('trata 0 como ausente donde la extensión original usaba "valor || defecto"', () => {
    assert.equal(validateCommandParams('scroll', { amount: 0 }).params.amount, 3);
    assert.equal(validateCommandParams('wait_for', { selector: 'a', timeout_ms: 0 }).params.timeout_ms, 15000);
  });

  it('convierte números y booleanos escritos como texto', () => {
    assert.equal(validateCommandParams('tab_switch', { index: '2' }).params.index, 2);
    assert.equal(validateCommandParams('scroll', { amount: '1.5' }).params.amount, 1.5);
    assert.equal(validateCommandParams('click', { selector: 'a', force: 'true' }).params.force, true);
    assert.equal(validateCommandParams('select', { selector: 's', value: 7 }).params.value, '7');
  });

  it('acota los valores fuera de rango', () => {
    assert.equal(validateCommandParams('get_dom', { max_depth: 999 }).params.max_depth, 64);
    assert.equal(validateCommandParams('wait_for', { selector: 'a', timeout_ms: 999999 }).params.timeout_ms, 120000);
    assert.equal(validateCommandParams('scroll', { amount: 5000 }).params.amount, 100);
  });

  it('usa el valor por defecto ante una opción desconocida, como la extensión original', () => {
    assert.equal(validateCommandParams('scroll', { direction: 'diagonal' }).params.direction, 'down');
    assert.equal(validateCommandParams('wait_for', { selector: 'a', state: 'HIDDEN' }).params.state, 'hidden');
  });

  it('el selector vacío de extract equivale a body', () => {
    assert.equal(validateCommandParams('extract', { selector: '' }).params.selector, 'body');
  });

  it('tab_new sin URL abre about:blank y tab_close sin índice cierra la activa', () => {
    assert.equal(validateCommandParams('tab_new', {}).params.url, 'about:blank');
    assert.deepEqual(validateCommandParams('tab_close', {}).params, {});
    assert.deepEqual(validateCommandParams('tab_close', { index: null }).params, {});
  });

  it('rechaza parámetros obligatorios ausentes o con tipo incorrecto', () => {
    assert.match(validateCommandParams('click', {}).error, /'selector' is required/);
    assert.match(validateCommandParams('click', { selector: '' }).error, /'selector' must not be empty/);
    assert.match(validateCommandParams('navigate', { url: { href: 'x' } }).error, /'url' must be a string/);
    assert.match(validateCommandParams('tab_switch', { index: 'segunda' }).error, /'index' must be an integer/);
    assert.match(validateCommandParams('eval', {}).error, /'script' is required/);
    assert.match(validateCommandParams('click', ['#a']).error, /params must be an object/);
  });

  it('permite texto vacío en type y fill (para borrar un campo)', () => {
    assert.equal(validateCommandParams('fill', { selector: 'input', text: '' }).params.text, '');
  });

  it('rechaza textos que superan el máximo', () => {
    assert.match(validateCommandParams('press', { key: 'x'.repeat(65) }).error, /at most 64 characters/);
  });

  it('ignora parámetros desconocidos', () => {
    assert.deepEqual(validateCommandParams('hover', { selector: 'a', extra: 1 }).params, { selector: 'a' });
  });
});

describe('parseIncomingFrame', () => {
  it('lee un frame válido', () => {
    const frame = parseIncomingFrame(JSON.stringify({ event: 'ext:command', data: { id: '1' } }));
    assert.deepEqual(frame, { ok: true, event: 'ext:command', data: { id: '1' } });
  });

  it('descarta JSON inválido, frames sin evento y binarios', () => {
    assert.equal(parseIncomingFrame('{no json').ok, false);
    assert.equal(parseIncomingFrame(JSON.stringify({ data: {} })).ok, false);
    assert.equal(parseIncomingFrame(JSON.stringify([1, 2])).ok, false);
    assert.equal(parseIncomingFrame(new ArrayBuffer(4)).ok, false);
  });

  it('descarta frames demasiado grandes sin parsearlos', () => {
    const frame = parseIncomingFrame(' '.repeat(4 * 1024 * 1024 + 1));
    assert.equal(frame.ok, false);
    assert.match(frame.reason, /exceeds/);
  });
});

describe('readCommandEnvelope', () => {
  it('no se puede responder sin un id válido', () => {
    assert.equal(readCommandEnvelope({ command: 'snapshot' }).answerable, false);
    assert.equal(readCommandEnvelope({ id: 'x'.repeat(129), command: 'snapshot' }).answerable, false);
  });

  it('responde Unknown command con el mismo texto que la extensión original', () => {
    const envelope = readCommandEnvelope({ id: 'abc', command: 'format_disk' });
    assert.equal(envelope.answerable, true);
    assert.equal(envelope.error, 'Unknown command: format_disk');
  });

  it('no acepta nombres heredados del prototipo como comandos', () => {
    assert.equal(readCommandEnvelope({ id: 'abc', command: 'constructor' }).error, 'Unknown command: constructor');
    assert.equal(readCommandEnvelope({ id: 'abc', command: '__proto__' }).error, 'Unknown command: __proto__');
  });
});
