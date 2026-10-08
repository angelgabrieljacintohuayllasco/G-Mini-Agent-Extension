import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  createManifest,
  findManifestProblems,
  GECKO_ID,
  referencedFiles,
  TARGETS,
} from '../../scripts/lib/manifest.mjs';

const base = JSON.parse(readFileSync(new URL('../../src/manifest.base.json', import.meta.url), 'utf8'));

describe('createManifest', () => {
  it('Chromium usa service worker y no lleva claves de Firefox', () => {
    const manifest = createManifest(base, { target: 'chromium', version: '1.2.3' });
    assert.deepEqual(manifest.background, { service_worker: 'background.js' });
    assert.equal(manifest.minimum_chrome_version, '116');
    assert.equal(manifest.browser_specific_settings, undefined);
    assert.equal(manifest.version, '1.2.3');
    assert.deepEqual(findManifestProblems(manifest, 'chromium'), []);
  });

  it('Firefox usa background.scripts, id de Gecko y versión mínima', () => {
    const manifest = createManifest(base, { target: 'firefox', version: '1.2.3' });
    assert.deepEqual(manifest.background, { scripts: ['background.js'] });
    assert.equal(manifest.browser_specific_settings.gecko.id, GECKO_ID);
    assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '140.0');
    assert.equal(manifest.browser_specific_settings.gecko_android.strict_min_version, '142.0');
    assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, [
      'browsingActivity',
      'websiteContent',
    ]);
    assert.equal(manifest.minimum_chrome_version, undefined);
    assert.deepEqual(findManifestProblems(manifest, 'firefox'), []);
  });

  it('las claves comunes son iguales en los dos navegadores', () => {
    const [chromium, firefox] = TARGETS.map((target) => createManifest(base, { target, version: '1.0.0' }));
    for (const key of ['name', 'description', 'permissions', 'host_permissions', 'action', 'options_ui', 'icons', 'content_security_policy']) {
      assert.deepEqual(chromium[key], firefox[key], key);
    }
  });

  it('no modifica el manifiesto base', () => {
    const snapshot = structuredClone(base);
    createManifest(base, { target: 'firefox', version: '2.0.0' });
    assert.deepEqual(base, snapshot);
  });

  it('rechaza versiones y destinos no válidos', () => {
    assert.throws(() => createManifest(base, { target: 'chromium', version: '1.0.0-beta' }), /Versión no válida/);
    assert.throws(() => createManifest(base, { target: 'chromium', version: '1.70000.0' }), /Versión no válida/);
    assert.throws(() => createManifest(base, { target: 'safari', version: '1.0.0' }), /desconocido/);
  });

  it('lista los archivos que el paquete debe contener', () => {
    const files = referencedFiles(createManifest(base, { target: 'chromium', version: '1.0.0' }));
    assert.deepEqual(files, [
      'background.js',
      'icons/icon-128.png',
      'icons/icon-16.png',
      'icons/icon-32.png',
      'icons/icon-48.png',
      'options.html',
      'popup.html',
    ]);
  });

  it('detecta un manifiesto incoherente', () => {
    const broken = { ...createManifest(base, { target: 'chromium', version: '1.0.0' }), background: { scripts: ['background.js'] } };
    assert.ok(findManifestProblems(broken, 'chromium').length > 0);
  });
});

describe('permisos mínimos', () => {
  it('solo pide los permisos que usa', () => {
    assert.deepEqual(base.permissions, ['alarms', 'downloads', 'scripting', 'storage', 'tabs']);
    assert.deepEqual(base.host_permissions, ['<all_urls>']);
  });

  it('no inyecta scripts en todas las páginas ni expone recursos a la web', () => {
    assert.equal(base.content_scripts, undefined);
    assert.equal(base.web_accessible_resources, undefined);
  });

  it('la CSP de las páginas de la extensión no permite eval', () => {
    const csp = base.content_security_policy.extension_pages;
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline/);
  });
});
