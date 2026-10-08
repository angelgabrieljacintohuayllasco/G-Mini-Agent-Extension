/**
 * Genera el manifest.json de cada navegador a partir de src/manifest.base.json.
 *
 * Chromium (Chrome, Edge, Brave, Opera, Vivaldi, Arc, Yandex) usa un service
 * worker. Firefox no admite service workers en extensiones: usa
 * background.scripts (página de eventos) y necesita un id de Gecko.
 */

export const TARGETS = Object.freeze(['chromium', 'firefox']);

export const GECKO_ID = 'g-mini-agent-extension@angelgabrieljacintohuayllasco.github.io';
export const CHROMIUM_MIN_VERSION = '116';
// 140 es la ESR vigente y la primera que entiende data_collection_permissions.
export const FIREFOX_MIN_VERSION = '140.0';
export const FIREFOX_ANDROID_MIN_VERSION = '142.0';
export const BACKGROUND_SCRIPT = 'background.js';

const VERSION_PATTERN = /^\d{1,5}(\.\d{1,5}){0,3}$/;
const MAX_VERSION_PART = 65535;

export function assertValidVersion(version) {
  const valid =
    typeof version === 'string' &&
    VERSION_PATTERN.test(version) &&
    version.split('.').every((part) => Number(part) <= MAX_VERSION_PART);
  if (!valid) {
    throw new Error(`Versión no válida para un manifiesto: "${version}". Usa de 1 a 4 números (por ejemplo 1.0.0).`);
  }
}

const TARGET_OVERRIDES = Object.freeze({
  chromium: () => ({
    background: { service_worker: BACKGROUND_SCRIPT },
    minimum_chrome_version: CHROMIUM_MIN_VERSION,
  }),
  firefox: () => ({
    background: { scripts: [BACKGROUND_SCRIPT] },
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        // La extensión envía a G-Mini Agent el contenido y las URL de las
        // páginas que el agente opera (Firefox 140+ lo muestra al instalar).
        data_collection_permissions: {
          required: ['browsingActivity', 'websiteContent'],
        },
      },
      gecko_android: {
        strict_min_version: FIREFOX_ANDROID_MIN_VERSION,
      },
    },
  }),
});

export function createManifest(base, { target, version }) {
  if (!Object.hasOwn(TARGET_OVERRIDES, target)) {
    throw new Error(`Navegador de destino desconocido: "${target}". Opciones: ${TARGETS.join(', ')}.`);
  }
  assertValidVersion(version);
  const manifest = structuredClone(base);
  delete manifest.background;
  return { ...manifest, version, ...TARGET_OVERRIDES[target]() };
}

/** Rutas de archivos que el manifiesto referencia; deben existir en el paquete. */
export function referencedFiles(manifest) {
  const files = new Set([
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ]);
  if (manifest.action?.default_popup) {
    files.add(manifest.action.default_popup);
  }
  if (manifest.options_ui?.page) {
    files.add(manifest.options_ui.page);
  }
  if (manifest.background?.service_worker) {
    files.add(manifest.background.service_worker);
  }
  for (const script of manifest.background?.scripts ?? []) {
    files.add(script);
  }
  return [...files].sort();
}

/** Comprobaciones de estructura del manifiesto generado. Devuelve la lista de problemas. */
export function findManifestProblems(manifest, target) {
  const problems = [];
  const check = (condition, message) => {
    if (!condition) {
      problems.push(message);
    }
  };
  check(manifest.manifest_version === 3, 'manifest_version debe ser 3');
  check(typeof manifest.name === 'string' && manifest.name.length <= 75, 'name debe existir y tener hasta 75 caracteres');
  check(typeof manifest.description === 'string' && manifest.description.length <= 132, 'description debe tener hasta 132 caracteres');
  check(VERSION_PATTERN.test(manifest.version ?? ''), 'version no válida');
  check(Array.isArray(manifest.permissions), 'permissions debe ser una lista');
  check(!manifest.permissions?.includes('<all_urls>'), '<all_urls> va en host_permissions, no en permissions');
  check(!manifest.content_security_policy?.extension_pages?.includes('unsafe-eval'), 'la CSP de las páginas no puede permitir unsafe-eval');
  if (target === 'chromium') {
    check(manifest.background?.service_worker === BACKGROUND_SCRIPT, 'Chromium necesita background.service_worker');
    check(!manifest.background?.scripts, 'Chromium no debe declarar background.scripts');
    check(!manifest.browser_specific_settings, 'Chromium no lleva browser_specific_settings');
  }
  if (target === 'firefox') {
    check(manifest.background?.scripts?.[0] === BACKGROUND_SCRIPT, 'Firefox necesita background.scripts');
    check(!manifest.background?.service_worker, 'Firefox no admite background.service_worker');
    check(Boolean(manifest.browser_specific_settings?.gecko?.id), 'Firefox necesita browser_specific_settings.gecko.id');
    check(!manifest.minimum_chrome_version, 'Firefox no lleva minimum_chrome_version');
  }
  return problems;
}
