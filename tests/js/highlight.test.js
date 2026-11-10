// Подсветка HTML, CSS, Python и SQL при наборе (src/static/js/highlight.js).
// Главное: текст слоя без тегов совпадает с исходным символ в символ — иначе цвета
// разъедутся с курсором textarea.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  highlightCss, highlightHtml, highlightPython, highlightSql, highlighterFor,
} from '../../src/static/js/highlight.js';

const plain = (html) => html.replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const PAGE = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="style.css">
  <style>.price { color: #c00; font-weight: 700; }</style>
</head>
<body>
  <!-- шапка -->
  <header class="top" data-id='1'>
    <a href="/">Магазин &amp; корзина</a>
    <img src="phone.jpg" alt="">
    <input required disabled/>
  </header>
  <script>if (a < b && c > d) {}</script>
</body>
</html>
`;

const CSS = `/* цвета магазина */
:root { --accent: #b9d13a; }
.card, .card:hover > a {
  padding: 16px 1.5rem;
  border: 1px solid #ddd;
  font-family: "Manrope", sans-serif;
  width: calc(100% - 32px) !important;
}
@media (max-width: 600px) {
  .top { flex-direction: column; }
}
`;

describe('подсветка', () => {
  it('текст не меняется — ни в готовом коде, ни в недописанном', () => {
    for (const text of [PAGE, CSS]) {
      const fn = text === PAGE ? highlightHtml : highlightCss;
      for (let cut = 0; cut <= text.length; cut += 7) {
        assert.equal(plain(fn(text.slice(0, cut))), text.slice(0, cut), `обрезано на ${cut}`);
      }
    }
  });

  it('HTML: теги, атрибуты, значения, комментарии, CSS внутри <style>', () => {
    const html = highlightHtml(PAGE);
    assert.match(html, /&lt;<span class="kw">header<\/span> <span class="fn">class<\/span>=<span class="str">"top"<\/span>/);
    assert.match(html, /<span class="cm">&lt;!-- шапка --&gt;<\/span>/);
    assert.match(html, /<span class="kw">\.price <\/span>\{ <span class="fn">color<\/span>: <span class="num">#c00<\/span>/);
    assert.match(html, /&lt;\/<span class="kw">body<\/span>&gt;/);
    assert.ok(!html.includes('<span class="kw">b</span>'));      // < внутри <script> — не тег
  });

  it('CSS: селекторы, свойства, числа, строки, @media', () => {
    const css = highlightCss(CSS);
    assert.match(css, /<span class="cm">\/\* цвета магазина \*\/<\/span>/);
    assert.match(css, /<span class="fn">padding<\/span>: <span class="num">16px<\/span> <span class="num">1\.5rem<\/span>/);
    assert.match(css, /<span class="str">"Manrope"<\/span>/);
    assert.match(css, /<span class="kw">!important<\/span>/);
    assert.match(css, /<span class="kw">@media<\/span>/);
    assert.match(css, /<span class="kw">\n  \.top <\/span>\{ <span class="fn">flex-direction<\/span>/);
  });

  it('Python: ключевые слова, встроенные функции, def/class, строки, числа, комментарии', () => {
    const code = [
      'def total(items):',
      '    """Сумма."""',
      '    return sum(x for x in items if x is not None)  # ok',
      'class Cart:',
      '    name = f"корзина {1}"',
      "print(0x1F, 1.5e3, 'a\\'b')",
      '',
    ].join('\n');
    for (let cut = 0; cut <= code.length; cut += 1) {
      assert.equal(plain(highlightPython(code.slice(0, cut))), code.slice(0, cut), `обрезано на ${cut}`);
    }
    const html = highlightPython(code);
    assert.match(html, /^<span class="kw">def<\/span> <span class="fn">total<\/span>\(items\):/);
    assert.match(html, /<span class="str">"""Сумма\."""<\/span>/);
    assert.match(html, /<span class="kw">is<\/span> <span class="kw">not<\/span> <span class="kw">None<\/span>/);
    assert.match(html, /<span class="cm"># ok<\/span>/);
    assert.match(html, /<span class="kw">class<\/span> <span class="fn">Cart<\/span>/);
    assert.match(html, /<span class="str">f"корзина \{1\}"<\/span>/);
    assert.match(html, /<span class="num">0x1F<\/span>, <span class="num">1\.5e3<\/span>/);
    // незакрытая строка — до конца строки, следующая строка снова код
    assert.match(highlightPython('x = "abc\nif y:'), /<span class="str">"abc<\/span>\n<span class="kw">if<\/span>/);
  });

  it('SQL: ключевые слова, функции, строки, числа, комментарии', () => {
    const code = [
      '-- товары дороже 1000',
      "SELECT p.name, count(*) AS n, E'it\\'s', 'C:\\' AS path, \"Order\"",
      'FROM products p /* псевдоним */',
      "WHERE price > 1499.50 AND body = $$a;'b$$",
      '',
    ].join('\n');
    for (let cut = 0; cut <= code.length; cut += 1) {
      assert.equal(plain(highlightSql(code.slice(0, cut))), code.slice(0, cut), `обрезано на ${cut}`);
    }
    const html = highlightSql(code);
    assert.match(html, /^<span class="cm">-- товары дороже 1000<\/span>/);
    assert.match(html, /<span class="kw">SELECT<\/span> p\.name, <span class="fn">count<\/span>\(\*\) <span class="kw">AS<\/span> n/);
    assert.match(html, /<span class="str">E'it\\'s'<\/span>, <span class="str">'C:\\'<\/span>/);
    assert.match(html, /<span class="num">1499\.50<\/span>/);
    assert.match(html, /<span class="str">\$\$a;'b\$\$<\/span>/);
    assert.ok(!html.includes('<span class="kw">Order</span>'));     // имя в кавычках — не слово SQL
  });

  it('язык — по имени файла', () => {
    assert.equal(highlighterFor('index.html'), highlightHtml);
    assert.equal(highlighterFor('style.css'), highlightCss);
    assert.equal(highlighterFor('app.py'), highlightPython);
    assert.equal(highlighterFor('script.sql'), highlightSql);
    assert.equal(highlighterFor('nginx.conf'), null);
  });
});
