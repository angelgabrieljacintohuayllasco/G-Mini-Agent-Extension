/**
 * npm run check:dist
 *
 * Revisa lo que dejó el build antes de publicarlo:
 *   - el manifiesto de cada navegador es válido y lleva la versión de package.json;
 *   - existen todos los archivos que el manifiesto referencia;
 *   - el zip tiene manifest.json en la raíz y exactamente los archivos de la carpeta.
 */
import { unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveName } from './lib/artifacts.mjs';
import { findManifestProblems, referencedFiles, TARGETS } from './lib/manifest.mjs';
import { listFiles } from './lib/zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

async function checkTarget(target, version) {
  const problems = [];
  const directory = path.join(DIST, target);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  } catch (error) {
    return [`no se pudo leer dist/${target}/manifest.json (${error.message}); ejecuta npm run build`];
  }
  problems.push(...findManifestProblems(manifest, target));
  if (manifest.version !== version) {
    problems.push(`la versión del manifiesto (${manifest.version}) no coincide con package.json (${version})`);
  }
  for (const file of referencedFiles(manifest)) {
    if (!(await exists(path.join(directory, file)))) {
      problems.push(`falta ${file}`);
    }
  }

  const archivePath = path.join(DIST, archiveName(target, version));
  let entries;
  try {
    entries = unzipSync(new Uint8Array(await readFile(archivePath)));
  } catch (error) {
    problems.push(`no se pudo abrir ${path.basename(archivePath)} (${error.message})`);
    return problems;
  }
  const zipped = Object.keys(entries).filter((name) => !name.endsWith('/')).sort();
  const onDisk = await listFiles(directory);
  if (!zipped.includes('manifest.json')) {
    problems.push('el zip no tiene manifest.json en la raíz');
  }
  if (JSON.stringify(zipped) !== JSON.stringify(onDisk)) {
    problems.push(`el zip no coincide con dist/${target} (${zipped.length} frente a ${onDisk.length} archivos)`);
  }
  for (const name of zipped) {
    const original = await readFile(path.join(directory, name)).catch(() => null);
    if (!original || Buffer.compare(Buffer.from(entries[name]), original) !== 0) {
      problems.push(`el contenido de ${name} en el zip no coincide con el de la carpeta`);
    }
  }
  return problems;
}

const { version } = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
let failed = false;
for (const target of TARGETS) {
  const problems = await checkTarget(target, version);
  if (problems.length === 0) {
    console.log(`OK     ${target}: manifiesto v${version} válido, ${archiveName(target, version)} coincide con dist/${target}`);
  } else {
    failed = true;
    console.error(`FALLA  ${target}:\n  - ${problems.join('\n  - ')}`);
  }
}
process.exitCode = failed ? 1 : 0;
