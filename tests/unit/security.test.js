/**
 * Invariantes de seguridad del código fuente: se verifican aquí para que un
 * cambio futuro no las rompa sin que nadie lo note.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const EVAL_MODULE = path.join('background', 'page-script.js');

function sourceFiles(extension) {
  return readdirSync(SRC, { recursive: true })
    .filter((file) => file.endsWith(extension))
    .map((file) => ({ file, text: readFileSync(path.join(SRC, file), 'utf8') }));
}

describe('invariantes de seguridad', () => {
  it('solo page-script.js convierte texto en código', () => {
    const offenders = sourceFiles('.js')
      .filter(({ file }) => file !== EVAL_MODULE)
      .filter(({ text }) => /\beval\s*\(|new\s+Function\s*\(|setTimeout\(\s*['"`]/.test(text))
      .map(({ file }) => file);
    assert.deepEqual(offenders, []);
  });

  it('el módulo de eval conserva el contrato de la extensión original y corre en la página', () => {
    const text = readFileSync(path.join(SRC, EVAL_MODULE), 'utf8');
    assert.match(text, /new Function\(`return \(async \(\) => \{ \$\{code\} \}\)\(\)`\)/);
    assert.match(text, /world: 'MAIN'/);
  });

  it('la interfaz nunca inserta HTML crudo', () => {
    const offenders = sourceFiles('.js')
      .filter(({ text }) => /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/.test(text))
      .map(({ file }) => file);
    assert.deepEqual(offenders, []);
  });

  it('las páginas no tienen scripts ni estilos en línea (la CSP los bloquearía)', () => {
    for (const { file, text } of sourceFiles('.html')) {
      assert.doesNotMatch(text, /<script(?![^>]*\bsrc=)[^>]*>/, file);
      assert.doesNotMatch(text, /\son[a-z]+\s*=/, file);
      assert.doesNotMatch(text, /\sstyle\s*=/, file);
    }
  });
});
