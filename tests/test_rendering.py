"""Markdown урока → HTML под классы дизайна."""
import pytest

from apps.courses.services.rendering import (
    highlight, highlight_file, inline_svg, render_inline, render_markdown,
)


def test_highlight_uses_design_classes():
    """Подсветка — классы .kw .fn .str .num .cm из дизайна, а не классы Pygments."""
    html = highlight('print("Мышь", 1) if True else None  # комментарий', 'python')

    assert '<span class="fn">print</span>' in html
    # одна строка — один span, а не три
    assert '<span class="str">&quot;Мышь&quot;</span>' in html
    assert '<span class="num">1</span>' in html
    assert '<span class="kw">True</span>' in html
    assert '<span class="cm"># комментарий</span>' in html


def test_unknown_language_is_escaped_without_highlight():
    assert highlight('<b>', 'no-such-lang') == '&lt;b&gt;'


def test_code_block_component():
    """Блок кода — .code-block с языком и кнопкой; вывод программы — без кнопки."""
    html = render_markdown('```python\nx = 1\n```\n\n```\n1\n```\n')

    assert '<div class="code-block__head"><span>python</span><button' in html
    assert html.count('code-block__copy') == 1
    assert '<span>вывод</span>' in html
    assert '\n</pre>' not in html     # без пустой строки в конце блока


def test_table_wrapped_into_design_table():
    html = render_markdown('| a | b |\n|---|---|\n| 1 | 2 |\n')

    assert html.startswith(
        '<div class="table-wrap table-wrap--bordered"><table class="data-table">'
    )
    assert html.rstrip().endswith('</table></div>')


def test_list_right_after_line_is_list():
    """CommonMark: список сразу после строки «**Группа**» — список, а не абзац."""
    html = render_markdown('**Группа**\n- первый\n- второй\n')

    assert '<ul>' in html and '<li>первый</li>' in html


def test_details_become_faq_with_markdown_inside():
    html = render_markdown(
        '<details><summary>Что такое `None`?</summary>\n\nЭто `NoneType`.\n</details>\n'
    )

    assert '<details class="faq__item">' in html
    assert '<summary>Что такое <code>None</code>?</summary>' in html
    assert '<p>Это <code>NoneType</code>.</p>' in html


def test_svg_inlined_with_unique_ids(tmp_path):
    """SVG вставляется в страницу; id и ссылки на них получают префикс рисунка."""
    (tmp_path / 'img').mkdir()
    (tmp_path / 'img' / 'scheme.svg').write_text(
        '<?xml version="1.0"?>\n<svg aria-labelledby="t"><title id="t">Схема</title>'
        '<marker id="a"/><path marker-end="url(#a)"/></svg>'
    )

    html = render_markdown('![Рисунок 1](img/scheme.svg)', base_dir=tmp_path)

    assert '<?xml' not in html
    assert 'id="fig-scheme-t"' in html and 'aria-labelledby="fig-scheme-t"' in html
    assert 'id="fig-scheme-a"' in html and 'url(#fig-scheme-a)' in html
    assert 'id="t"' not in html


def test_missing_svg_is_an_error(tmp_path):
    with pytest.raises(FileNotFoundError):
        render_markdown('![Рисунок](img/none.svg)', base_dir=tmp_path)


def test_inline_svg_keeps_other_ids_apart(tmp_path):
    path = tmp_path / 'a.svg'
    path.write_text('<svg><g id="t"/><g id="tt"/><use href="#tt"/></svg>')

    svg = inline_svg(path, 'fig-a')

    assert 'id="fig-a-t"' in svg and 'id="fig-a-tt"' in svg
    assert 'href="#fig-a-tt"' in svg


def test_render_inline_has_no_paragraph():
    assert render_inline('Используйте `print`.') == 'Используйте <code>print</code>.'


def test_highlight_file_by_name():
    """Язык подсветки — по имени файла; неизвестный — просто экранированный текст."""
    assert '<span class=' in highlight_file('server { listen 80; }', 'nginx.conf')
    assert highlight_file('A=<b>', '.env') == 'A=&lt;b&gt;'
