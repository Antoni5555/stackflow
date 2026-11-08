"""Логотип STACKFLOW: знак «Слои» + надпись Manrope 600 строчными.

Буквы берутся из файла шрифта сайта (src/static/fonts) и становятся SVG-путями,
поэтому файлы логотипа не зависят от установленных шрифтов. Кернинг считает HarfBuzz.
Собирает design/logo/: SVG логотипа и знака, иконки вкладки, лист index.html.

Нужны пакеты fonttools, brotli, uharfbuzz, Pillow и Inkscape (PNG):
    python -m venv .venv && .venv/bin/pip install fonttools brotli uharfbuzz pillow
    .venv/bin/python design/_tools/logo_gen.py
"""
import subprocess
from io import BytesIO
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT.parent / 'src' / 'static' / 'fonts'
OUT = ROOT / 'logo'

LIME, LIME_DARK, INK, PAPER, WHITE = '#dcf25c', '#b9d13a', '#0e0e0e', '#f3f3f1', '#ffffff'
CAP_HEIGHT = 44   # высота прописной буквы при знаке высотой 100


def text_path(font_file, text, tracking=0.0):
    """SVG-путь надписи (единицы шрифта), ширина и высота прописной буквы."""
    tt = TTFont(FONTS / font_file)
    buf = BytesIO()
    tt.flavor = None
    tt.save(buf)
    face = hb.Face(buf.getvalue())
    font = hb.Font(face)
    run = hb.Buffer()
    run.add_str(text)
    run.guess_segment_properties()
    hb.shape(font, run, {'kern': True, 'liga': False})

    glyphs = tt.getGlyphSet()
    order = tt.getGlyphOrder()
    pen = SVGPathPen(glyphs)
    upem = tt['head'].unitsPerEm
    x = 0
    for info, pos in zip(run.glyph_infos, run.glyph_positions):
        name = order[info.codepoint]
        glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, x + pos.x_offset, 0)))
        x += pos.x_advance + tracking * upem
    x -= tracking * upem

    bounds = BoundsPen(glyphs)
    glyphs[tt.getBestCmap()[ord('H')]].draw(bounds)
    return pen.getCommands(), x, bounds.bounds[3]


MARK_BOX = '6 9 88 88'   # знак с полями, квадрат
FONT = 'manrope-latin-600.woff2'
WORD, TRACKING = 'stackflow', -0.01
ICON_MARK_SCALE = 0.84


def mark(top, layers, layer_width=10):
    return (f'<path d="M50 14L88 34L50 54L12 34Z" fill="{top}" stroke="{top}" stroke-width="8" stroke-linejoin="round"/>'
            f'<path d="M12 52L50 72L88 52M12 70L50 90L88 70" fill="none" stroke="{layers}" stroke-width="{layer_width}" '
            'stroke-linecap="round" stroke-linejoin="round"/>')


def lockup(top, layers, text):
    d, width, cap = text_path(FONT, WORD, TRACKING)
    k = CAP_HEIGHT / cap
    x = 108
    y = 53 + CAP_HEIGHT / 2          # надпись по центру знака
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="6 9 {x + width * k:.1f} 88" role="img" aria-label="STACKFLOW">'
            f'{mark(top, layers)}<path transform="translate({x} {y}) scale({k:.5f})" d="{d}" fill="{text}"/></svg>')


def mark_svg(top, layers):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{MARK_BOX}" role="img" aria-label="STACKFLOW">'
            f'{mark(top, layers)}</svg>')


def icon_svg(radius):
    """Большая иконка: полный знак на своей тёмной плашке."""
    k = ICON_MARK_SCALE
    shift = 50 - 53 * k, 50 - 52.5 * k
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="STACKFLOW">'
            f'<rect width="100" height="100" rx="{radius}" fill="{INK}"/>'
            f'<g transform="translate({shift[0]:.2f} {shift[1]:.2f}) scale({k})">{mark(WHITE, LIME, 11)}</g></svg>')


