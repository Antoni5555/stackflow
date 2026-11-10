// Редактор заметки: заголовок + текст с форматированием (contenteditable + кнопки).
// Без библиотек: document.execCommand умеет жирный, курсив, списки и т. д.
// HTML уходит на сервер и там очищается (nh3) — показываем уже очищенный.
//
// Разметка — templates/common/_note_editor.html. Используется в правой панели
// (новая заметка) и в шпаргалке (правка существующей).

import { apiRequest } from './api.js';

export class NoteEditor {
  /**
   * @param {HTMLElement} root — [data-note-editor]
   * @param {object} options — { noteId, onSaved(note), onCancel() }
   */
  constructor(root, { noteId = null, onSaved = () => {}, onCancel = null } = {}) {
    this.root = root;
    this.api = root.dataset.api;
    this.source = root.dataset.source;
    this.noteId = noteId;
    this.onSaved = onSaved;
    this.title = root.querySelector('.note-editor__title');
    this.area = root.querySelector('.note-editor__area');
    this.status = root.querySelector('[data-note-status]');
    this.saveButton = root.querySelector('[data-note-save]');

    // Enter создаёт <p>, а не <div> (div сервер всё равно убрал бы)
    document.execCommand('defaultParagraphSeparator', false, 'p');

    for (const button of root.querySelectorAll('[data-cmd]')) {
      // mousedown, а не click: иначе кнопка заберёт фокус и выделение в тексте пропадёт
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.format(button.dataset.cmd);
      });
    }
    this.saveButton.addEventListener('click', () => this.save());
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.save();
      }
    });
    const cancel = root.querySelector('[data-note-cancel]');
    if (onCancel && cancel) {
      cancel.hidden = false;
      cancel.addEventListener('click', onCancel);
    }
  }

  format(command) {
    this.area.focus();
    if (command === 'heading') {
      // H — заголовок внутри заметки; повторное нажатие возвращает обычный абзац
      const isHeading = document.queryCommandValue('formatBlock').toLowerCase() === 'h4';
      document.execCommand('formatBlock', false, isHeading ? 'p' : 'h4');
    } else if (command === 'code') {
      const text = window.getSelection().toString();
      if (!text) return;
      const code = document.createElement('code');
      code.textContent = text;
      document.execCommand('insertHTML', false, code.outerHTML);
    } else {
      document.execCommand(command);
    }
  }

  fill(title, html) {
    this.title.value = title;
    this.area.innerHTML = html;
  }

  clear() {
    this.fill('', '');
  }

  showStatus(text, isError = false) {
    this.status.textContent = text;
    this.status.style.color = isError ? 'var(--error)' : '';
  }

  async save() {
    const title = this.title.value.trim();
    if (!title) {
      this.showStatus('Напишите тему заметки — по ней вы найдёте её в шпаргалке', true);
      this.title.focus();
      return;
    }
    this.saveButton.disabled = true;
    const payload = { title, body: this.area.innerHTML };
    const response = this.noteId
      ? await apiRequest('PATCH', `${this.api}${this.noteId}/`, payload)
      : await apiRequest('POST', this.api, { ...payload, source: this.source });
    this.saveButton.disabled = false;

    if (!response.ok) {
      this.showStatus('Не сохранилось. Попробуйте ещё раз.', true);
      return;
    }
    const note = await response.json();
    this.onSaved(note);
  }
}

// Плашка «Заметка» в правой панели: новая заметка, после сохранения — чистое поле
for (const root of document.querySelectorAll('[data-note-editor][data-source]')) {
  const editor = new NoteEditor(root, {
    onSaved: (note) => {
      editor.clear();
      editor.showStatus('Сохранено ✓ — заметка уже в шпаргалке');
      setTimeout(() => editor.showStatus(''), 3000);
    },
  });
}
