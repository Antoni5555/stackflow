// Редактор вёрстки + живой предпросмотр (trainers/components/_html_workspace.html).
// Общий для задачи на вёрстку и тренажёра HTML.
// Страниц может быть несколько (index.html, about.html): предпросмотр показывает ту, что
// открыта в редакторе; на вкладке CSS — последнюю открытую страницу.

import { HtmlPreview, MAIN_PAGE } from './engines/html/preview.js';
import { FileEditor } from './file-editor.js';

const RENDER_DELAY = 300;   // мс после последнего нажатия — не перерисовываем на каждую букву

const isPage = (name) => name.endsWith('.html');

export function htmlWorkspace(root, { initial, names, draftPrefix, onChange = () => {}, onRun }) {
  const preview = new HtmlPreview(root.querySelector('[data-preview]'));
  const pageLabel = root.querySelector('[data-preview-page]');
  const pages = names.filter(isPage);
  let page = pages.includes(MAIN_PAGE) ? MAIN_PAGE : (pages[0] ?? MAIN_PAGE);
  let timer = null;

  const show = () => {
    clearTimeout(timer);
    return preview.render(files.files, page);
  };
  const showPage = (name) => {
    page = name;
    // имя страницы над предпросмотром — только когда страниц больше одной
    if (pageLabel) pageLabel.textContent = pages.length > 1 ? page : '';
    return show();
  };

  const files = new FileEditor(root, {
    initial,
    names,
    draftPrefix,
    onRun,
    onChange: () => {
      onChange();
      clearTimeout(timer);
      timer = setTimeout(show, RENDER_DELAY);
    },
    onOpen: (name) => {
      if (isPage(name) && name !== page) showPage(name);
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

  showPage(page);
  return {
    files,
    preview,
    get page() {
      return page;
    },
    /** Отрисовать страницу сейчас, без ожидания паузы в наборе (перед проверкой — index.html). */
    renderNow(name = page) {
      clearTimeout(timer);
      return preview.render(files.files, name);
    },
    reset() {
      files.reset();
      return show();
    },
  };
}
