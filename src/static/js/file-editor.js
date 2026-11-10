// Редактор нескольких файлов: вкладки [data-file] + один CodeEditor.
// Текст каждого файла хранится в памяти и черновиком в localStorage (draftPrefix + имя).
// Используют задачи fix и html и тренажёр HTML.

import { CodeEditor } from './editor.js';
import { highlighterFor } from './highlight.js';
import { drafts } from './trainer-ui.js';

export class FileEditor {
  /**
   * @param {Element} root — где искать вкладки [data-file] и .editor
   * @param {object} options — { initial: {имя: текст}, names: порядок файлов,
   *   draftPrefix, onChange(files), onRun }
   */
  constructor(root, { initial, names, draftPrefix, onChange = () => {}, onRun = () => {} }) {
    this.initial = initial;
    this.names = names;
    this.draftKey = (name) => `${draftPrefix}${name}`;
    this.tabs = [...root.querySelectorAll('[data-file]')];
    this.files = Object.fromEntries(
      names.map((name) => [name, drafts.get(this.draftKey(name)) ?? initial[name]]),
    );
    this.current = names[0];
    // подсветка — по имени файла: index.html, style.css; для остальных её нет
    this.editor = new CodeEditor(root.querySelector('.editor'), {
      onRun,
      highlight: highlighterFor(this.current),
      onChange: (value) => {
        this.files[this.current] = value;
        drafts.set(this.draftKey(this.current), value);
        onChange(this.files);
      },
    });
    this.editor.value = this.files[this.current];
    for (const tab of this.tabs) tab.addEventListener('click', () => this.open(tab.dataset.file));
  }

  open(name) {
    if (!this.tabs.length) return;
    this.current = name;
    this.editor.setHighlight(highlighterFor(name));
    this.editor.value = this.files[name];
    for (const tab of this.tabs) {
      const active = tab.dataset.file === name;
      tab.classList.toggle('tab--active', active);
      tab.setAttribute('aria-selected', active);
    }
  }

  /** Вернуть исходные файлы и удалить черновики. */
  reset() {
    for (const name of this.names) {
      this.files[name] = this.initial[name];
      drafts.remove(this.draftKey(name));
    }
    this.editor.value = this.files[this.current];
  }
}
