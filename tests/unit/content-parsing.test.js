import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseKeyCombo } from '../../src/content/keyboard.js';
import { splitSelectorList } from '../../src/content/selectors.js';

describe('splitSelectorList', () => {
  it('separa por las comas de primer nivel', () => {
    assert.deepEqual(splitSelectorList('#login, .btn-primary ,button[type=submit]'), [
      '#login',
      '.btn-primary',
      'button[type=submit]',
    ]);
  });

  it('respeta comas dentro de atributos, paréntesis y comillas', () => {
    assert.deepEqual(splitSelectorList('input[name="a,b"], :is(.x, .y) > a, [data-v=\'1,2\']'), [
      'input[name="a,b"]',
      ':is(.x, .y) > a',
      "[data-v='1,2']",
    ]);
  });

  it('respeta comas escapadas y descarta partes vacías', () => {
    assert.deepEqual(splitSelectorList('#a\\,b, , .c,'), ['#a\\,b', '.c']);
  });
});

describe('parseKeyCombo', () => {
  it('traduce los alias de la extensión original', () => {
    assert.equal(parseKeyCombo('enter').key, 'Enter');
    assert.equal(parseKeyCombo('space').key, ' ');
    assert.equal(parseKeyCombo('arrowdown').key, 'ArrowDown');
    assert.equal(parseKeyCombo('Escape').label, 'Escape');
  });

  it('entiende combinaciones con modificadores', () => {
    assert.deepEqual(parseKeyCombo('Control+a'), {
      key: 'a',
      code: 'KeyA',
      modifiers: { ctrlKey: true },
      label: 'Control+a',
    });
    assert.deepEqual(parseKeyCombo('shift+tab').modifiers, { shiftKey: true });
    assert.equal(parseKeyCombo('ctrl+shift+K').label, 'Control+Shift+K');
  });

  it('trata como tecla literal lo que no es una combinación', () => {
    assert.equal(parseKeyCombo('+').key, '+');
    assert.equal(parseKeyCombo('a+b').key, 'a+b');
    assert.equal(parseKeyCombo('7').code, 'Digit7');
  });
});
