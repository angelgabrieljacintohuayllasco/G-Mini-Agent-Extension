/** Nombre del paquete de cada navegador dentro de dist/. */
export function archiveName(target, version) {
  return `g-mini-agent-extension-${target}-v${version}.zip`;
}
