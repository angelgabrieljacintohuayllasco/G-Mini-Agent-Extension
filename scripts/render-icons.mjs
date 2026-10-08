/**
 * Genera assets/icons/icon-{16,32,48,128}.png desde las fuentes SVG de
 * assets/brand. Los PNG se versionan: solo hace falta ejecutar esto al cambiar
 * la marca (npm run icons).
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'assets', 'icons');

// Los tamaños chicos usan la versión simplificada: los rayos y la separación
// entre anillo y ojo se pierden por debajo de 48 px.
const RENDERS = [
  { source: 'assets/brand/icon-small.svg', sizes: [16, 32] },
  { source: 'assets/brand/icon.svg', sizes: [48, 128] },
];

await mkdir(OUTPUT_DIR, { recursive: true });
for (const { source, sizes } of RENDERS) {
  const svg = await readFile(path.join(ROOT, source), 'utf8');
  for (const size of sizes) {
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
    const target = path.join(OUTPUT_DIR, `icon-${size}.png`);
    await writeFile(target, png);
    console.log(`${path.relative(ROOT, target)}  ${size}x${size}  ${png.length} bytes`);
  }
}
