// Терминал Linux-симулятора на странице: строка ввода, вывод, история ↑↓, Tab, Ctrl+L, Ctrl+C
// и редактор nano на месте строки ввода (Ctrl+O — сохранить, Ctrl+X — выйти).
// Разметка — trainers/components/_terminal.html.

import { CodeEditor } from '../../editor.js';
import { lineNeedsDocker, loadDocker } from './docker-loader.js';

const MAX_LINES = 500;          // старые строки вывода убираем, чтобы страница не тяжелела

export class Terminal {
  /**
   * @param {Element} root — [data-terminal]
   * @param {Shell} shell
   * @param {object} hooks — onCommand(line, result) после каждой команды и после nano
   */
  constructor(root, shell, { onCommand = () => {} } = {}) {
    this.root = root;
    this.shell = shell;
    this.onCommand = onCommand;
    this.body = root.querySelector('[data-terminal-body]');
    this.output = root.querySelector('[data-terminal-output]');
    this.inputLine = root.querySelector('[data-terminal-line]');
    this.prompt = root.querySelector('[data-terminal-prompt]');
    this.input = root.querySelector('[data-terminal-input]');
    this.title = root.querySelector('[data-terminal-title]');
    this.historyIndex = null;
    this.outer = [];             // оболочки снаружи: docker exec -it … bash — вход в контейнер
    this.nano = new Nano(root.querySelector('[data-nano]'), shell.fs, () => this.closeNano());

    this.input.addEventListener('keydown', (event) => this.keydown(event));
    // Клик по пустому месту терминала — фокус в строку ввода (выделение текста не мешает)
    this.body.addEventListener('click', () => {
      if (!window.getSelection().toString()) this.input.focus();
    });
    this.updatePrompt();
  }

