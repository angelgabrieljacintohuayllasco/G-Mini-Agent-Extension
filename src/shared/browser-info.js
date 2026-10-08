/** Nombre y versión del navegador, para el handshake y el diagnóstico. */
export async function detectBrowser(api) {
  if (typeof api.runtime.getBrowserInfo === 'function') {
    const info = await api.runtime.getBrowserInfo();
    return { name: info.name, version: info.version };
  }
  const brands = globalThis.navigator?.userAgentData?.brands ?? [];
  const specific = brands.find(({ brand }) => !/not.?a.?brand|chromium/i.test(brand));
  const chromium = brands.find(({ brand }) => /chromium/i.test(brand));
  const chosen = specific ?? chromium;
  return { name: chosen?.brand ?? 'Chromium', version: chosen?.version ?? '' };
}
