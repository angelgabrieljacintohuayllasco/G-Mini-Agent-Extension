/**
 * npm run build
 *
 * Genera dist/chromium y dist/firefox desde src/ con esbuild, escribe el
 * manifest.json de cada navegador y empaqueta cada carpeta en
 * dist/g-mini-agent-extension-<navegador>-v<versión>.zip.
 *
 *   node scripts/build.mjs --target=firefox   solo un navegador
 */
import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveName } from './lib/artifacts.mjs';
import { createManifest, findManifestProblems, referencedFiles, TARGETS } from './lib/manifest.mjs';
import { zipDirectory } from './lib/zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const SCRIPT_ENTRIES = {
  background: 'background/index.js',
  content: 'content/index.js',
  popup: 'popup/popup.js',
  options: 'options/options.js',
};
const STYLE_ENTRIES = {
  popup: 'popup/popup.css',
  options: 'options/options.css',
};
const PAGES = ['popup/popup.html', 'options/options.html'];
const ICONS = ['icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png'];
const ESBUILD_TARGETS = {
  chromium: ['chrome116', 'edge116', 'opera102'],
  firefox: ['firefox128'],
};

function fromSrc(entries) {
  return Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, path.join(SRC, file)]));
}

async function bundle(target, outdir) {
  const common = {
    bundle: true,
    outdir,
    entryNames: '[name]',
    target: ESBUILD_TARGETS[target],
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
  };
  // Sin minificar: el código publicado se puede leer y revisar tal cual.
  await esbuild.build({
    ...common,
    entryPoints: fromSrc(SCRIPT_ENTRIES),
    format: 'iife',
    platform: 'browser',
    define: { __BUILD_TARGET__: JSON.stringify(target) },
  });
  await esbuild.build({ ...common, entryPoints: fromSrc(STYLE_ENTRIES) });
}

async function copyStaticFiles(outdir) {
  await mkdir(path.join(outdir, 'icons'), { recursive: true });
  for (const page of PAGES) {
    await copyFile(path.join(SRC, page), path.join(outdir, path.basename(page)));
  }
  for (const icon of ICONS) {
    await copyFile(path.join(ROOT, 'assets', 'icons', icon), path.join(outdir, 'icons', icon));
  }
  await copyFile(path.join(ROOT, 'assets', 'brand', 'icon-small.svg'), path.join(outdir, 'icons', 'mark.svg'));
}

async function writeManifest(target, version, outdir) {
  const base = JSON.parse(await readFile(path.join(SRC, 'manifest.base.json'), 'utf8'));
  const manifest = createManifest(base, { target, version });
  const problems = findManifestProblems(manifest, target);
  if (problems.length > 0) {
    throw new Error(`Manifiesto de ${target} no válido:\n- ${problems.join('\n- ')}`);
  }
  await writeFile(path.join(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function assertFilesExist(outdir, manifest) {
  for (const file of referencedFiles(manifest)) {
    try {
      await readFile(path.join(outdir, file));
    } catch {
      throw new Error(`El manifiesto referencia ${file}, pero no está en ${path.relative(ROOT, outdir)}.`);
    }
  }
}

async function buildTarget(target, version) {
  const outdir = path.join(DIST, target);
  await rm(outdir, { recursive: true, force: true });
  await bundle(target, outdir);
  await copyStaticFiles(outdir);
  const manifest = await writeManifest(target, version, outdir);
  await assertFilesExist(outdir, manifest);
  const archive = path.join(DIST, archiveName(target, version));
  const { files, bytes } = await zipDirectory(outdir, archive);
  console.log(`${target.padEnd(9)} ${files.length} archivos  ${(bytes / 1024).toFixed(1)} KB  ${path.relative(ROOT, archive)}`);
}

function parseTargets(argv) {
  const option = argv.find((arg) => arg.startsWith('--target='));
  if (!option) {
    return TARGETS;
  }
  const target = option.slice('--target='.length);
  if (!TARGETS.includes(target)) {
    throw new Error(`--target debe ser uno de: ${TARGETS.join(', ')}`);
  }
  return [target];
}

async function main() {
  const { version } = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const targets = parseTargets(process.argv.slice(2));
  await mkdir(DIST, { recursive: true });
  for (const target of targets) {
    await buildTarget(target, version);
  }
}

main().catch((error) => {
  console.error(`Error de build: ${error.message}`);
  process.exitCode = 1;
});
