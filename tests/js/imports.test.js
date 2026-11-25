// JS-модули сайта не импортируют друг друга по кругу. Иначе collectstatic (ManifestStaticFilesStorage
// с переписыванием import) не может дать файлам хеш — у каждого он зависит от хеша другого —
// и сборка образа падает с «Max post-process passes exceeded», а выкатка не проходит.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/static/js');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith('.js') ? [path] : [];
  });
}

/** Импорты файла: import … from './x.js', import('./x.js') — только относительные. */
function imports(path) {
  const text = readFileSync(path, 'utf-8');
  const found = [...text.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => resolve(dirname(path), m[1]));
  return found.filter((item) => item.endsWith('.js'));
}

it('нет циклов import между JS-модулями', () => {
  const graph = new Map(files(ROOT).map((path) => [path, imports(path)]));
  const cycles = [];
  const state = new Map();
  const visit = (node, stack) => {
    state.set(node, 'open');
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 'open') cycles.push([...stack.slice(stack.indexOf(next)), next].map((item) => relative(ROOT, item)).join(' → '));
      else if (!state.has(next)) visit(next, [...stack, next]);
    }
    state.set(node, 'done');
  };
  for (const node of graph.keys()) if (!state.has(node)) visit(node, [node]);
  assert.deepEqual(cycles, []);
});
