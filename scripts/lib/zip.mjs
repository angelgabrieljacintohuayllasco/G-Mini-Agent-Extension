import { zipSync } from 'fflate';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Fecha fija en todas las entradas: el mismo código produce siempre el mismo zip.
const FIXED_MTIME = new Date('2026-01-01T00:00:00Z');

/** Archivos de un directorio, con rutas relativas en formato POSIX y ordenadas. */
export async function listFiles(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

export async function zipDirectory(directory, outputFile) {
  const files = await listFiles(directory);
  const entries = {};
  for (const file of files) {
    entries[file] = [await readFile(path.join(directory, file)), { mtime: FIXED_MTIME }];
  }
  const archive = zipSync(entries, { level: 9 });
  await writeFile(outputFile, archive);
  return { files, bytes: archive.length };
}
