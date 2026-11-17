// Предпросмотр вёрстки: страница (по умолчанию index.html) в изолированном iframe.
// sandbox="allow-same-origin" без allow-scripts: скрипты страницы ученика не выполняются,
// формы не отправляются, а сайт может читать DOM и вычисленные стили (для проверки).
// <link href="style.css"> (и любой другой .css из файлов) заменяется на <style> с текстом
// файла — стили применяются, только если ученик сам подключил файл, как в настоящем сайте.

const LINK = /<link\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)["']?[^>]*>/gi;

export const MAIN_PAGE = 'index.html';

/** Текст страницы для iframe: подключённые CSS-файлы — встроенными <style>. */
export function buildDocument(files, page = MAIN_PAGE) {
  const html = files[page] ?? '';
  return html.replace(LINK, (tag, href) => {
    const css = files[href.replace(/^\.\//, '')];
    if (css === undefined || !/\brel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    // </style> внутри CSS закрыл бы тег раньше времени
    return `<style data-file="${href}">${css.replace(/<\/style/gi, '<\\/style')}</style>`;
  });
}

export class HtmlPreview {
  constructor(iframe) {
    this.iframe = iframe;
  }

  /** Показать страницу page из файлов; промис — когда она загрузилась и её можно проверять. */
  render(files, page = MAIN_PAGE) {
    return new Promise((resolve) => {
      this.iframe.addEventListener('load', () => {
        this.blockLinks();
        resolve(this.iframe.contentDocument);
      }, { once: true });
      this.iframe.srcdoc = buildDocument(files, page);
    });
  }

  // Клик по ссылке открыл бы внутри предпросмотра чужую страницу — гасим переход
  blockLinks() {
    this.iframe.contentDocument?.addEventListener('click', (event) => {
      if (event.target.closest('a[href]')) event.preventDefault();
    });
  }

  /** Ширина предпросмотра в px (null — во всю ширину) — для @media. */
  setWidth(width) {
    this.iframe.style.width = width ? `${width}px` : '';
  }

  get document() {
    return this.iframe.contentDocument;
  }
}
