import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeNavigationUrl } from '../../src/background/navigation-url.js';

const urlOf = (input) => normalizeNavigationUrl(input).url;

describe('normalizeNavigationUrl', () => {
  it('respeta las URL completas', () => {
    assert.equal(urlOf('https://example.com/a?b=1'), 'https://example.com/a?b=1');
    assert.equal(urlOf('about:blank'), 'about:blank');
    assert.equal(urlOf('chrome://settings'), 'chrome://settings');
    assert.equal(urlOf('file:///C:/informe.html'), 'file:///C:/informe.html');
  });

  it('completa el esquema cuando el agente lo omite', () => {
    assert.equal(urlOf('example.com'), 'https://example.com/');
    assert.equal(urlOf('www.example.com/ruta'), 'https://www.example.com/ruta');
    assert.equal(urlOf('//cdn.example.com/x.js'), 'https://cdn.example.com/x.js');
    assert.equal(urlOf('  example.com  '), 'https://example.com/');
  });

  it('usa http para localhost y direcciones IP', () => {
    assert.equal(urlOf('localhost:3000'), 'http://localhost:3000/');
    assert.equal(urlOf('localhost'), 'http://localhost/');
    assert.equal(urlOf('127.0.0.1:8000/panel'), 'http://127.0.0.1:8000/panel');
    assert.equal(urlOf('192.168.1.1'), 'http://192.168.1.1/');
  });

  it('bloquea los esquemas que ejecutan código', () => {
    assert.deepEqual(normalizeNavigationUrl('javascript:alert(1)'), { ok: false, error: 'Blocked URL scheme: javascript' });
    assert.equal(normalizeNavigationUrl('JavaScript:alert(1)').ok, false);
    assert.equal(normalizeNavigationUrl('vbscript:msgbox(1)').ok, false);
  });

  it('rechaza texto que no es una URL', () => {
    assert.deepEqual(normalizeNavigationUrl('buscar recetas'), { ok: false, error: 'Invalid URL: buscar recetas' });
    assert.equal(normalizeNavigationUrl('').ok, false);
  });
});