def favicon_svg():
    """Вкладка: на 16 px два нижних слоя сливаются, поэтому слой один и потолще."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="STACKFLOW">'
            f'<rect width="100" height="100" rx="24" fill="{INK}"/>'
            f'<path d="M50 17L84 35L50 53L16 35Z" fill="{WHITE}" stroke="{WHITE}" stroke-width="8" stroke-linejoin="round"/>'
            f'<path d="M16 62L50 80L84 62" fill="none" stroke="{LIME}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg>')


PAGE = """<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>STACKFLOW — логотип</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<style>
  body {{ margin: 0; padding: 32px 16px 64px; font-family: system-ui, sans-serif; color: #f1f1ee; background: #161618; }}
  main {{ max-width: 1000px; margin: 0 auto; display: grid; gap: 28px; }}
  h1 {{ margin: 0; font-size: 28px; }}
  h2 {{ margin: 0 0 12px; font-size: 19px; }}
  .row {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }}
  .tile {{ display: flex; align-items: center; justify-content: center; gap: 32px; min-height: 150px; padding: 28px; border-radius: 20px; box-sizing: border-box; }}
  .dark {{ background: {ink}; }}
  .light {{ background: {paper}; }}
  img {{ display: block; }}
  .lockup {{ width: 100%; max-width: 360px; }}
  .small {{ min-height: 0; justify-content: flex-start; padding: 14px 24px; }}
  .small img {{ height: 30px; }}
  .mark {{ width: 96px; }}
</style></head><body><main>
<h1>STACKFLOW</h1>
<section><h2>Логотип</h2>
<div class="row"><div class="tile dark"><img class="lockup" src="stackflow-dark.svg" alt=""></div><div class="tile light"><img class="lockup" src="stackflow-light.svg" alt=""></div></div></section>
<section><h2>Размер шапки</h2>
<div class="row"><div class="tile small dark"><img src="stackflow-dark.svg" alt=""></div><div class="tile small light"><img src="stackflow-light.svg" alt=""></div></div></section>
<section><h2>Знак</h2>
<div class="row"><div class="tile dark"><img class="mark" src="mark-dark.svg" alt=""></div><div class="tile light"><img class="mark" src="mark-light.svg" alt=""></div></div></section>
<section><h2>Иконка вкладки: 64, 32, 16 px</h2>
<div class="row"><div class="tile dark">{icons}</div><div class="tile light">{icons}</div></div></section>
</main></body></html>
"""


def png(svg_file, size):
    target = svg_file.with_name(f'{svg_file.stem}-{size}.png')
    subprocess.run(['inkscape', str(svg_file), '--export-type=png', f'--export-filename={target}',
                    '-w', str(size), '-h', str(size)], check=True, capture_output=True)
    return target


if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    files = {
        'stackflow-dark.svg': lockup(WHITE, LIME, LIME),
        'stackflow-light.svg': lockup(LIME_DARK, INK, INK),
        'mark-dark.svg': mark_svg(WHITE, LIME),
        'mark-light.svg': mark_svg(LIME_DARK, INK),
        'favicon.svg': favicon_svg(),
    }
    for name, content in files.items():
        (OUT / name).write_text(content + '\n', encoding='utf-8')

    # ICO — для браузеров, которые сами просят /favicon.ico; apple-touch — без скруглений, iOS скругляет сам
    sizes = [png(OUT / 'favicon.svg', s) for s in (16, 32, 48)]
    Image.open(sizes[2]).save(OUT / 'favicon.ico', append_images=[Image.open(f) for f in sizes[:2]], sizes=[(16, 16), (32, 32), (48, 48)])
    for f in sizes:
        f.unlink()
    square = OUT / 'apple-touch-icon.svg'
    square.write_text(icon_svg(0), encoding='utf-8')
    png(square, 180).replace(OUT / 'apple-touch-icon.png')
    square.unlink()

    icons = ''.join(f'<img src="favicon.svg" width="{s}" height="{s}" alt="">' for s in (64, 32, 16))
    html = PAGE.format(ink=INK, paper=PAPER, icons=icons)
    (OUT / 'index.html').write_text(html, encoding='utf-8')
    print('ok', sorted(f.name for f in OUT.iterdir()))