  updatePrompt() {
    const prompt = this.shell.prompt();
    this.prompt.textContent = prompt.trimEnd();
    this.title.textContent = prompt.replace(/[$#]\s*$/, '').replace(':', ': ');
  }

  /** Напечатать текст: kind — out, err или muted. */
  print(text, kind = 'out') {
    if (!text) return;
    const div = document.createElement('div');
    div.className = `terminal__out${kind === 'out' ? '' : ` terminal__out--${kind}`}`;
    div.textContent = text.replace(/\n$/, '');
    this.output.append(div);
    while (this.output.childElementCount > MAX_LINES) this.output.firstElementChild.remove();
  }

  /** Строка с приглашением и введённой командой — как она осталась бы в настоящем терминале. */
  echo(line) {
    const div = document.createElement('div');
    const prompt = document.createElement('span');
    prompt.className = 'terminal__prompt';
    prompt.textContent = this.shell.prompt().trimEnd();
    div.append(prompt, ` ${line}`);
    this.output.append(div);
  }

  scrollToEnd() {
    this.body.scrollTop = this.body.scrollHeight;
  }

  /** Строка из поля ввода: если нужна, сначала догружается учебный Docker. */
  async submit(line) {
    if (lineNeedsDocker(line)) {
      this.input.disabled = true;
      try {
        await loadDocker();
      } finally {
        this.input.disabled = false;
        this.input.focus();
      }
    }
    await this.execute(line);
  }

  /** Выполнить строку (и показать её), как если бы её набрали. */
  async execute(line) {
    this.echo(line);
    const result = this.shell.run(line);
    for (const chunk of result.chunks) this.print(chunk.text, chunk.err ? 'err' : 'out');
    if (result.pending) {
      // вывод придёт позже (psql в контейнере): строка ввода ждёт, как в настоящем терминале
      this.inputLine.hidden = true;
      this.scrollToEnd();
      // первый psql скачивает PostgreSQL (PGlite, ~4 МБ) — скажем, почему ждём
      const slow = setTimeout(() => this.print('(запускается PostgreSQL в браузере — первый раз несколько секунд)', 'muted'), 700);
      try {
        const done = await result.pending;
        clearTimeout(slow);
        for (const chunk of done.chunks) this.print(chunk.text, chunk.err ? 'err' : 'out');
      } catch (e) {
        clearTimeout(slow);
        this.print(`(ошибка тренажёра: ${e.message})\n`, 'err');
      } finally {
        this.inputLine.hidden = false;
        this.input.focus();
      }
    }
    if (result.action?.type === 'clear') this.output.replaceChildren();
    this.shell.machine?.afterCommand?.();
    if (result.action?.type === 'enter') {
      // внутрь контейнера: дальше команды выполняет его оболочка, exit — назад
      this.outer.push({ shell: this.shell, onLeave: result.action.onLeave });
      this.shell = result.action.shell;
    } else if (result.action?.type === 'leave' && this.outer.length) {
      const { shell, onLeave } = this.outer.pop();
      this.shell = shell;
      onLeave?.(result.action.code);
    }
    this.updatePrompt();
    if (result.action?.type === 'edit') this.openNano(result.action);
    this.onCommand(line, result);
    this.scrollToEnd();
    return result;
  }

  keydown(event) {
    const { key } = event;
    const history = this.shell.history;
    if (key === 'Enter') {
      event.preventDefault();
      const line = this.input.value;
      this.input.value = '';
      this.historyIndex = null;
      if (line.trim()) this.submit(line);
      else {
        this.echo('');
        this.scrollToEnd();
      }
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      if (!history.length) return;
      event.preventDefault();
      let index = this.historyIndex ?? history.length;
      index = Math.min(Math.max(index + (key === 'ArrowUp' ? -1 : 1), 0), history.length);
      this.historyIndex = index;
      this.input.value = history[index] ?? '';
    } else if (key === 'Tab') {
      event.preventDefault();
      const { line, options } = this.shell.complete(this.input.value);
      this.input.value = line;
      if (options.length) {
        this.echo(this.input.value);
        this.print(options.join('  '), 'muted');
        this.scrollToEnd();
      }
    } else if (event.ctrlKey && key.toLowerCase() === 'l') {
      event.preventDefault();
      this.output.replaceChildren();
    } else if (event.ctrlKey && key.toLowerCase() === 'c'
      && this.input.selectionStart === this.input.selectionEnd) {
      // Ctrl+C без выделения — отменить набранную строку, как в bash (с выделением — копировать)
      event.preventDefault();
      this.echo(`${this.input.value}^C`);
      this.input.value = '';
      this.scrollToEnd();
    }
  }

  /** Сбросить экран (новая ФС после «Сбросить»). */
  reset(shell) {
    this.shell = shell;
    this.outer = [];
    this.nano.fs = shell.fs;
    this.afterNano = null;
    this.nano.close();
    this.output.replaceChildren();
    this.updatePrompt();
  }

  openNano({ path, name, onClose = null }) {
    this.inputLine.hidden = true;
    this.afterNano = onClose;            // crontab -e: после выхода — проверка и установка
    this.nano.open(path, name);
  }

  closeNano() {
    this.inputLine.hidden = false;
    const after = this.afterNano;
    this.afterNano = null;
    if (after) {
      for (const chunk of after()) this.print(chunk.text, chunk.err ? 'err' : 'out');
    }
    this.onCommand('nano', { chunks: [] });
    this.input.focus();
    this.scrollToEnd();
  }
}

/** Редактор nano: файл из виртуальной ФС в textarea (тот же редактор, что у задач). */
class Nano {
  constructor(root, fs, onClose) {
    this.root = root;
    this.fs = fs;
    this.onClose = onClose;
    this.name = root.querySelector('[data-nano-name]');
    this.status = root.querySelector('[data-nano-status]');
    this.keys = root.querySelector('[data-nano-keys]');
    this.question = root.querySelector('[data-nano-question]');
    this.editor = new CodeEditor(root.querySelector('.editor'), {
      onChange: () => { this.dirty = true; },
    });
    this.textarea = root.querySelector('textarea');
    this.textarea.addEventListener('keydown', (event) => this.keydown(event));
    root.querySelector('[data-nano-save]').addEventListener('click', () => this.save());
    root.querySelector('[data-nano-exit]').addEventListener('click', () => this.exit());
    for (const button of root.querySelectorAll('[data-nano-answer]')) {
      button.addEventListener('click', () => this.answer(button.dataset.nanoAnswer));
    }
  }

  open(path, name) {
    this.path = path;
    this.dirty = false;
    let text = '';
    let status = '';
    try {
      text = this.fs.readFile(path);
      status = `[ Read ${text ? text.replace(/\n$/, '').split('\n').length : 0} lines ]`;
    } catch (e) {
      status = e.code === 'ENOENT' ? '[ New File ]' : `[ Error reading ${name}: ${e.message} ]`;
    }
    this.name.textContent = name;
    this.editor.value = text;
    this.setStatus(status);
    this.showQuestion(false);
    this.root.hidden = false;
    this.textarea.focus();
    this.textarea.setSelectionRange(0, 0);
  }

  close() {
    this.root.hidden = true;
  }

  setStatus(text, error = false) {
    this.status.textContent = text;
    this.status.classList.toggle('nano__status--error', error);
  }

  keydown(event) {
    if (this.question.hidden === false) {
      const key = event.key.toLowerCase();
      if (['y', 'n'].includes(key) || key === 'escape') {
        event.preventDefault();
        this.answer(key === 'escape' ? 'cancel' : key);
      }
      return;
    }
    if (!event.ctrlKey) return;
    const key = event.key.toLowerCase();
    if (key === 'o' || key === 's') {
      event.preventDefault();
      this.save();
    } else if (key === 'x') {
      event.preventDefault();
      this.exit();
    }
  }

  /** Записать файл; ошибка прав — в строке состояния, как в nano. */
  save() {
    let text = this.editor.value;
    if (text && !text.endsWith('\n')) text += '\n';      // nano дописывает перевод строки в конце
    try {
      this.fs.writeFile(this.path, text);
      this.dirty = false;
      this.setStatus(`[ Wrote ${text ? text.replace(/\n$/, '').split('\n').length : 0} lines ]`);
      return true;
    } catch (e) {
      this.setStatus(`[ Error writing ${this.name.textContent}: ${e.message} ]`, true);
      return false;
    }
  }

  exit() {
    if (!this.dirty) {
      this.finish();
      return;
    }
    this.showQuestion(true);
  }

  showQuestion(visible) {
    this.question.hidden = !visible;
    this.keys.hidden = visible;
    if (visible) this.setStatus('Save modified buffer?');
  }

  answer(choice) {
    this.showQuestion(false);
    if (choice === 'cancel') {
      this.setStatus('');
      this.textarea.focus();
      return;
    }
    if (choice === 'y' && !this.save()) return;       // не сохранилось — остаёмся в редакторе
    this.finish();
  }

  finish() {
    this.close();
    this.onClose();
  }
}
