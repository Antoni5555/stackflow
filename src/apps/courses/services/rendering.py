"""Markdown урока и задачи → HTML под классы дизайна (макет design/).

Вызывается один раз — в load_content; на странице HTML отдаётся готовым.
Санитайзер здесь не нужен: уроки — наш контент из репозитория
(заметки пользователей, которые пишет кто угодно, очищаются отдельно).
"""
import html
import re
from pathlib import Path

from markdown_it import MarkdownIt
from pygments.lexers import get_lexer_by_name, get_lexer_for_filename
from pygments.token import Comment, Keyword, Name, Number, Operator, String
from pygments.util import ClassNotFound


# Токен Pygments → класс подсветки из дизайна (.kw .fn .str .num .cm в base.css)
TOKEN_CLASSES = [
    (Comment, 'cm'),
    (String, 'str'),
    (Number, 'num'),
    (Keyword, 'kw'),
    (Operator.Word, 'kw'),        # and, or, not, in, is
    (Name.Builtin, 'fn'),         # print, len, type…
    (Name.Function, 'fn'),
    (Name.Class, 'fn'),
]


def token_class(token_type):
    """Класс дизайна для токена Pygments или '' (без подсветки)."""
    for parent, css_class in TOKEN_CLASSES:
        if token_type in parent:
            return css_class
    return ''


def highlight(code, lang):
    """Код → HTML со <span class="kw|fn|str|num|cm">.

    Неизвестный язык — без подсветки.
    """
    try:
        lexer = get_lexer_by_name(lang, stripnl=False, ensurenl=False)
    except ClassNotFound:
        return html.escape(code)
    return highlight_tokens(code, lexer)


def highlight_file(code, filename):
    """Как highlight, но язык — по имени файла (nginx.conf, Dockerfile, app.py)."""
    try:
        lexer = get_lexer_for_filename(filename, stripnl=False, ensurenl=False)
    except ClassNotFound:
        return html.escape(code)
    return highlight_tokens(code, lexer)


def highlight_tokens(code, lexer):
    # Соседние токены одного класса склеиваем: строка "M" — один <span>, а не три
    groups = []
    for token_type, value in lexer.get_tokens(code):
        css_class = token_class(token_type)
        if groups and groups[-1][0] == css_class:
            groups[-1][1] += value
        else:
            groups.append([css_class, value])

    parts = []
    for css_class, value in groups:
        text = html.escape(value)
        parts.append(f'<span class="{css_class}">{text}</span>' if css_class else text)
    return ''.join(parts)


def render_fence(self, tokens, idx, options, env):
    """Блок кода → компонент .code-block: подпись языка, кнопка «Копировать», код.

    Блок без языка — вывод программы («Результат:»): подпись «вывод», без кнопки.
    """
    token = tokens[idx]
    lang = token.info.strip().split(' ')[0]
    code = token.content.rstrip('\n')
    if lang:
        head = (
            f'<span>{html.escape(lang)}</span>'
            '<button type="button" class="code-block__copy">Копировать</button>'
        )
        body = highlight(code, lang)
    else:
        head = '<span>вывод</span>'
        body = html.escape(code)
    return (
        f'<div class="code-block"><div class="code-block__head">{head}</div>'
        f'<pre>{body}</pre></div>\n'
    )


def render_table_open(self, tokens, idx, options, env):
    return '<div class="table-wrap table-wrap--bordered"><table class="data-table">\n'


def render_table_close(self, tokens, idx, options, env):
    return '</table></div>\n'


SVG_ID = re.compile(r'\bid="([^"]+)"')


def inline_svg(path, prefix):
    """Текст SVG-файла для вставки прямо в страницу.

    id внутри рисунка получают префикс: у разных рисунков одинаковые id ("t", "a"),
    а на одной странице id должны быть уникальны — иначе подпись и стрелки
    одного рисунка сошлются на элементы другого.
    """
    svg = path.read_text(encoding='utf-8')
    svg = re.sub(r'<\?xml[^>]*\?>\s*', '', svg)
    for old_id in set(SVG_ID.findall(svg)):
        new_id = f'{prefix}-{old_id}'
        svg = svg.replace(f'id="{old_id}"', f'id="{new_id}"')
        svg = svg.replace(f'url(#{old_id})', f'url(#{new_id})')
        svg = svg.replace(f'href="#{old_id}"', f'href="#{new_id}"')
        svg = re.sub(
            rf'(aria-(?:labelledby|describedby)="[^"]*)\b{re.escape(old_id)}\b',
            rf'\g<1>{new_id}', svg,
        )
    return svg.strip()


def render_image(self, tokens, idx, options, env):
    """Рисунок урока. SVG из img/ вставляется в страницу целиком — так он берёт
    цвета из переменных темы и меняется вместе с ней."""
    token = tokens[idx]
    src = token.attrGet('src') or ''
    base_dir = env.get('base_dir')
    if base_dir and src.endswith('.svg') and '://' not in src:
        path = Path(base_dir) / src
        if not path.is_file():
            raise FileNotFoundError(f'нет файла рисунка {src}')
        return inline_svg(path, prefix=f'fig-{path.stem}')
    return self.image(tokens, idx, options, env)


def build_markdown():
    """Настроенный парсер: CommonMark (как GitHub) + таблицы + HTML-вставки."""
    md = MarkdownIt('commonmark', {'html': True}).enable('table')
    md.add_render_rule('fence', render_fence)
    md.add_render_rule('table_open', render_table_open)
    md.add_render_rule('table_close', render_table_close)
    md.add_render_rule('image', render_image)
    return md


MD = build_markdown()

SUMMARY = re.compile(r'<summary>(.*?)</summary>', flags=re.S)


def render_markdown(text, base_dir=None):
    """Markdown → HTML. base_dir — папка урока, откуда берутся рисунки img/*.svg."""
    result = MD.render(text, {'base_dir': base_dir})
    # Вопросы на собеседовании (<details>) — в виде карточек FAQ из дизайна.
    # Внутри <summary> CommonMark Markdown не обрабатывает — делаем это сами (`код`).
    result = result.replace('<details>', '<details class="faq__item">')
    return SUMMARY.sub(
        lambda m: f'<summary>{MD.renderInline(m.group(1).strip())}</summary>', result,
    )


def render_inline(text):
    """Короткий текст (подсказка, вариант ответа) → HTML без абзаца <p>."""
    return MD.renderInline(text.strip())
