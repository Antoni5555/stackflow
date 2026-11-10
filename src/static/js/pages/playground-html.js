// Тренажёр HTML и CSS: свободная вёрстка с живым предпросмотром. Файлы — в localStorage.

import { htmlWorkspace } from '../html-workspace.js';

const root = document.querySelector('[data-playground="html"]');
const initial = JSON.parse(document.getElementById('playground-files').textContent);

const workspace = htmlWorkspace(root, {
  initial,
  names: Object.keys(initial),
  draftPrefix: 'playground:html:',
});

const reset = () => workspace.reset();
root.querySelector('[data-action="reset"]').addEventListener('click', reset);
document.querySelector('[data-action="restart"]')?.addEventListener('click', reset);
