/**
 * Datos del handshake ext:hello.
 *
 * Los cuatro primeros campos son los que enviaba la extensión original y los
 * que registra el núcleo; el resto se añadió sin cambiar el contrato.
 */
import { detectBrowser } from '../shared/browser-info.js';
import { COMMAND_NAMES } from '../shared/protocol.js';
import { getActiveTab } from './tabs.js';

export async function buildHelloPayload(api) {
  // Al arrancar el navegador puede no haber ventanas todavía.
  const tab = await getActiveTab(api).catch(() => null);
  return {
    extensionId: api.runtime.id,
    tabUrl: tab?.url ?? '',
    tabTitle: tab?.title ?? '',
    userAgent: navigator.userAgent,
    extensionVersion: api.runtime.getManifest().version,
    browser: await detectBrowser(api),
    build: typeof __BUILD_TARGET__ === 'string' ? __BUILD_TARGET__ : 'dev',
    commands: COMMAND_NAMES,
  };
}
