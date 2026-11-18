// Редактор нескольких файлов: вкладки [data-file] + один CodeEditor.
// Текст каждого файла хранится в памяти и черновиком в localStorage (draftPrefix + имя).
// Используют задачи fix и html и тренажёр HTML.

import { revealTab } from './active-tab.js';
import { CodeEditor } from './editor.js';
import { highlighterFor } from './highlight.js';
import { drafts } from './trainer-ui.js';

export class FileEditor {
  /**
   * @param {Element} root — где искать вкладки [data-file] и .editor
   * @param {object} options — { initial: {имя: текст}, names: порядок файлов,
   *   draftPrefix, onChange(files), onRun, onOpen(имя) — открыта другая вкладка,
   *   readOnly — файлы, которые ученик только читает (код задачи «напишите тесты») }
   */
  constructor(root, {
    initial, names, draftPrefix, onChange = () => {}, onRun = () => {}, onOpen = () => {},
    readOnly = [],
  }) {
    this.onOpen = onOpen;
    this.readOnly = new Set(readOnly);
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
    this.editor.textarea.readOnly = this.readOnly.has(this.current);
    for (const tab of this.tabs) tab.addEventListener('click', () => this.open(tab.dataset.file));
  }

  open(name) {
    if (!this.tabs.length) return;
    this.current = name;
    this.editor.setHighlight(highlighterFor(name));
    this.editor.value = this.files[name];
    this.editor.textarea.readOnly = this.readOnly.has(name);
    for (const tab of this.tabs) {
      const active = tab.dataset.file === name;
      tab.classList.toggle('tab--active', active);
      tab.setAttribute('aria-selected', active);
      if (active) revealTab(tab);
    }
    this.onOpen(name);
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
