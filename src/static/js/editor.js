// Редактор кода на обычном <textarea>: номера строк, Tab, автоотступ, Ctrl+Enter.
// Без библиотек: полноценный редактор (CodeMirror) весит сотни КБ и требует сборщика.
// Подсветка (highlight — функция текст → HTML, js/highlight.js): под прозрачной textarea
// лежит <pre> с тем же текстом в цвете; курсор и выделение остаются у textarea.
//
// Разметка (как в макете):
//   <div class="editor">
//     <div class="editor__gutter" aria-hidden="true"></div>
//     <textarea class="editor__code" spellcheck="false"></textarea>
//   </div>

const INDENT = '    ';

export class CodeEditor {
  /**
   * @param {HTMLElement} root — элемент .editor
   * @param {object} options — { onRun: функция для Ctrl+Enter, onChange: при каждом вводе,
   *   highlight: подсветка (или null) }
   */
  constructor(root, { onRun = () => {}, onChange = () => {}, highlight = null } = {}) {
    this.textarea = root.querySelector('.editor__code');
    this.gutter = root.querySelector('.editor__gutter');
    this.onRun = onRun;
    this.onChange = onChange;
    this.layer = null;

    this.textarea.addEventListener('input', () => this.changed());
    this.textarea.addEventListener('keydown', (event) => this.keydown(event));
    this.textarea.addEventListener('scroll', () => {
      this.gutter.scrollTop = this.textarea.scrollTop;
      this.syncScroll();
    });
    this.setHighlight(highlight);
    this.updateGutter();
  }

  /** Включить подсветку (функция текст → HTML) или выключить (null) — например, при смене файла. */
  setHighlight(highlight) {
    this.highlight = highlight;
    if (highlight && !this.layer) {
      // textarea и слой подсветки — в одной обёртке: слой точно под текстом
      const area = document.createElement('div');
      area.className = 'editor__area';
      this.layer = document.createElement('pre');
      this.layer.className = 'editor__code editor__highlight';
      this.layer.setAttribute('aria-hidden', 'true');
      this.textarea.before(area);
      area.append(this.layer, this.textarea);
    }
    if (this.layer) this.layer.hidden = !highlight;
    this.textarea.classList.toggle('editor__code--highlighted', Boolean(highlight));
    this.renderHighlight();
  }

  renderHighlight() {
    if (!this.highlight) return;
    const text = this.value;
    // пустая последняя строка в <pre> схлопывается — добавляем пробел, чтобы высоты совпадали
    this.layer.innerHTML = this.highlight(text) + (text.endsWith('\n') || !text ? ' ' : '');
    this.syncScroll();
  }

  syncScroll() {
    if (!this.layer) return;
    this.layer.scrollTop = this.textarea.scrollTop;
    this.layer.scrollLeft = this.textarea.scrollLeft;
  }

  get value() {
    return this.textarea.value;
  }

  set value(text) {
    this.textarea.value = text;
    this.updateGutter();
    this.renderHighlight();
  }

  changed() {
    this.updateGutter();
    this.renderHighlight();
    this.onChange(this.value);
  }

  updateGutter() {
    const lines = this.value.split('\n').length;
    this.gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  }

  /** Вставить текст на место выделения так, чтобы работала отмена (Ctrl+Z). */
  insert(text) {
    document.execCommand('insertText', false, text);
  }

  keydown(event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.onRun();
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      this.insert(INDENT);
      return;
    }
    if (event.key === 'Enter') {
      // Новая строка с тем же отступом; после «:» — на уровень глубже, как в IDE
      const { selectionStart, value } = this.textarea;
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const line = value.slice(lineStart, selectionStart);
      let indent = line.match(/^\s*/)[0];
      if (line.trimEnd().endsWith(':')) indent += INDENT;
      event.preventDefault();
      this.insert('\n' + indent);
    }
  }
}
