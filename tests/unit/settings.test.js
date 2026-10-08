import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkServerUrl,
  DEFAULT_SERVER_URL,
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  resetSettings,
  resolveConnectionTarget,
  saveSettings,
} from '../../src/shared/settings.js';
import { createMemoryStorageArea } from './helpers/fakes.js';

describe('checkServerUrl', () => {
  it('acepta la dirección por defecto y otras de loopback', () => {
    for (const url of [DEFAULT_SERVER_URL, 'ws://localhost:8765/ws/extension', 'ws://127.0.0.2:9000/x', 'ws://[::1]:8765/ws/extension']) {
      const check = checkServerUrl(url);
      assert.equal(check.ok, true, url);
      assert.equal(check.isLocal, true, url);
    }
  });

  it('rechaza un servidor remoto si no se permitió', () => {
    const check = checkServerUrl('wss://agente.example.com/ws/extension');
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'remote');
  });

  it('acepta un servidor remoto permitido e indica si va cifrado', () => {
    assert.deepEqual(checkServerUrl('wss://agente.example.com/ws/extension', { allowRemote: true }), {
      ok: true,
      url: 'wss://agente.example.com/ws/extension',
      isLocal: false,
      isEncrypted: true,
    });
    assert.equal(checkServerUrl('ws://100.71.131.70:8765/ws/extension', { allowRemote: true }).isEncrypted, false);
  });

  it('no confunde un dominio que empieza por 127 con loopback', () => {
    assert.equal(checkServerUrl('ws://127.0.0.1.evil.example/ws').reason, 'remote');
    assert.equal(checkServerUrl('ws://localhost.evil.example/ws').reason, 'remote');
  });

  it('rechaza esquemas, credenciales, fragmentos y texto que no es una URL', () => {
    assert.equal(checkServerUrl('http://127.0.0.1:8765/ws/extension').reason, 'scheme');
    assert.equal(checkServerUrl('ws://user:pass@127.0.0.1:8765/ws').reason, 'credentials');
    assert.equal(checkServerUrl('ws://127.0.0.1:8765/ws#x').reason, 'fragment');
    assert.equal(checkServerUrl('no es una url').reason, 'invalid');
    assert.equal(checkServerUrl('   ').reason, 'empty');
    assert.equal(checkServerUrl(undefined).reason, 'empty');
  });

  it('devuelve un mensaje listo para mostrar', () => {
    assert.match(checkServerUrl('wss://remoto.example/ws').message, /Opciones/);
  });
});

describe('resolveConnectionTarget', () => {
  it('en pausa no conecta', () => {
    assert.deepEqual(resolveConnectionTarget({ ...DEFAULT_SETTINGS, enabled: false }), {
      enabled: false,
      url: null,
      blockedReason: null,
    });
  });

  it('bloquea una dirección remota guardada sin permiso', () => {
    const target = resolveConnectionTarget({ enabled: true, serverUrl: 'wss://remoto.example/ws', allowRemoteServer: false });
    assert.equal(target.url, null);
    assert.match(target.blockedReason, /servidor remoto/);
  });

  it('normaliza la dirección permitida', () => {
    assert.equal(resolveConnectionTarget(DEFAULT_SETTINGS).url, DEFAULT_SERVER_URL);
  });
});

describe('persistencia de ajustes', () => {
  it('normalizeSettings repara datos dañados con los valores por defecto', () => {
    assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
    assert.deepEqual(normalizeSettings({ enabled: 'si', serverUrl: '  ', allowRemoteServer: 'true' }), DEFAULT_SETTINGS);
  });

  it('saveSettings combina con lo guardado y loadSettings lo lee', async () => {
    const area = createMemoryStorageArea();
    await saveSettings(area, { enabled: false });
    await saveSettings(area, { serverUrl: 'ws://127.0.0.1:9000/ws/extension' });
    assert.deepEqual(await loadSettings(area), {
      enabled: false,
      serverUrl: 'ws://127.0.0.1:9000/ws/extension',
      allowRemoteServer: false,
    });
  });

  it('resetSettings vuelve a los valores por defecto', async () => {
    const area = createMemoryStorageArea({ settings: { enabled: false, serverUrl: 'wss://x.example/ws', allowRemoteServer: true } });
    await resetSettings(area);
    assert.deepEqual(await loadSettings(area), DEFAULT_SETTINGS);
  });
});
