// Редактор вёрстки + живой предпросмотр (trainers/components/_html_workspace.html).
// Общий для задачи на вёрстку и тренажёра HTML.

import { HtmlPreview } from './engines/html/preview.js';
import { FileEditor } from './file-editor.js';

const RENDER_DELAY = 300;   // мс после последнего нажатия — не перерисовываем на каждую букву

export function htmlWorkspace(root, { initial, names, draftPrefix, onChange = () => {}, onRun }) {
  const preview = new HtmlPreview(root.querySelector('[data-preview]'));
  let timer = null;
  const files = new FileEditor(root, {
    initial,
    names,
    draftPrefix,
    onRun,
    onChange: () => {
      onChange();
      clearTimeout(timer);
      timer = setTimeout(() => preview.render(files.files), RENDER_DELAY);
    },
  });

  // Ширина предпросмотра: ПК (во всю ширину) или телефон
  const widthButtons = [...root.querySelectorAll('[data-width]')];
  for (const button of widthButtons) {
    button.addEventListener('click', () => {
      preview.setWidth(Number(button.dataset.width) || null);
      for (const other of widthButtons) other.classList.toggle('seg__item--active', other === button);
    });
  }

  preview.render(files.files);
  return {
    files,
    preview,
    /** Отрисовать текущие файлы сейчас (перед проверкой — без ожидания паузы в наборе). */
    renderNow() {
      clearTimeout(timer);
      return preview.render(files.files);
    },
    reset() {
      files.reset();
      return preview.render(files.files);
    },
  };
}
