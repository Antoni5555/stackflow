"""Описание страницы для поиска и превью ссылок (meta description, og:description).

View кладёт в контекст meta_description (и при желании meta_title — заголовок превью),
base.html выводит их; без них — общее описание сайта.
"""
import html
import re

from django.utils.html import strip_tags


# Столько символов поисковик показывает под ссылкой; длиннее — обрежет посреди слова
DESCRIPTION_LENGTH = 160
# Абзац короче — к нему добавляем следующие (первый абзац бывает «… по условию:»)
ENOUGH = 100
PARAGRAPH = re.compile(r'<p\b[^>]*>(.*?)</p>', re.S)
CAPTION = re.compile(r'^(Таблица|Рисунок) \d+\.')   # подписи к таблицам и рисункам
NEXT_SECTION = re.compile(r'<h2\b')


def plain_text(fragment):
    """HTML → одна строка текста: без тегов, сущности раскрыты, пробелы схлопнуты."""
    return ' '.join(html.unescape(strip_tags(fragment)).split())


def shorten(text, limit=DESCRIPTION_LENGTH):
    """Не длиннее limit: обрезаем по целому слову и ставим «…»."""
    if len(text) <= limit:
        return text
    cut = text[:limit - 1].rsplit(' ', 1)[0]
    return cut.rstrip(' ,;:—-') + '…'


def summary(fragment, prefix=''):
    """Описание из HTML урока или условия: абзацы с начала, пока текста не наберётся
    на описание; без абзацев — весь текст."""
    # только первый раздел урока («Теория»): дальше — «Наглядно», «Частые ошибки»…
    sections = NEXT_SECTION.split(fragment)
    starts_with_heading = len(sections) > 1 and not sections[0].strip()
    first = sections[1] if starts_with_heading else sections[0]
    text = ''
    for paragraph in PARAGRAPH.findall(first):
        if '<svg' in paragraph or '<img' in paragraph:   # рисунок, а не текст
            continue
        paragraph = plain_text(paragraph)
        if CAPTION.match(paragraph):
            continue
        text = f'{text} {paragraph}'.strip()
        if len(text) >= ENOUGH:
            break
    return shorten(f'{prefix}{text or plain_text(fragment)}')
