/**
 * node scripts/release-notes.mjs <versión> <archivo de salida>
 *
 * Copia la sección "## [<versión>]" de CHANGELOG.md, que el flujo de
 * publicación usa como texto de la Release.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function extractSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) {
    return null;
  }
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## ['));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((line) => !/^\[[^\]]+\]: /.test(line))
    .join('\n')
    .trim();
}

const [version, output] = process.argv.slice(2);
if (!version || !output) {
  console.error('Uso: node scripts/release-notes.mjs <versión> <archivo de salida>');
  process.exit(1);
}
const section = extractSection(await readFile(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
if (!section) {
  console.error(`CHANGELOG.md no tiene la sección ## [${version}]`);
  process.exit(1);
}
await writeFile(path.resolve(output), `${section}\n`);
console.log(`Notas de la versión ${version} escritas en ${output}`);
