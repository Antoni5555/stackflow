"""Все SVG-рисунки уроков. Запуск: python3 content/_tools/figures.py — пересоздаёт файлы."""
from pathlib import Path

from svgkit import Figure

ROOT = Path(__file__).resolve().parents[1] / "backend"
PY1 = ROOT / "python" / "01-first-steps"
INT3 = ROOT / "python-internals" / "03-collections-internals"


def out(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


# ---------- Python 1.01: устройство traceback ----------
def traceback_anatomy():
    f = Figure(880, 276, "Устройство сообщения об ошибке: читаем снизу вверх")
    f.raw('<rect x="20" y="20" width="560" height="176" rx="14" class="fig-term"/>')
    rows = [
        ('Traceback (most recent call last):', "tt"),
        ('  File "main.py", line 2, in <module>', "tt"),
        ('    prnt("Заказ №1042 принят")', "tt"),
        ("    ^^^^", "tterr"),
        ("NameError: name 'prnt' is not defined.", "tterr"),
        ("Did you mean: 'print'?", "tterr"),
    ]
    for i, (s, cls) in enumerate(rows):
        f.text(40, 52 + i * 26, s, cls)
    notes = [  # (y строки, номер, подпись)
        (166, "1", "тип ошибки и сообщение — читаем первым"),
        (117, "2", "строка кода и место ошибки в ней"),
        (78, "3", "файл и номер строки"),
        (52, "4", "заголовок: дальше идёт отчёт об ошибке"),
    ]
    for y, n, s in notes:
        f.line(f"M584 {y - 5}H620", "lnd")
        f.raw(f'<circle cx="634" cy="{y - 5}" r="11" class="fig-acc"/>')
        f.text(634, y, n, "onacc", "middle")
        f.text(652, y, s, "s")
    f.arrow("M870 180V40")
    f.text(20, 231, "Читаем снизу вверх: сначала что случилось, потом где.", "t")
    f.text(20, 254, "Python показывает подсказку «Did you mean», если похожее имя существует.", "s")
    f.save(out(PY1 / "01-first-program" / "img" / "traceback-anatomy.svg"))


# ---------- Python 1.02: имена и значения ----------
def names_to_values():
    f = Figure(640, 310, "Имена переменных указывают на значения, у каждого значения свой тип")
    f.text(20, 20, "имя", "h"); f.text(260, 20, "значение", "h"); f.text(520, 20, "тип значения", "h")
    rows = [("name", '"Беспроводная мышь"', "str"), ("price", "1499", "int"), ("rating", "4.7", "float"),
            ("is_active", "True", "bool"), ("discount", "None", "NoneType")]
    for i, (n, val, t) in enumerate(rows):
        y = 36 + i * 54
        f.box(20, y, 150, 38, n, "box", "c", rx=19)
        f.arrow(f"M174 {y + 19}H254")
        f.raw(f'<rect x="260" y="{y}" width="240" height="38" rx="10" class="fig-box2"/>')
        f.text(276, y + 24, val, "c")
        f.raw(f'<rect x="520" y="{y + 5}" width="100" height="28" rx="14" class="fig-acc"/>')
        f.text(570, y + 24, t, "onacc", "middle")
    f.save(out(PY1 / "02-variables-and-types" / "img" / "names-to-values.svg"))


# ---------- Python 1.04: индексы и срез строки ----------
def string_indices():
    f = Figure(620, 250, "Индексы символов строки: положительные слева, отрицательные справа; срез не включает конец")
    sku = "KB-0142"
    x0, w = 60, 70
    f.text(20, 72, "индекс", "s"); f.text(20, 172, "с конца", "s")
    for i, ch in enumerate(sku):
        x = x0 + i * w
        cls = "acc" if 3 <= i <= 6 else "box2"
        f.raw(f'<rect x="{x}" y="90" width="{w - 6}" height="56" rx="10" class="fig-{cls}"/>')
        f.text(x + (w - 6) / 2, 125, ch, "onacc" if cls == "acc" else "c", "middle")
        f.text(x + (w - 6) / 2, 76, str(i), "cs", "middle")
        f.text(x + (w - 6) / 2, 172, str(i - len(sku)), "cs", "middle")
    f.text(20, 30, 'sku = "KB-0142"', "c")
    f.text(20, 214, 'sku[3:7] → "0142"  (символы 3, 4, 5, 6 — индекс 7 не входит)', "c")
    f.text(20, 238, "sku[0] → \"K\"   sku[-1] → \"2\"   sku[:2] → \"KB\"", "cs")
    f.save(out(PY1 / "04-strings" / "img" / "string-indices.svg"))


# ---------- Python 1.07: цепочка if/elif/else ----------
def delivery_elif():
    f = Figure(760, 470, "Цепочка if/elif/else: проверки идут сверху вниз, срабатывает первая истинная")
    f.box(250, 20, 260, 44, "сумма заказа: total", "box")
    f.arrow("M380 64V96")
    f.diamond(380, 140, 260, 84, "total >= 3000 ?")
    f.box(580, 118, 160, 44, "delivery = 0", "ok", "c")
    f.arrow("M510 140H576"); f.text(526, 132, "да", "s")
    f.arrow("M380 182V222"); f.text(390, 206, "нет", "s")
    f.diamond(380, 266, 260, 84, "total >= 1000 ?")
    f.box(580, 244, 160, 44, "delivery = 199", "ok", "c")
    f.arrow("M510 266H576"); f.text(526, 258, "да", "s")
    f.arrow("M380 308V348"); f.text(390, 332, "нет (else)", "s")
    f.box(300, 352, 160, 44, "delivery = 399", "ok", "c")
    f.box(250, 420, 260, 40, "дальше по программе", "box2")
    f.arrow("M380 396V416")
    f.arrow("M660 162V200H740V440H514")
    f.line("M660 288V300H740")
    f.text(20, 140, "if", "c"); f.text(20, 266, "elif", "c"); f.text(20, 376, "else", "c")
    f.save(out(PY1 / "07-conditions" / "img" / "delivery-elif.svg"))


# ---------- Python 1.08: цикл while ----------
def while_loop():
    f = Figure(720, 400, "Цикл while: условие проверяется перед каждым повтором; break выходит из цикла сразу")
    f.box(240, 20, 240, 44, "stock = 3", "box", "c")
    f.arrow("M360 64V96")
    f.diamond(360, 140, 240, 84, "stock > 0 ?")
    f.box(240, 230, 240, 64, "тело цикла:|stock -= 1", "box2", "c")
    f.arrow("M360 182V226"); f.text(370, 210, "да", "s")
    f.arrow("M240 262H120V140H236"); f.text(130, 196, "повтор:", "s"); f.text(130, 214, "проверить", "s"); f.text(130, 232, "условие снова", "s")
    f.box(540, 118, 160, 44, "после цикла", "ok")
    f.arrow("M480 140H536"); f.text(496, 132, "нет", "s")
    f.arrow("M480 270H620V166", "lnd"); f.text(500, 290, "break — выход сразу", "s")
    f.text(20, 340, "Если в теле ничего не меняет stock, условие всегда истинно — цикл бесконечный.", "t")
    f.text(20, 364, "continue — сразу к проверке условия, пропуская остаток тела.", "s")
    f.save(out(PY1 / "08-while-loop" / "img" / "while-loop.svg"))


# ---------- Под капотом 3.03: поиск ключа в dict ----------
def dict_lookup():
    f = Figure(900, 420, "Как dict ищет ключ: хеш, ячейка, сравнение через ==")
    f.box(20, 20, 180, 46, 'ключ: (42, "M")', "box", "c")
    f.box(250, 20, 170, 46, "hash(ключ)", "box", "c")
    f.box(470, 20, 170, 46, "номер ячейки")
    f.arrow("M200 43H246"); f.arrow("M420 43H466"); f.arrow("M555 66V106")
    f.diamond(555, 150, 240, 84, "В ячейке что-то есть?")
    f.box(710, 128, 170, 44, "KeyError", "err", "errt")
    f.arrow("M675 150H706"); f.text(680, 142, "нет", "s")
    f.arrow("M555 192V234"); f.text(565, 218, "да", "s")
    f.diamond(555, 278, 260, 84, "Лежащий ключ == искомый?")
    f.box(450, 350, 210, 46, "значение найдено", "ok")
    f.arrow("M555 320V346"); f.text(565, 338, "да", "s")
    f.box(60, 256, 250, 44, "следующая ячейка (коллизия)", "box")
    f.arrow("M425 278H314"); f.text(380, 270, "нет", "s")
    f.arrow("M185 256V150H431"); f.text(195, 140, "проверяем её так же", "s")
    f.save(out(INT3 / "03-hashable-and-immutability" / "img" / "dict-lookup.svg"))


# ---------- Под капотом 3.03: потерянный ключ ----------
def lost_key():
    f = Figure(760, 300, "Ключ изменили после вставки: поиск по старому и новому хешу не находит запись")
    for i in range(8):
        x = 40 + i * 85
        f.text(x + 40, 124, str(i), "s", "middle")
        if i == 1:
            f.raw(f'<rect x="{x}" y="132" width="80" height="64" rx="10" class="fig-err"/>')
            f.text(x + 40, 158, "SKU(1002)", "cs", "middle"); f.text(x + 40, 180, "→ 12", "cs", "middle")
        else:
            f.raw(f'<rect x="{x}" y="132" width="80" height="64" rx="10" class="fig-{"dash" if i == 2 else "box2"}"/>')
    f.text(420, 222, "ячейки таблицы dict из 8 мест", "h")
    f.text(40, 26, "SKU(1001) in stock", "c")
    f.text(40, 48, "hash(1001) % 8 = 1 → ячейка 1: ячейка та, но в ней уже ключ 1002", "s")
    f.arrow("M165 58V128"); f.text(177, 96, "== даёт False → не найден", "errt")
    f.arrow("M250 248V200")
    f.text(220, 268, "key in stock", "c")
    f.text(220, 290, "hash(1002) % 8 = 2 → ячейка 2: она пуста → не найден", "s")
    f.save(out(INT3 / "03-hashable-and-immutability" / "img" / "lost-key.svg"))


PY2 = ROOT / "python" / "02-collections"


# ---------- Python 2.04: операции над множествами ----------
def sets_venn():
    f = Figure(760, 390, "Операции над множествами на примере покупателей мыши и клавиатуры")
    f.raw('<circle cx="300" cy="150" r="115" class="fig-m1 fig-venn"/>')
    f.raw('<circle cx="460" cy="150" r="115" class="fig-m2 fig-venn"/>')
    f.text(300, 24, "mouse = {1, 2, 3, 5}", "c", "middle")
    f.text(460, 290, "keyboard = {2, 3, 8}", "c", "middle")
    f.text(250, 156, "1, 5", "c", "middle"); f.text(250, 176, "только мышь", "s", "middle")
    f.text(380, 156, "2, 3", "c", "middle"); f.text(380, 176, "оба товара", "s", "middle")
    f.text(515, 156, "8", "c", "middle"); f.text(515, 176, "только клавиатура", "s", "middle")
    rows = [("mouse & keyboard", "{2, 3}", "пересечение: купили оба"),
            ("mouse | keyboard", "{1, 2, 3, 5, 8}", "объединение: купили хоть что-то"),
            ("mouse - keyboard", "{1, 5}", "разность: мышь, но не клавиатуру"),
            ("mouse ^ keyboard", "{1, 5, 8}", "ровно один из двух товаров")]
    for i, (expr, res, note) in enumerate(rows):
        y = 320 + i * 20
        f.text(40, y, expr, "cs"); f.text(220, y, "→ " + res, "cs"); f.text(400, y, note, "s")
    f.save(out(PY2 / "04-sets" / "img" / "sets-venn.svg"))


# ---------- Python 2.05: вложенный заказ ----------
def nested_order():
    f = Figure(860, 380, "Структура заказа: словарь со вложенным словарём и списком словарей")
    f.text(20, 24, 'order["items"][0]["price"]  →  1499', "c")
    f.box(20, 40, 820, 320, "", "box")
    f.text(36, 64, "order — dict", "h")
    f.text(40, 98, '"id": 1042', "c"); f.text(40, 126, '"status": "paid"', "c")
    f.text(40, 172, '"customer":', "c"); f.arrow("M150 167H216")
    f.box(220, 146, 300, 46, "", "box2"); f.text(236, 174, '{"name": "Анна", "city": None}', "cs")
    f.text(526, 160, "dict", "h")
    f.text(40, 236, '"items":', "c"); f.arrow("M122 231H216")
    f.box(220, 208, 610, 140, "", "box2"); f.text(236, 228, "list", "h")
    for k, (name, price, qty) in enumerate([("Мышь", "1499", "2"), ("Коврик", "490", "1")]):
        x = 236 + k * 296
        f.text(x, 252, f"[{k}] — dict", "s")
        f.box(x, 258, 280, 80, "", "box")
        if k == 0:
            f.raw(f'<rect x="{x + 8}" y="{258 + 30}" width="130" height="22" rx="6" class="fig-acc"/>')
        f.text(x + 14, 280, f'"name": "{name}"', "cs")
        f.text(x + 14, 304, f'"price": {price}', "onacc" if k == 0 else "cs")
        f.text(x + 14, 328, f'"qty": {qty}', "cs")
    f.save(out(PY2 / "05-nested-structures" / "img" / "nested-order.svg"))


# ---------- Python 2.06: присваивание, copy, deepcopy ----------
def copy_modes():
    f = Figure(900, 290, "Присваивание, поверхностная и глубокая копия списка со вложенным словарём")
    panels = [("b = a", "одно и то же: изменения|видны через оба имени"),
              ("b = a.copy()", "внешний список новый,|а вложенный словарь общий"),
              ("b = copy.deepcopy(a)", "полностью независимая|копия")]
    for p, (title, note) in enumerate(panels):
        x0 = 10 + p * 300
        f.text(x0 + 10, 24, title, "c")
        f.box(x0 + 10, 60, 46, 32, "a", "box", "c", rx=16)
        f.box(x0 + 10, 150, 46, 32, "b", "box", "c", rx=16)
        if p == 0:
            f.box(x0 + 100, 100, 70, 40, "[ • ]", "box2", "c")
            f.arrow(f"M{x0 + 56} 76L{x0 + 98} 112"); f.arrow(f"M{x0 + 56} 166L{x0 + 98} 128")
            f.box(x0 + 200, 100, 80, 40, "qty: 2", "box", "cs")
            f.arrow(f"M{x0 + 170} 120H{x0 + 196}")
        elif p == 1:
            f.box(x0 + 100, 56, 70, 40, "[ • ]", "box2", "c"); f.box(x0 + 100, 146, 70, 40, "[ • ]", "box2", "c")
            f.arrow(f"M{x0 + 56} 76H{x0 + 96}"); f.arrow(f"M{x0 + 56} 166H{x0 + 96}")
            f.box(x0 + 200, 100, 80, 40, "qty: 2", "err", "cs")
            f.arrow(f"M{x0 + 170} 76L{x0 + 198} 108"); f.arrow(f"M{x0 + 170} 166L{x0 + 198} 132")
        else:
            for y in (56, 146):
                f.box(x0 + 100, y, 70, 40, "[ • ]", "box2", "c")
                f.box(x0 + 200, y, 80, 40, "qty: 2", "ok", "cs")
                f.arrow(f"M{x0 + 170} {y + 20}H{x0 + 196}")
            f.arrow(f"M{x0 + 56} 76H{x0 + 96}"); f.arrow(f"M{x0 + 56} 166H{x0 + 96}")
        for k, line in enumerate(note.split("|")):
            f.text(x0 + 10, 230 + k * 18, line, "s")
    f.save(out(PY2 / "06-mutability" / "img" / "copy-modes.svg"))


# ---------- Python 2.07: устройство comprehension ----------
def comprehension_anatomy():
    f = Figure(760, 300, "Части list comprehension и соответствующие строки обычного цикла")
    cw = 8.4  # ширина символа JetBrains Mono 14px

    def seg(x0, y, col, n, cls, num=None):
        f.raw(f'<rect x="{x0 + col * cw - 2}" y="{y - 17}" width="{n * cw + 4}" height="24" rx="5" class="fig-{cls}"/>')
        if num:
            f.raw(f'<circle cx="{x0 + col * cw + n * cw / 2}" cy="{y - 30}" r="10" class="fig-{cls} fig-venn"/>')
            f.text(x0 + col * cw + n * cw / 2, y - 26, num, "cs", "middle")

    x0, y = 30, 64
    seg(x0, y, 1, 12, "acc", "1"); seg(x0, y, 14, 20, "m1", "2"); seg(x0, y, 35, 20, "m3", "3")
    f.text(x0, y, 'names = [item["name"] for item in products if item["stock"] > 0]'.replace("names = ", ""), "c")
    f.text(x0, 112, "то же самое циклом:", "s")
    lines = ["names = []", "for item in products:", '    if item["stock"] > 0:', '        names.append(item["name"])']
    ys = [146, 174, 202, 230]
    seg(x0, ys[1], 0, 20, "m1"); seg(x0, ys[2], 4, 20, "m3"); seg(x0, ys[3], 21, 12, "acc")
    for line, yy in zip(lines, ys):
        f.text(x0, yy, line, "c")
    f.text(x0, 272, "1 — что кладём в результат   2 — откуда берём элементы   3 — какие оставляем (необязательно)", "s")
    f.save(out(PY2 / "07-comprehensions" / "img" / "comprehension-anatomy.svg"))


PY3 = ROOT / "python" / "03-functions"


# ---------- Python 3.02: изменяемое значение по умолчанию ----------
def mutable_default():
    f = Figure(780, 270, "Изменяемое значение по умолчанию создаётся один раз и копит данные между вызовами")
    f.box(20, 30, 330, 70, "", "box")
    f.text(36, 60, "def add_to_cart(item, cart=[]):", "cs")
    f.text(36, 84, "[] создаётся один раз — при выполнении def", "s")
    f.box(440, 42, 320, 46, '["мышь", "коврик"]', "err", "c")
    f.arrow("M350 65H436"); f.text(362, 56, "cart по умолчанию", "s")
    f.text(20, 150, 'add_to_cart("мышь")', "c"); f.text(250, 150, '→ ["мышь"]', "c")
    f.text(20, 180, 'add_to_cart("коврик")', "c"); f.text(250, 180, '→ ["мышь", "коврик"]  — ожидали ["коврик"]', "c")
    f.text(440, 108, "один и тот же список для всех вызовов", "errt")
    f.text(20, 230, "Исправление: cart=None, а внутри — if cart is None: cart = []", "t")
    f.text(20, 252, "Тогда новый список создаётся при каждом вызове.", "s")
    f.save(out(PY3 / "02-parameters" / "img" / "mutable-default.svg"))


# ---------- Python 3.04: области видимости LEGB ----------
def legb_scopes():
    f = Figure(820, 330, "Области видимости LEGB: имя ищется от локальной области наружу")
    f.box(20, 20, 660, 290, "", "box2"); f.text(36, 44, "Built-in — встроенные имена", "h"); f.text(36, 64, "print, len, sum, max …", "cs")
    f.box(50, 80, 600, 220, "", "box"); f.text(66, 104, "Global — уровень модуля", "h"); f.text(66, 124, "TAX_RATE = 20", "cs")
    f.box(80, 140, 540, 150, "", "box2"); f.text(96, 164, "Enclosing — внешняя функция", "h"); f.text(96, 184, "def make_order(): discount = 10", "cs")
    f.raw('<rect x="110" y="200" width="480" height="80" rx="12" class="fig-m1"/>')
    f.text(126, 224, "Local — текущая функция", "h"); f.text(126, 248, "def apply(price): result = price * …", "cs")
    f.arrow("M700 290V30")
    for y, label in ((248, "1  Local"), (184, "2  Enclosing"), (124, "3  Global"), (64, "4  Built-in")):
        f.text(712, y, label, "t")
    f.text(700, 318, "первое найденное имя побеждает", "s", "middle")
    f.save(out(PY3 / "04-scope" / "img" / "legb-scopes.svg"))


# ---------- Python 3.07: стек рекурсивных вызовов ----------
def recursion_stack():
    f = Figure(880, 280, "Рекурсия: вызовы спускаются до базового случая, результаты поднимаются обратно")
    f.text(20, 24, "вызовы", "h"); f.text(520, 24, "возвраты", "h")
    calls = [("path(5)  — Мыши", "parent_id = 2 → ждёт path(2)", "box"),
             ("path(2)  — Периферия", "parent_id = 1 → ждёт path(1)", "box"),
             ("path(1)  — Электроника", "parent_id = None → базовый случай", "ok")]
    rets = ['"Электроника > Периферия > Мыши"', '"Электроника > Периферия"', '"Электроника"']
    for i, (title, sub, cls) in enumerate(calls):
        x, y = 20 + i * 40, 40 + i * 76
        f.box(x, y, 380, 56, "", cls)
        f.text(x + 14, y + 24, title, "c"); f.text(x + 14, y + 44, sub, "s")
        f.text(520, y + 34, "← " + rets[i], "cs")
        if i < 2:
            f.arrow(f"M{x + 60} {y + 56}V{y + 74}")
            f.arrow(f"M560 {y + 64}V{y + 46}", "lnd")
    f.text(20, 268, "Без базового случая вызовы не остановятся: RecursionError после ~1000 уровней.", "s")
    f.save(out(PY3 / "07-recursion" / "img" / "recursion-stack.svg"))


# ---------- Python 3.08: декоратор оборачивает функцию ----------
def decorator_wrap():
    f = Figure(780, 300, "Декоратор: имя функции теперь указывает на обёртку, которая вызывает исходную функцию")
    f.text(20, 26, "@log_call  ≡  add_to_cart = log_call(add_to_cart)", "c")
    f.box(20, 120, 150, 40, "add_to_cart", "box", "c", rx=20)
    f.arrow("M170 140H206")
    f.box(210, 50, 540, 232, "", "box2"); f.text(226, 72, "wrapper — функция, которую вернул log_call", "h")
    f.text(226, 100, "1. до вызова: print(\"вызов add_to_cart\", args)", "cs")
    f.box(240, 116, 340, 56, "", "box"); f.text(256, 140, "2. result = func(*args, **kwargs)", "cs")
    f.text(256, 160, "func — исходная add_to_cart", "s")
    f.text(226, 200, "3. после вызова: print(\"результат\", result)", "cs")
    f.text(226, 228, "4. return result", "cs")
    f.text(226, 256, "забыли return — любой вызов вернёт None", "errt")
    f.save(out(PY3 / "08-decorators" / "img" / "decorator-wrap.svg"))


PY4 = ROOT / "python" / "04-exceptions"


# ---------- Python 4.01: пути выполнения try / except / else / finally ----------
def try_flow():
    f = Figure(860, 300, "Какие блоки выполняются: без ошибки, с пойманной и с непойманной ошибкой")
    lanes = [("ошибки нет", [("try", "box2", "весь"), ("else", "ok", ""), ("finally", "box2", ""), ("дальше", "box", "")]),
             ("ошибка поймана", [("try", "box2", "до ошибки"), ("except", "err", ""), ("finally", "box2", ""), ("дальше", "box", "")]),
             ("ошибку не поймали", [("try", "box2", "до ошибки"), ("finally", "box2", ""), ("ошибка — выше", "err", "")])]
    for i, (title, steps) in enumerate(lanes):
        y = 40 + i * 86
        f.text(20, y + 30, title, "t")
        for k, (name, cls, sub) in enumerate(steps):
            x = 190 + k * 165
            f.box(x, y, 140, 46, "", cls)
            f.text(x + 70, y + 22 if sub else y + 28, name, "c", "middle")
            if sub:
                f.text(x + 70, y + 38, sub, "s", "middle")
            if k < len(steps) - 1:
                f.arrow(f"M{x + 140} {y + 23}H{x + 161}")
    f.text(20, 292, "finally выполняется всегда — даже если ошибка полетела дальше или в try сработал return.", "s")
    f.save(out(PY4 / "01-exceptions" / "img" / "try-flow.svg"))


# ---------- Python 4.03: traceback из нескольких вызовов ----------
def traceback_stack():
    f = Figure(900, 400, "Traceback цепочки вызовов: внизу — где упало, выше — кто вызвал")
    f.raw('<rect x="20" y="20" width="600" height="336" rx="14" class="fig-term"/>')
    rows = [("Traceback (most recent call last):", "tt"),
            ('  File "main.py", line 12, in <module>', "tt"),
            ('    print(checkout([1499, 490], "WINTER-15"))', "tt"),
            ("          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^", "tterr"),
            ('  File "main.py", line 8, in checkout', "tt"),
            ("    percent = parse_percent(code)", "tt"),
            ("              ^^^^^^^^^^^^^^^^^^^", "tterr"),
            ('  File "main.py", line 3, in parse_percent', "tt"),
            ("    return int(code[5:])", "tt"),
            ("           ^^^^^^^^^^^^^", "tterr"),
            ("ValueError: invalid literal for int() with base 10: 'R-15'", "tterr")]
    for i, (text, cls) in enumerate(rows):
        f.text(36, 50 + i * 28, text, cls)
    notes = [(330, "1", "что случилось"), (274, "2", "где упало: последний кадр"),
             (190, "3", "кто вызвал parse_percent"), (106, "4", "откуда всё началось")]
    for y, n, label in notes:
        f.line(f"M624 {y - 5}H660", "lnd")
        f.raw(f'<circle cx="674" cy="{y - 5}" r="11" class="fig-acc"/>')
        f.text(674, y, n, "onacc", "middle")
        f.text(692, y, label, "s")
    f.text(20, 384, "Упало в parse_percent, а причина — в допущении «префикс промокода всегда из 4 букв».", "s")
    f.save(out(PY4 / "03-debugging" / "img" / "traceback-stack.svg"))

PY6 = ROOT / "python" / "06-iterators-generators"


# ---------- Python 6.01: что делает for ----------
def for_protocol():
    f = Figure(760, 330, "Цикл for: получить итератор, брать элементы через next до StopIteration")
    f.box(240, 20, 280, 44, "for item in cart:", "box", "c")
    f.arrow("M380 64V92")
    f.box(240, 96, 280, 44, "it = iter(cart)", "box2", "c")
    f.arrow("M380 140V168")
    f.diamond(380, 206, 300, 70, "item = next(it)")
    f.box(240, 268, 280, 44, "тело цикла", "box2")
    f.arrow("M380 241V264"); f.text(390, 258, "элемент есть", "s")
    f.arrow("M240 290H150V206H226"); f.text(40, 196, "следующий", "s"); f.text(40, 214, "элемент", "s")
    f.box(580, 184, 160, 44, "выход из цикла", "ok")
    f.arrow("M530 206H576"); f.text(540, 176, "StopIteration", "s")
    f.save(out(PY6 / "01-iterators" / "img" / "for-protocol.svg"))


# ---------- Python 6.02: генератор останавливается на yield ----------
def generator_flow():
    f = Figure(860, 360, "Генератор: тело выполняется до yield, замирает и продолжает с того же места при следующем next")
    f.text(20, 24, "вызывающий код", "h"); f.text(470, 24, "функция-генератор order_numbers(1041)", "h")
    rows = [("gen = order_numbers(1041)", "создан объект — тело ещё не выполнялось", "box2"),
            ("next(gen)", "выполняется до yield → отдаёт 1042, замирает", "box"),
            ("next(gen)", "продолжает после yield → отдаёт 1043, замирает", "box"),
            ("next(gen) … после конца тела", "функция закончилась → StopIteration", "err")]
    for i, (left, right, cls) in enumerate(rows):
        y = 44 + i * 76
        f.box(20, y, 330, 48, left, "box", "c")
        f.box(470, y, 370, 48, "", cls)
        f.text(486, y + 30, right, "s")
        f.arrow(f"M350 {y + 18}H466")
        if i in (1, 2):
            f.arrow(f"M466 {y + 34}H354", "lnd")
            f.text(372, y + 50, "1042" if i == 1 else "1043", "cs")
    f.text(20, 350, "Локальные переменные генератора сохраняются между вызовами next — поэтому он помнит, на каком номере остановился.", "s")
    f.save(out(PY6 / "02-generators" / "img" / "generator-flow.svg"))


# ---------- Python 6.03: ленивый конвейер ----------
def lazy_pipeline():
    f = Figure(880, 220, "Ленивый конвейер: каждая строка проходит все шаги по одной, список целиком не создаётся")
    steps = [("строки лога", "генератор"), ("разбор строки", "генератор"), ("только paid", "генератор"), ("sum(...)", "потребитель")]
    for i, (title, kind) in enumerate(steps):
        x = 20 + i * 220
        f.box(x, 50, 180, 60, "", "box2" if i < 3 else "ok")
        f.text(x + 90, 76, title, "c", "middle"); f.text(x + 90, 98, kind, "s", "middle")
        if i < 3:
            f.arrow(f"M{x + 180} 80H{x + 216}")
    samples = ['"1042 paid 1499"', "(1042, 'paid', 1499)", "(1042, 'paid', 1499)"]
    for i, sample in enumerate(samples):
        f.text(20 + i * 220 + 90, 36, sample, "cs", "middle")
    f.text(20, 150, "sum просит у фильтра элемент → фильтр просит у разбора → разбор просит у источника одну строку.", "t")
    f.text(20, 176, "В памяти одновременно — одна строка, сколько бы строк ни было в логе.", "s")
    f.save(out(PY6 / "03-lazy-pipelines" / "img" / "lazy-pipeline.svg"))


PY7 = ROOT / "python" / "07-oop"


# ---------- Python 7.01: объекты и класс ----------
def objects_and_class():
    f = Figure(860, 340, "Два объекта класса Product: атрибуты у каждого свои, методы общие и лежат в классе")
    f.text(20, 24, "объекты — свои атрибуты", "h"); f.text(560, 24, "класс — общие методы", "h")
    for i, (var, rows) in enumerate((("mouse", ("id = 1", 'name = "Беспроводная мышь"', 'price = Decimal("1499.00")', "stock = 12")),
                                     ("pad", ("id = 2", 'name = "Коврик для мыши"', 'price = Decimal("490.00")', "stock = 0")))):
        y = 40 + i * 130
        f.box(20, y, 360, 112, "", "box")
        f.text(36, y + 22, var, "c")
        for k, row in enumerate(rows):
            f.text(56, y + 44 + k * 19, row, "cs")
        f.arrow(f"M380 {y + 56}H556", "lnd")
    f.text(400, 88, "type(mouse)", "s"); f.text(400, 218, "type(pad)", "s")
    f.box(560, 40, 280, 242, "", "box2")
    f.text(576, 64, "class Product", "c")
    for k, m in enumerate(("__init__(self, id, name, …)", "is_available(self)", "total(self, quantity)", "reserve(self, quantity)")):
        f.raw(f'<rect x="576" y="{80 + k * 48}" width="248" height="38" rx="10" class="fig-{"acc" if k == 3 else "box"}"/>')
        f.text(590, 104 + k * 48, m, "onacc" if k == 3 else "cs")
    f.text(20, 312, "mouse.reserve(2)", "c"); f.arrow("M170 307H226")
    f.text(236, 312, "Product.reserve(mouse, 2)", "c"); f.text(470, 312, "— внутри метода self это mouse", "s")
    f.save(out(PY7 / "01-classes-and-objects" / "img" / "objects-and-class.svg"))


# ---------- Python 7.02: поиск атрибута ----------
def attribute_lookup():
    f = Figure(880, 400, "Поиск mouse.usd_rate: сначала атрибуты объекта, потом класса; присваивание через объект заслоняет атрибут класса")
    f.text(20, 24, "чтение mouse.usd_rate", "h")
    f.box(20, 40, 250, 92, "", "box")
    f.text(36, 64, "1  mouse.__dict__", "c"); f.text(56, 88, "name, price", "cs"); f.text(56, 110, "usd_rate — нет", "s")
    f.arrow("M270 86H326"); f.text(282, 78, "нет", "s")
    f.box(330, 40, 280, 92, "", "box2")
    f.text(346, 64, "2  Product.__dict__", "c"); f.text(366, 88, "currency, price_usd", "cs"); f.text(366, 110, 'usd_rate = Decimal("100.00")', "cs")
    f.arrow("M610 86H666"); f.text(622, 78, "нет", "s")
    f.box(670, 62, 190, 48, "AttributeError", "err", "errt")
    f.arrow("M470 132V164"); f.text(480, 154, "есть", "s")
    f.box(370, 168, 200, 40, 'Decimal("100.00")', "ok", "cs")
    f.line("M20 232H860", "lnd")
    f.text(20, 262, 'после mouse.usd_rate = Decimal("50.00")', "h")
    f.box(20, 278, 250, 104, "", "box")
    f.text(36, 302, "1  mouse.__dict__", "c"); f.text(56, 326, "name, price", "cs")
    f.raw('<rect x="44" y="336" width="218" height="30" rx="8" class="fig-acc"/>')
    f.text(52, 356, 'usd_rate = Decimal("50.00")', "onacc")
    f.arrow("M270 330H366"); f.text(290, 322, "есть", "s")
    f.box(370, 310, 200, 40, 'Decimal("50.00")', "ok", "cs")
    f.raw('<rect x="610" y="278" width="250" height="104" rx="12" class="fig-dash"/>')
    f.text(626, 302, "Product.__dict__", "c"); f.text(626, 326, 'usd_rate = Decimal("100.00")', "cs")
    f.text(626, 352, "не изменился и не нужен:", "s"); f.text(626, 370, "до класса поиск не дошёл", "s")
    f.save(out(PY7 / "02-class-and-instance-attributes" / "img" / "attribute-lookup.svg"))


# ---------- Python 7.06: ромб и MRO ----------
def inheritance_mro():
    f = Figure(820, 360, "Ромбовидное наследование GiftCard(DigitalProduct, GiftProduct): MRO выстраивает классы в цепочку, Product — один раз и после обоих родителей")
    nodes = {"Product": (310, 20, 4), "DigitalProduct": (90, 130, 2), "GiftProduct": (530, 130, 3), "GiftCard": (310, 240, 1)}
    for name, (x, y, n) in nodes.items():
        f.box(x, y, 200, 48, name, "box2" if name == "GiftCard" else "box", "c")
        f.raw(f'<circle cx="{x + 200}" cy="{y}" r="14" class="fig-acc"/>')
        f.text(x + 200, y + 5, str(n), "onacc", "middle")
    f.arrow("M360 240L230 182"); f.arrow("M460 240L590 182")
    f.arrow("M190 130L350 72"); f.arrow("M630 130L470 72")
    f.text(170, 228, "1-й родитель", "s"); f.text(560, 228, "2-й родитель", "s")
    f.text(20, 330, "MRO:  GiftCard → DigitalProduct → GiftProduct → Product → object", "c")
    f.text(20, 350, "стрелка — «наследует от»; цифра — место класса в порядке поиска", "s")
    f.save(out(PY7 / "06-inheritance" / "img" / "inheritance-mro.svg"))


# ---------- Python 7.07: иерархия ошибок магазина ----------
def shop_errors():
    f = Figure(860, 420, "Иерархия ошибок магазина: except ShopError ловит всю ветку магазина, но не встроенные ошибки и не системные сигналы")
    f.box(330, 16, 200, 44, "BaseException", "box", "c")
    f.box(620, 16, 200, 44, "KeyboardInterrupt", "box", "c")
    f.arrow("M620 38H534")
    f.text(620, 80, "системный сигнал: свои ошибки", "s")
    f.text(620, 98, "от BaseException не наследуют", "s")
    f.box(330, 96, 200, 44, "Exception", "box", "c")
    f.arrow("M430 96V64")
    f.raw('<rect x="16" y="166" width="520" height="240" rx="16" class="fig-dash"/>')
    f.text(32, 190, "ловит except ShopError", "h")
    f.box(170, 200, 200, 44, "ShopError", "acc", "onacc")
    f.box(620, 200, 200, 44, "ValueError, KeyError…", "box", "c")
    f.arrow("M270 200L400 144"); f.arrow("M720 200L460 144")
    f.box(40, 300, 210, 44, "OutOfStockError", "box2", "c")
    f.box(290, 280, 200, 44, "PaymentError", "box2", "c")
    f.box(290, 352, 200, 44, "CardDeclinedError", "box2", "c")
    f.arrow("M145 300L230 248"); f.arrow("M350 280L310 248")
    f.arrow("M390 352V328")
    f.text(620, 270, "встроенные: баги и чужие ошибки.", "s")
    f.text(620, 290, "В бизнес-коде их не ловят,", "s")
    f.text(620, 310, "а переводят в свои через from e", "s")
    f.save(out(PY7 / "07-custom-exceptions" / "img" / "shop-errors.svg"))



# ---------- Python 7.10: является и имеет ----------
def is_a_has_a():
    f = Figure(860, 320, "Наследование — «является»: DigitalProduct это Product. Композиция — «имеет»: Order содержит позиции и пользуется переданным уведомителем")
    f.text(20, 24, "наследование — «является»", "h")
    f.box(40, 44, 220, 48, "Product", "box", "c")
    f.box(40, 190, 220, 48, "DigitalProduct", "box2", "c")
    f.arrow("M150 190V96"); f.text(162, 148, "является", "s")
    f.text(40, 270, "все методы Product есть", "s"); f.text(40, 288, "у DigitalProduct", "s")
    f.line("M310 20V300", "lnd")
    f.text(340, 24, "композиция — «имеет»", "h")
    f.box(340, 44, 300, 190, "", "box")
    f.text(356, 70, "Order", "c")
    f.text(356, 96, "id, status", "cs")
    f.raw('<rect x="356" y="112" width="268" height="48" rx="10" class="fig-box2"/>')
    f.text(370, 134, "items — свой список", "cs"); f.text(370, 152, "создан внутри: композиция", "s")
    f.raw('<rect x="356" y="172" width="268" height="44" rx="10" class="fig-dash"/>')
    f.text(370, 199, "notifier — ссылка", "cs")
    f.box(690, 172, 150, 44, "EmailNotifier", "box2", "cs")
    f.arrow("M624 194H686")
    f.text(660, 240, "создан снаружи, передан", "s"); f.text(660, 258, "в __init__: агрегация;", "s")
    f.text(660, 276, "можно подменить", "s"); f.text(660, 294, "заглушкой в тесте", "s")
    f.text(340, 270, "у Order только свои методы:", "s"); f.text(340, 288, "total(), pay() — без add() и clear()", "s")
    f.save(out(PY7 / "10-composition" / "img" / "is-a-has-a.svg"))


# ---------- Python 7.13: как работает with ----------
def with_flow():
    f = Figure(860, 404, "with вызывает __enter__, выполняет блок и всегда вызывает __exit__; при ошибке истинный результат __exit__ подавляет исключение")
    f.box(350, 16, 260, 44, "with Reservation(1, 2) as r:", "box", "cs")
    f.arrow("M480 60V84")
    f.box(350, 88, 260, 44, "r = __enter__()", "box2", "c")
    f.arrow("M480 132V156")
    f.diamond(480, 196, 260, 76, "блок завершился с ошибкой?")
    f.arrow("M350 196H264"); f.text(307, 186, "нет", "s", "middle")
    f.box(20, 174, 240, 44, "__exit__(None, None, None)", "ok", "cs")
    f.arrow("M140 218V300")
    f.box(20, 304, 240, 44, "код после with", "box")
    f.arrow("M480 234V262"); f.text(492, 254, "да", "s")
    f.box(350, 266, 260, 44, "__exit__(type, exc, tb)", "box2", "cs")
    f.arrow("M610 288H648")
    f.diamond(720, 288, 144, 70, "вернул True?")
    f.box(640, 344, 160, 40, "ошибка летит дальше", "err", "errt")
    f.arrow("M720 323V340"); f.text(732, 336, "нет", "s")
    f.arrow("M792 288H836V394H140V352"); f.text(844, 280, "да", "s", "end")
    f.text(300, 388, "да — ошибка подавлена, выполнение идёт дальше", "s")
    f.save(out(PY7 / "13-context-managers" / "img" / "with-flow.svg"))


# ---------- Python 8.02: как читать упавший тест ----------
PY8 = ROOT / "python" / "08-testing"


def pytest_failure():
    f = Figure(860, 300, "Отчёт pytest об упавшем тесте: какой тест, строка проверки, значения, место в файле")
    f.raw('<rect x="20" y="20" width="460" height="222" rx="14" class="fig-term"/>')
    rows = [
        ("test_main.py::test_free_from_exactly_3000 FAILED", "tt"),
        ("", "tt"),
        ("    def test_free_from_exactly_3000():", "tt"),
        (">       assert delivery_cost(3000) == 0", "tt"),
        ("E       assert 299 == 0", "tterr"),
        ("E        +  where 299 = delivery_cost(3000)", "tterr"),
        ("", "tt"),
        ("test_main.py:19: AssertionError", "tt"),
    ]
    for i, (s, cls) in enumerate(rows):
        f.text(36, 50 + i * 25, s, cls)
    notes = [  # (номер строки, номер, подпись)
        (0, "1", "какой тест упал"),
        (3, "2", "строка с проверкой — отмечена «>»"),
        (4, "3", "получили 299, ожидали 0"),
        (5, "4", "откуда взялось 299"),
        (7, "5", "файл и номер строки"),
    ]
    for row, n, s in notes:
        y = 50 + row * 25 - 5
        f.line(f"M484 {y}H520", "lnd")
        f.raw(f'<circle cx="534" cy="{y}" r="11" class="fig-acc"/>')
        f.text(534, y + 5, n, "onacc", "middle")
        f.text(552, y + 5, s, "s")
    f.text(20, 274, "Строки E — значения сравнения: pytest сам раскрывает обычный assert.", "t")
    f.save(out(PY8 / "02-first-tests" / "img" / "pytest-failure.svg"))


# ---------- Python 8.03: фикстура для каждого теста ----------
def fixture_per_test():
    f = Figure(860, 330, "Фикстура cart вызывается перед каждым тестом: каждый тест получает свою корзину")
    f.box(20, 124, 200, 70, "", "box2")
    f.text(120, 152, "@pytest.fixture", "cs", "middle")
    f.text(120, 174, "def cart():", "c", "middle")
    rows = [
        ("test_total(cart)", "сумма 2479", "ok"),
        ("test_add_same_product(cart)", "+ мышь → 3978", "box"),
        ("test_remove(cart)", "− коврик → 1499", "box"),
    ]
    for i, (test, change, cls) in enumerate(rows):
        y = 30 + i * 96
        f.arrow(f"M220 159C260 159 260 {y + 30} 296 {y + 30}")
        f.box(300, y, 210, 60, "", "box")
        f.text(405, y + 26, "новая Cart()", "c", "middle")
        f.text(405, y + 46, "мышь ×1, коврик ×2", "s", "middle")
        f.arrow(f"M510 {y + 30}H546")
        f.box(550, y, 290, 60, "", "box")
        f.text(566, y + 26, test, "cs")
        f.text(566, y + 46, change, "s")
    f.text(20, 318, "Изменения корзины в одном тесте не видны другим: порядок тестов не важен.", "t")
    f.save(out(PY8 / "03-pytest-features" / "img" / "fixture-per-test.svg"))


# ---------- Python 8.04: Mock вместо платёжного шлюза ----------
def mock_gateway():
    f = Figure(860, 330, "В работе checkout вызывает настоящий шлюз банка, в тесте — Mock, который отвечает заданным и записывает вызовы")
    f.text(20, 24, "в работе", "h")
    f.box(20, 36, 220, 50, "checkout(2479, gateway)", "box", "cs")
    f.arrow("M240 61H296")
    f.box(300, 36, 220, 50, "PaymentGateway.charge", "box2", "cs")
    f.arrow("M520 61H576", "lnd")
    f.text(548, 52, "сеть", "s", "middle")
    f.box(580, 36, 260, 50, "банк: деньги списаны", "err", "errt")
    f.text(20, 128, "в тесте", "h")
    f.box(20, 140, 220, 50, "checkout(2479, Mock())", "box", "cs")
    f.arrow("M240 165H296")
    f.box(300, 140, 290, 120, "", "ok")
    f.text(316, 166, "Mock", "t")
    f.text(316, 192, 'return_value = "pay_42"', "cs")
    f.text(316, 214, "или side_effect = ConnectionError", "cs")
    f.text(316, 244, "записал: charge(2479)", "cs")
    f.arrow("M590 236H616")
    f.box(620, 210, 230, 50, "", "box2")
    f.text(634, 232, "тест проверяет:", "s")
    f.text(634, 250, "assert_called_once_with(2479)", "cs")
    f.text(20, 300, "Ни сети, ни денег: тест быстрый и может получить любой ответ банка, включая ошибку.", "t")
    f.save(out(PY8 / "04-mocks" / "img" / "mock-gateway.svg"))


# ---------- Django 1.01: путь запроса ----------
DJ1 = ROOT / "django" / "01-intro"


def request_flow():
    f = Figure(860, 340, "Путь запроса в Django: urls.py выбирает view, view берёт данные и шаблон и возвращает HttpResponse")
    f.box(20, 40, 160, 56, "", "box2")
    f.text(100, 64, "браузер", "t", "middle")
    f.text(100, 84, "GET /catalog/", "cs", "middle")
    f.arrow("M180 68H226")
    f.box(230, 40, 170, 56, "", "box")
    f.text(315, 64, "urls.py", "c", "middle")
    f.text(315, 84, "ищет маршрут", "s", "middle")
    f.arrow("M400 68H446")
    f.text(423, 58, "нашёл", "s", "middle")
    f.box(450, 40, 170, 56, "", "ok")
    f.text(535, 64, "view(request)", "c", "middle")
    f.text(535, 84, "views.py", "s", "middle")
    f.arrow("M315 96V164")
    f.text(327, 136, "не нашёл", "s")
    f.box(230, 168, 170, 44, "404 Not Found", "err", "errt")
    f.arrow("M500 96V164", "lnd")
    f.box(430, 168, 140, 56, "", "box2")
    f.text(500, 192, "Model", "t", "middle")
    f.text(500, 212, "данные из базы", "s", "middle")
    f.arrow("M590 96V164", "lnd")
    f.box(590, 168, 150, 56, "", "box2")
    f.text(665, 192, "Template", "t", "middle")
    f.text(665, 212, "HTML с данными", "s", "middle")
    f.arrow("M620 68H676")
    f.box(680, 40, 160, 56, "", "acc")
    f.text(760, 64, "HttpResponse", "onacc", "middle")
    f.text(760, 84, "200 + HTML", "onacc", "middle")
    f.arrow("M760 40V24H100V36")
    f.text(430, 18, "ответ уходит браузеру", "s", "middle")
    f.text(20, 268, "Пунктир — необязательные шаги: view может обойтись без базы и без шаблона.", "s")
    f.text(20, 296, "Ошибка внутри view — ответ 500.", "s")
    f.save(out(DJ1 / "01-request-flow" / "img" / "request-flow.svg"))


# ---------- Django 1.02: структура проекта ----------
def project_structure():
    f = Figure(860, 380, "Структура проекта: manage.py, пакет настроек config и приложение catalog")
    f.box(20, 20, 820, 44, "", "box2")
    f.text(36, 47, "~/shop/", "c")
    f.text(130, 47, "папка проекта: здесь запускают команды", "s")
    f.box(40, 80, 240, 40, "manage.py", "box", "c")
    f.text(40, 140, "команды: runserver, check, startapp…", "s")
    f.box(300, 80, 260, 220, "", "box")
    f.text(316, 104, "config/", "c"); f.text(400, 104, "проект", "s")
    for i, (name, note) in enumerate([("settings.py", "настройки"), ("urls.py", "главные маршруты"),
                                      ("wsgi.py", "вход для сервера"), ("asgi.py", "вход для сервера"),
                                      ("__init__.py", "это пакет")]):
        y = 140 + i * 30
        f.text(330, y, name, "cs"); f.text(440, y, note, "s")
    f.box(580, 80, 260, 260, "", "ok")
    f.text(596, 104, "catalog/", "c"); f.text(680, 104, "приложение", "s")
    for i, (name, note) in enumerate([("models.py", "модели"), ("views.py", "view"), ("admin.py", "админка"),
                                      ("apps.py", "CatalogConfig"), ("tests.py", "тесты"),
                                      ("migrations/", "миграции"), ("__init__.py", "это пакет")]):
        y = 140 + i * 28
        f.text(610, y, name, "cs"); f.text(720, y, note, "s")
    f.text(300, 330, "проект один, приложений — по числу областей сайта", "s")
    f.text(20, 368, "Приложение подключается к проекту строкой \"catalog\" в INSTALLED_APPS (config/settings.py).", "t")
    f.save(out(DJ1 / "02-project-and-app" / "img" / "project-structure.svg"))


# ---------- Django 1.03: маршрут, view, ответ ----------
def first_page():
    f = Figure(860, 250, "Маршрут связывает адрес с view, view возвращает объект ответа: код, заголовки, тело")
    f.box(20, 40, 180, 56, "", "box2")
    f.text(110, 64, "запрос", "t", "middle")
    f.text(110, 84, "GET /api/ping/", "cs", "middle")
    f.arrow("M200 68H236")
    f.box(240, 40, 250, 56, "", "box")
    f.text(365, 64, "urls.py", "c", "middle")
    f.text(365, 84, 'path("api/ping/", views.ping)', "cs", "middle")
    f.arrow("M490 68H526")
    f.box(530, 40, 170, 56, "", "ok")
    f.text(615, 64, "ping(request)", "c", "middle")
    f.text(615, 84, "return JsonResponse", "cs", "middle")
    f.arrow("M615 96V128")
    f.box(300, 132, 540, 80, "", "acc")
    f.text(316, 156, "200 OK", "onacc")
    f.text(316, 178, "Content-Type: application/json", "onacc")
    f.text(316, 200, '{"status": "ok"}', "onacc")
    f.text(20, 160, "объект ответа:", "s")
    f.text(20, 180, "код, заголовки, тело", "s")
    f.text(20, 238, "HttpResponse — то же самое с Content-Type: text/html.", "s")
    f.save(out(DJ1 / "03-first-page" / "img" / "first-page.svg"))


# ---------- Django 2.01: параметры маршрута и include ----------
DJ2 = ROOT / "django" / "02-urls-views"


def route_params():
    f = Figure(860, 300, "Маршрут с параметром передаёт часть адреса во view; include склеивает префикс и маршрут модуля")
    f.text(20, 24, "параметр", "h")
    f.box(20, 36, 220, 50, "/products/aster-14/", "box2", "cs")
    f.arrow("M240 61H276")
    f.box(280, 36, 260, 50, "", "box")
    f.text(410, 58, "products/<slug:slug>/", "cs", "middle")
    f.text(410, 76, "конвертер slug: совпало", "s", "middle")
    f.arrow("M540 61H576")
    f.box(580, 36, 260, 50, "", "ok")
    f.text(710, 58, "product_detail(request,", "cs", "middle")
    f.text(710, 76, 'slug="aster-14")', "cs", "middle")
    f.text(20, 112, "/orders/abc/ при <int:pk> — маршрут не совпал, view не вызывается, ответ 404", "s")
    f.text(20, 160, "include", "h")
    f.box(20, 172, 220, 50, "/api/ping/", "box2", "cs")
    f.arrow("M240 197H276")
    f.box(280, 172, 260, 50, "", "box")
    f.text(410, 194, 'urls.py: path("api/", include(…))', "cs", "middle")
    f.text(410, 212, "отрезан префикс api/, остаток ping/", "s", "middle")
    f.arrow("M540 197H576")
    f.box(580, 172, 260, 50, "", "ok")
    f.text(710, 194, 'api_urls.py: path("ping/", …)', "cs", "middle")
    f.text(710, 212, "views.ping(request)", "s", "middle")
    f.text(20, 260, "Маршруты проверяются по порядку: побеждает первый подходящий.", "t")
    f.text(20, 284, "Конкретные адреса (products/new/) — выше общих (products/<slug:slug>/).", "s")
    f.save(out(DJ2 / "01-routes" / "img" / "route-params.svg"))


# ---------- Django 2.02: reverse ----------
def url_reverse():
    f = Figure(860, 260, "Маршрут с именем работает в обе стороны: адрес → view и имя + параметры → адрес")
    f.box(250, 100, 360, 60, "", "acc")
    f.text(430, 124, 'path("catalog/<slug:slug>/", …,', "onacc", "middle")
    f.text(430, 144, 'name="product_detail")', "onacc", "middle")
    f.box(20, 20, 200, 50, "GET /catalog/aster-14/", "box2", "cs")
    f.arrow("M220 45H330V96")
    f.text(240, 36, "запрос → маршрут", "s")
    f.box(640, 20, 200, 50, "product_detail(…)", "ok", "cs")
    f.arrow("M530 96V45H636")
    f.text(548, 36, "вызов view", "s")
    f.box(20, 190, 260, 50, "", "box")
    f.text(150, 212, 'reverse("product_detail",', "cs", "middle")
    f.text(150, 230, 'args=["aster-14"])', "cs", "middle")
    f.box(300, 190, 260, 50, "{% url 'product_detail' slug %}", "box", "cs")
    f.arrow("M150 190V160H246", "lnd")
    f.arrow("M430 190V164", "lnd")
    f.arrow("M614 130H660V190")
    f.box(600, 194, 240, 46, '"/catalog/aster-14/"', "ok", "cs")
    f.text(672, 176, "адрес", "s")
    f.save(out(DJ2 / "02-url-names" / "img" / "url-reverse.svg"))


# ---------- Django 2.03: запрос и ответы ----------
def request_response():
    f = Figure(860, 330, "Что приходит во view в request и какие ответы она может вернуть")
    f.box(20, 20, 300, 230, "", "box2")
    f.text(36, 46, "request", "t")
    rows = [("method", '"GET"'), ("path", '"/catalog/"'), ("GET", '{"max_price": "2000"}'),
            ("POST", "поля формы"), ("headers", '{"User-Agent": …}')]
    for i, (k, v) in enumerate(rows):
        y = 80 + i * 32
        f.text(36, y, k, "cs"); f.text(120, y, v, "cs")
    f.text(36, 236, "все значения GET и POST — строки", "s")
    f.arrow("M320 135H366")
    f.box(370, 110, 120, 50, "view", "ok", "c")
    outs = [("200", "данные", "ok"), ("400", "неверный параметр", "err"), ("404", "raise Http404", "err"),
            ("301 / 302", "redirect(…)", "box"), ("405", "@require_POST", "err")]
    for i, (code, note, cls) in enumerate(outs):
        y = 20 + i * 48
        f.arrow(f"M490 135C520 135 520 {y + 20} 546 {y + 20}")
        f.box(550, y, 290, 40, "", cls)
        f.text(566, y + 25, code, "c"); f.text(660, y + 25, note, "s")
    f.text(20, 300, "Ошибка клиента — 4xx с объяснением; непойманное исключение во view — 500.", "t")
    f.save(out(DJ2 / "03-request-response" / "img" / "request-response.svg"))


# ---------- Django 3.01: render ----------
DJ3 = ROOT / "django" / "03-templates"


def render_flow():
    f = Figure(860, 300, "render соединяет шаблон и контекст в готовый HTML; значения экранируются")
    f.box(20, 20, 260, 120, "", "box2")
    f.text(36, 44, "контекст (из view)", "s")
    f.text(36, 72, '{"title": "Ноутбуки",', "cs")
    f.text(36, 92, ' "products": [', "cs")
    f.text(36, 112, '   {"name": "<b>Мышь</b>"}]}', "cs")
    f.box(20, 160, 260, 120, "", "box")
    f.text(36, 184, "шаблон shop/catalog.html", "s")
    f.text(36, 212, "<h1>{{ title }}</h1>", "cs")
    f.text(36, 232, "{% for p in products %}", "cs")
    f.text(36, 252, "  <li>{{ p.name }}</li>", "cs")
    f.arrow("M280 80H320V140H346")
    f.arrow("M280 220H320V160H346")
    f.box(350, 120, 140, 60, "", "acc")
    f.text(420, 146, "render(", "onacc", "middle")
    f.text(420, 166, "request, …)", "onacc", "middle")
    f.arrow("M490 150H536")
    f.box(540, 60, 300, 180, "", "ok")
    f.text(556, 84, "HttpResponse — HTML", "s")
    f.text(556, 114, "<h1>Ноутбуки</h1>", "cs")
    f.text(556, 138, "<li>&lt;b&gt;Мышь&lt;/b&gt;</li>", "cs")
    f.text(556, 176, "< и > из данных стали &lt; &gt;:", "s")
    f.text(556, 196, "текст, а не теги", "s")
    f.save(out(DJ3 / "01-templates-context" / "img" / "render.svg"))


# ---------- Django 3.02: extends и include ----------
def extends_include():
    f = Figure(860, 330, "catalog.html наследует base.html и заполняет его блоки; карточка подключается include для каждого товара")
    f.box(20, 20, 300, 290, "", "box2")
    f.text(36, 44, "base.html — каркас", "t")
    f.text(36, 74, "<head> … <title>", "cs")
    f.box(36, 84, 268, 34, "{% block title %}", "acc", "onacc")
    f.text(36, 140, "<header> шапка", "cs")
    f.box(36, 152, 268, 110, "", "acc")
    f.text(52, 176, "{% block content %}", "onacc")
    f.text(36, 290, "<footer> подвал", "cs")
    f.box(400, 20, 440, 200, "", "box")
    f.text(416, 44, "catalog.html", "t")
    f.text(416, 70, '{% extends "shop/base.html" %}', "cs")
    f.text(416, 98, "{% block title %}Каталог — {{ block.super }}", "cs")
    f.text(416, 126, "{% block content %}", "cs")
    f.text(432, 150, "{% for product in products %}", "cs")
    f.text(448, 174, '{% include "shop/_product_card.html" %}', "cs")
    f.arrow("M400 94H308", "lnd")
    f.arrow("M400 122C360 122 340 160 308 170", "lnd")
    f.box(560, 250, 280, 60, "", "ok")
    f.text(576, 274, "_product_card.html", "cs")
    f.text(576, 294, "видит product из цикла", "s")
    f.arrow("M700 180V246")
    f.save(out(DJ3 / "02-inheritance" / "img" / "extends-include.svg"))


# ---------- Django 3.03: фильтры ----------
def filters_flow():
    f = Figure(860, 260, "Значение проходит фильтр; свой фильтр — функция из библиотеки, подключённой load")
    f.box(20, 30, 160, 50, "price = 64990", "box2", "cs")
    f.arrow("M180 55H226")
    f.box(230, 30, 200, 50, "", "box")
    f.text(330, 60, "{{ price|rub }}", "cs", "middle")
    f.arrow("M430 55H476")
    f.box(480, 30, 160, 50, "64 990 ₽", "ok", "c")
    f.box(230, 110, 440, 56, "", "acc")
    f.text(246, 134, "{% load shop_extras %} →", "onacc")
    f.text(246, 154, "shop/templatetags/shop_extras.py: @register.filter", "onacc")
    f.arrow("M330 110V84", "lnd")
    f.box(20, 196, 220, 50, "12:30 UTC (datetime)", "box2", "cs")
    f.arrow("M240 221H286")
    f.box(290, 196, 260, 50, "", "box")
    f.text(420, 226, '{{ dt|date:"d.m.Y H:i" }}', "cs", "middle")
    f.arrow("M550 221H596")
    f.box(600, 196, 240, 50, "18.11.2026 15:30", "ok", "c")
    f.text(660, 186, "часовой пояс сайта", "s")
    f.save(out(DJ3 / "03-filters" / "img" / "filters.svg"))


# ---------- Django 3.04: статика ----------
def static_flow():
    f = Figure(860, 320, "В разработке статику отдаёт runserver, на сервере collectstatic собирает её в STATIC_ROOT, а отдаёт Nginx")
    f.box(20, 20, 250, 50, "catalog/static/catalog/…", "box2", "cs")
    f.box(20, 84, 250, 50, "static/ (STATICFILES_DIRS)", "box2", "cs")
    f.text(320, 92, "разработка (DEBUG = True)", "h")
    f.arrow("M270 45H316"); f.arrow("M270 109H300V60H316")
    f.box(320, 20, 200, 50, "runserver", "box", "c")
    f.arrow("M520 45H566")
    f.box(570, 20, 270, 50, "браузер: /static/…", "ok", "cs")
    f.text(320, 256, "продакшен (DEBUG = False)", "h")
    f.arrow("M145 134V206H316", "lnd")
    f.box(320, 184, 200, 50, "collectstatic", "acc", "onacc")
    f.arrow("M520 209H566")
    f.box(570, 184, 270, 50, "staticfiles/ (STATIC_ROOT)", "box", "cs")
    f.arrow("M705 234V256")
    f.box(570, 260, 270, 50, "Nginx → браузер: /static/…", "ok", "cs")
    f.text(20, 290, "Django в продакшене обрабатывает только страницы.", "s")
    f.save(out(DJ3 / "04-static" / "img" / "static-flow.svg"))


# ---------- Django 4: модели ----------
DJ4 = ROOT / "django" / "04-models"


def _table(f, x, y, title, cols, w=260, cls="box"):
    f.box(x, y, w, 40 + 24 * len(cols), "", cls)
    f.text(x + 14, y + 22, title, "c")
    for i, c in enumerate(cols):
        f.text(x + 14, y + 48 + i * 24, c, "cs")


def model_table():
    f = Figure(860, 330, "Модель — таблица, поле — колонка, объект — строка; менеджер objects превращает вызовы в SQL")
    f.box(20, 20, 300, 150, "", "box2")
    f.text(36, 44, "class Product(models.Model):", "cs")
    f.text(52, 70, "name = CharField(max_length=200)", "cs")
    f.text(52, 94, "price = DecimalField(10, 2)", "cs")
    f.text(52, 118, "stock = PositiveIntegerField()", "cs")
    f.text(36, 152, "id добавляет Django", "s")
    f.arrow("M320 95H376")
    _table(f, 380, 20, "shop_product", ["id bigint", "name varchar(200)", "price numeric(10, 2)", "stock integer"], w=240)
    f.box(640, 40, 200, 90, "", "ok")
    f.text(656, 64, "строка 1:", "s")
    f.text(656, 88, "1, «Мышь»,", "cs")
    f.text(656, 108, "1499.00, 40", "cs")
    f.arrow("M620 85H636", "lnd")
    f.box(20, 200, 300, 50, "mouse = Product.objects.get(…)", "box", "cs")
    f.text(20, 280, "объект mouse = строка 1:", "s")
    f.text(20, 300, "mouse.name, mouse.price — значения колонок", "s")
    f.box(380, 200, 460, 110, "", "acc")
    f.text(396, 226, "create(…) → INSERT", "onacc")
    f.text(396, 250, "all() → SELECT; count() → COUNT(*)", "onacc")
    f.text(396, 274, "obj.save() → UPDATE всех полей", "onacc")
    f.text(396, 298, "obj.delete() → DELETE", "onacc")
    f.save(out(DJ4 / "01-model-table" / "img" / "model-table.svg"))


def null_blank():
    f = Figure(860, 280, "Одни параметры поля меняют таблицу в базе, другие работают только в проверке форм и full_clean")
    f.box(20, 20, 400, 200, "", "acc")
    f.text(36, 46, "база (SQL)", "onacc")
    for i, t in enumerate(["null=True → NULL вместо NOT NULL", "unique=True → UNIQUE", "db_index=True → CREATE INDEX",
                           "default → значение при сохранении"]):
        f.text(36, 82 + i * 32, t, "onacc")
    f.box(440, 20, 400, 200, "", "box2")
    f.text(456, 46, "формы и full_clean()", "t")
    for i, t in enumerate(["blank=True → можно не заполнять", "choices → только допустимые значения",
                           "max_length → длина строки", "verbose_name, help_text → подписи"]):
        f.text(456, 82 + i * 32, t, "cs")
    f.text(20, 256, "Строке — blank=True; дате, числу, связи — null=True, blank=True. choices база не проверяет.", "t")
    f.save(out(DJ4 / "03-field-options" / "img" / "null-blank.svg"))


def foreign_key():
    f = Figure(860, 300, "ForeignKey — колонка category_id у товара; доступ в обе стороны; on_delete решает судьбу товаров")
    _table(f, 20, 20, "shop_category", ["id = 1", "name = «Мыши»"], w=240)
    _table(f, 520, 20, "shop_product", ["id = 4", "category_id = 1", "name = «Мышь»"], w=320)
    f.arrow("M516 92H264")
    f.text(300, 82, "FOREIGN KEY + индекс", "s")
    f.box(520, 150, 320, 40, "product.category → объект (SELECT)", "ok", "cs")
    f.box(20, 150, 300, 40, "category.products.all()", "ok", "cs")
    f.text(20, 236, "удаление категории с товарами:", "t")
    f.text(20, 262, "CASCADE — удалить товары;  PROTECT — ProtectedError;  SET_NULL — category_id = NULL (null=True)", "cs")
    f.text(20, 288, "Правило выполняет Django: сам отправляет DELETE или UPDATE перед удалением категории.", "s")
    f.save(out(DJ4 / "04-foreign-key" / "img" / "foreign-key.svg"))


def many_to_many():
    f = Figure(860, 300, "Простая связь — таблица-связка от Django; связь с данными — своя модель OrderItem")
    _table(f, 20, 20, "shop_product", ["id", "name"], w=200)
    _table(f, 330, 20, "shop_product_tags", ["product_id", "tag_id", "UNIQUE (product_id, tag_id)"], w=260)
    _table(f, 680, 20, "shop_tag", ["id", "name"], w=160)
    f.arrow("M326 70H224"); f.arrow("M590 70H676")
    f.text(330, 156, "tags = ManyToManyField(Tag) — таблицу создаёт Django", "s")
    _table(f, 20, 170, "shop_order", ["id", "number"], w=200)
    _table(f, 330, 170, "shop_orderitem", ["order_id, product_id", "quantity", "price"], w=260, cls="ok")
    f.text(620, 196, "своя модель OrderItem:", "s")
    f.text(620, 220, "ManyToManyField(Product,", "cs")
    f.text(620, 240, '  through="OrderItem")', "cs")
    f.arrow("M326 220H224")
    f.save(out(DJ4 / "05-many-to-many" / "img" / "many-to-many.svg"))


def meta_constraints():
    f = Figure(860, 300, "Что из Meta становится SQL, а что работает только в Python")
    f.box(20, 20, 380, 250, "", "box2")
    f.text(36, 46, "class Meta:", "cs")
    rows = ["ordering = [\"name\"]", "indexes = [Index(…)]", "UniqueConstraint(user, product)",
            "CheckConstraint(rating 1–5)", "verbose_name = \"отзыв\""]
    for i, r in enumerate(rows):
        f.text(52, 82 + i * 40, r, "cs")
    outs = [("ORDER BY в каждом запросе", "box"), ("CREATE INDEX", "acc"), ("CONSTRAINT … UNIQUE (…)", "acc"),
            ("CONSTRAINT … CHECK (…)", "acc"), ("только админка и формы", "box")]
    for i, (t, cls) in enumerate(outs):
        y = 62 + i * 40
        f.arrow(f"M400 {y + 16}H456", "lnd")
        f.box(460, y, 380, 32, t, cls, "onacc" if cls == "acc" else "cs")
    f.text(20, 292, "Ограничения проверяет база (IntegrityError) и заранее — full_clean() (ValidationError).", "s")
    f.save(out(DJ4 / "07-meta-constraints" / "img" / "meta.svg"))


def model_inheritance():
    f = Figure(860, 320, "Три вида наследования моделей и их таблицы")
    f.text(20, 24, "абстрактная", "h")
    f.box(20, 36, 250, 50, "TimeStampedModel (abstract)", "dash", "cs")
    f.text(20, 106, "таблицы нет — поля копируются", "s")
    f.arrow("M250 86V140", "lnd")
    _table(f, 20, 144, "shop_product", ["id, created_at, updated_at", "name, price"], w=250)
    f.text(300, 24, "многотабличная", "h")
    f.box(300, 36, 250, 50, "class EBook(Product)", "box2", "cs")
    _table(f, 300, 144, "shop_ebook", ["product_ptr_id → shop_product", "file_size_mb"], w=270)
    f.arrow("M425 86V140")
    f.arrow("M300 190H274")
    f.text(300, 250, "создание — 2 INSERT, чтение — JOIN", "s")
    f.text(600, 24, "прокси", "h")
    f.box(600, 36, 240, 50, "CheapProduct (proxy)", "box2", "cs")
    f.text(600, 106, "та же таблица shop_product:", "s")
    f.text(600, 126, "свои методы, ordering, менеджер", "s")
    f.arrow("M830 86V136H274", "lnd")
    f.text(20, 300, "Общие поля — абстрактная модель; подтипы в общем списке — многотабличная; другое поведение — прокси.", "t")
    f.save(out(DJ4 / "08-model-inheritance" / "img" / "inheritance.svg"))


# ---------- HTML/CSS 1.01: клиент и сервер ----------
HC1 = ROOT / "html-css" / "01-how-web-works"


def client_server():
    f = Figure(880, 250, "Браузер отправляет запрос, сервер магазина собирает страницу из шаблона и данных базы и возвращает ответ")
    f.text(20, 24, "клиент (frontend)", "h")
    f.box(20, 40, 220, 150, "", "box")
    f.text(40, 72, "Браузер покупателя", "t")
    f.text(40, 104, "показывает HTML,", "s"); f.text(40, 124, "применяет CSS,", "s"); f.text(40, 144, "выполняет JS", "s")
    f.arrow("M240 92H430"); f.text(335, 82, "GET /catalog/", "cs", "middle")
    f.arrow("M430 150H240"); f.text(335, 170, "200 OK + HTML", "cs", "middle")
    f.text(440, 24, "сервер (backend)", "h")
    f.box(440, 40, 230, 150, "", "box")
    f.text(460, 72, "Приложение на Django", "t")
    f.text(460, 104, "1. разбирает запрос", "s"); f.text(460, 124, "2. берёт данные из базы", "s"); f.text(460, 144, "3. подставляет их в шаблон", "s")
    f.arrow("M670 104H740"); f.arrow("M740 130H670")
    f.box(744, 84, 116, 66, "PostgreSQL", "box2")
    f.text(20, 226, "Браузер видит только ответ — HTML-текст. Код Django и база остаются на сервере.", "s")
    f.save(out(HC1 / "01-client-server" / "img" / "client-server.svg"))


# ---------- HTML/CSS 1.02: части URL ----------
def url_anatomy():
    f = Figure(880, 200, "Части URL: схема, домен, порт, путь, параметры запроса и фрагмент")
    parts = [("https", "схема"), ("://", ""), ("shop.example", "домен"), (":443", "порт"),
             ("/catalog/", "путь"), ("?category=5&page=2", "query-параметры"), ("#reviews", "фрагмент")]
    x = 20
    char = 11.2
    for k, (s, label) in enumerate(parts):
        w = len(s) * char
        if label:
            cls = "acc" if k % 2 == 0 else "m1"
            f.raw(f'<rect x="{x - 2}" y="40" width="{w + 4}" height="34" rx="6" class="fig-{cls}"/>')
            f.line(f"M{x + w / 2} 78V{100 + (k % 2) * 40}", "lnd")
            f.text(x + w / 2, 116 + (k % 2) * 40, label, "s", "middle")
        f.text(x, 63, s, "c" if not label else ("onacc" if k % 2 == 0 else "c"))
        x += w + (4 if label else 0)
    f.text(20, 190, "Порт 443 для https браузер подставляет сам — в адресной строке его обычно не пишут. Фрагмент на сервер не уходит.", "s")
    f.save(out(HC1 / "02-url" / "img" / "url-anatomy.svg"))


# ---------- HTML/CSS 1.03: DNS ----------
def dns_lookup():
    f = Figure(880, 330, "Браузер узнаёт IP-адрес домена у DNS и подключается к этому адресу на нужный порт")
    for x, title in [(20, "Браузер"), (360, "DNS-сервер"), (700, "Сервер магазина")]:
        f.box(x, 20, 160, 44, title, "box2" if x == 360 else "box")
        f.line(f"M{x + 80} 64V200", "lnd")
    steps = [(100, 100, 440, "1. shop.example — какой IP?"), (136, 440, 100, "2. 203.0.113.10"),
             (180, 100, 780, "3. соединение с 203.0.113.10:443")]
    for y, x1, x2, s in steps:
        f.arrow(f"M{x1} {y}H{x2 - 4 if x2 > x1 else x2 + 4}")
        f.text((x1 + x2) / 2 if y < 180 else 610, y - 8, s, "cs", "middle")
    f.text(20, 236, "Порт выбирает программу на сервере:", "t")
    for i, (port, what) in enumerate([(":443", "HTTPS — Nginx"), (":80", "HTTP — Nginx"),
                                      (":8000", "runserver Django"), (":5432", "PostgreSQL")]):
        x = 20 + i * 215
        f.box(x, 252, 200, 56, "", "box")
        f.text(x + 14, 285, port, "c"); f.text(x + 76, 285, what, "s")
    f.save(out(HC1 / "03-dns-ip-ports" / "img" / "dns-lookup.svg"))


# ---------- HTML/CSS 1.04: устройство запроса и ответа ----------
def http_message():
    f = Figure(880, 300, "HTTP-сообщение: стартовая строка, заголовки, пустая строка и тело")
    cols = [("Запрос", ["POST /orders/ HTTP/1.1", "Host: shop.example", "Content-Type: application/x-www-form-urlencoded", "Content-Length: 24", "", "product_id=17&quantity=2"]),
            ("Ответ", ["HTTP/1.1 302 Found", "Location: /orders/1042/", "Set-Cookie: cart=; Max-Age=0", "Content-Length: 0", "", ""])]
    for c, (title, lines) in enumerate(cols):
        x = 20 + c * 440
        f.text(x, 24, title, "h")
        f.raw(f'<rect x="{x}" y="36" width="420" height="200" rx="14" class="fig-term"/>')
        for i, s in enumerate(lines):
            f.text(x + 16, 64 + i * 28, s, "tt")
    f.text(20, 262, "Сверху вниз: стартовая строка → заголовки «Имя: значение» → пустая строка → тело.", "t")
    f.text(20, 286, "Запрос начинается с метода и пути, ответ — с версии HTTP и кода.", "s")
    f.save(out(HC1 / "04-request-response" / "img" / "http-message.svg"))


# ---------- HTML/CSS 1.05: POST → редирект → GET ----------
def post_redirect_get():
    f = Figure(880, 270, "После успешного POST сервер отвечает редиректом, и браузер сам делает GET на страницу заказа")
    f.box(20, 20, 170, 220, "", "box"); f.text(105, 46, "Браузер", "t", "middle")
    f.box(690, 20, 170, 220, "", "box"); f.text(775, 46, "Сервер", "t", "middle")
    steps = [(80, "POST /orders/  (данные формы)", True), (120, "302 Found, Location: /orders/1042/", False),
             (170, "GET /orders/1042/", True), (210, "200 OK + страница заказа", False)]
    for y, s, right in steps:
        if right:
            f.arrow(f"M190 {y}H690")
        else:
            f.arrow(f"M690 {y}H190")
        f.text(440, y - 8, s, "cs", "middle")
    f.text(20, 262, "Обновление страницы повторит безопасный GET, а не отправку заказа ещё раз.", "s")
    f.save(out(HC1 / "05-methods-status-codes" / "img" / "post-redirect-get.svg"))


# ---------- HTML/CSS 1.06: cookie сессии ----------
def session_cookie():
    f = Figure(880, 330, "Сервер выдаёт cookie с номером сессии, браузер возвращает его в каждом запросе, данные корзины лежат на сервере")
    f.box(20, 20, 170, 270, "", "box"); f.text(105, 46, "Браузер", "t", "middle")
    f.box(30, 234, 150, 46, "cookie:|sessionid=k3x9", "box2", "cs")
    f.box(560, 20, 160, 270, "", "box"); f.text(640, 46, "Сервер", "t", "middle")
    f.box(750, 70, 120, 120, "", "box2"); f.text(810, 94, "сессии", "h", "middle")
    f.text(762, 124, "k3x9:", "cs"); f.text(762, 146, "корзина: 17×2", "cs")
    f.arrow("M720 130H746")
    steps = [(84, "1. POST /cart/add/17/", True), (124, "2. Set-Cookie: sessionid=k3x9", False),
             (174, "3. GET /cart/  +  Cookie: sessionid=k3x9", True), (214, "4. страница корзины: 17 × 2", False)]
    for y, s, right in steps:
        f.arrow(f"M190 {y}H560" if right else f"M560 {y}H190")
        f.text(375, y - 8, s, "cs", "middle")
    f.text(20, 318, "В cookie — только номер сессии. Сама корзина хранится на сервере и в cookie не попадает.", "s")
    f.save(out(HC1 / "06-cookies-sessions" / "img" / "session-cookie.svg"))


# ---------- HTML/CSS 1.07: что видит посредник ----------
def https_visibility():
    f = Figure(880, 250, "Что видит посредник в сети при HTTP и при HTTPS")
    for c, (title, cls, rows) in enumerate([
        ("HTTP — всё открытым текстом", "err", ["shop.example", "POST /checkout/", "Cookie: sessionid=k3x9", "card=0000 1111 2222 3333"]),
        ("HTTPS — зашифровано", "ok", ["shop.example", "8f3a 1c9e 04b7 d25e", "e61b 7a0f 93c4 1d88", "5c2e b940 a7d3 0f16"]),
    ]):
        x = 20 + c * 440
        f.text(x, 24, title, "h")
        f.box(x, 36, 420, 170, "", cls)
        for i, s in enumerate(rows):
            f.text(x + 20, 70 + i * 34, s, "c")
    f.text(20, 236, "При HTTPS посредник видит только домен и IP (и объём трафика). Путь, cookies и данные формы скрыты.", "s")
    f.save(out(HC1 / "07-https" / "img" / "https-visibility.svg"))


# ---------- HTML/CSS 2.01: дерево документа ----------
HC2 = ROOT / "html-css" / "02-html"


def document_tree():
    f = Figure(880, 300, "HTML-документ — дерево: html содержит head и body, внутри них — остальные элементы")
    f.raw('<rect x="20" y="20" width="360" height="260" rx="14" class="fig-term"/>')
    lines = ['<!doctype html>', '<html lang="ru">', '<head>', '  <meta charset="utf-8">', '  <title>Чайник Steel</title>',
             '</head>', '<body>', '  <h1>Чайник Steel</h1>', '  <p>Цена: <b>2490 ₽</b></p>', '</body>', '</html>']
    for i, s in enumerate(lines):
        f.text(36, 44 + i * 22, s, "tt")
    f.box(560, 20, 120, 36, "html", "acc", "onacc")
    f.box(450, 100, 120, 36, "head", "box2", "c"); f.box(680, 100, 120, 36, "body", "box2", "c")
    f.arrow("M600 56L520 96"); f.arrow("M640 56L730 96")
    f.box(410, 180, 90, 36, "meta", "box", "cs"); f.box(510, 180, 90, 36, "title", "box", "cs")
    f.arrow("M495 136L460 176"); f.arrow("M525 136L550 176")
    f.box(650, 180, 80, 36, "h1", "box", "cs"); f.box(750, 180, 80, 36, "p", "box", "cs")
    f.arrow("M720 136L695 176"); f.arrow("M760 136L785 176")
    f.box(750, 246, 80, 34, "b", "box", "cs"); f.arrow("M790 216V242")
    f.text(410, 268, "head — для браузера,", "s"); f.text(410, 286, "body — то, что видно", "s")
    f.save(out(HC2 / "01-html-document" / "img" / "document-tree.svg"))


# ---------- HTML/CSS 2.02: семантическая разметка страницы ----------
def semantic_layout():
    f = Figure(880, 330, "Семантические области страницы магазина: header с nav, main с article и section, aside, footer")
    f.box(20, 20, 840, 60, "", "box2"); f.text(36, 44, "<header>", "c"); f.text(36, 66, "логотип, поиск", "s")
    f.box(440, 32, 400, 36, "<nav>  Каталог · Доставка · Корзина", "acc", "onacc", rx=8)
    f.box(20, 92, 600, 170, "", "box"); f.text(36, 116, "<main>  — главное содержимое, одно на странице", "c")
    f.box(36, 128, 568, 60, "", "box2"); f.text(52, 152, "<article>", "c"); f.text(52, 174, "карточка товара: имеет смысл и отдельно", "s")
    f.box(36, 196, 568, 54, "", "box2"); f.text(52, 220, "<section>", "c"); f.text(52, 240, "раздел «Отзывы» с заголовком h2", "s")
    f.box(632, 92, 228, 170, "", "box"); f.text(648, 116, "<aside>", "c"); f.text(648, 140, "побочное: «С этим", "s"); f.text(648, 158, "покупают»", "s")
    f.box(20, 274, 840, 40, "", "box2"); f.text(36, 299, "<footer>", "c"); f.text(140, 299, "контакты, оферта, политика", "s")
    f.save(out(HC2 / "02-text-and-semantics" / "img" / "semantic-layout.svg"))


# ---------- HTML/CSS 2.03: куда ведёт путь ----------
def path_resolution():
    f = Figure(880, 250, "Куда ведут разные пути, если открыта страница https://shop.example/products/17/")
    f.text(20, 24, "Открыта страница:  https://shop.example/products/17/", "c")
    rows = [("img/kettle.jpg", "относительный", "/products/17/img/kettle.jpg"),
            ("../18/", "относительный, на уровень вверх", "/products/18/"),
            ("/static/img/kettle.jpg", "от корня сайта", "/static/img/kettle.jpg"),
            ("https://pay.example/", "абсолютный", "https://pay.example/")]
    for i, (src, kind, result) in enumerate(rows):
        y = 50 + i * 48
        f.box(20, y, 250, 36, "", "box2"); f.text(34, y + 23, src, "cs")
        f.arrow(f"M270 {y + 18}H540"); f.text(405, y + 12, kind, "s", "middle")
        f.box(544, y, 316, 36, "", "acc" if i == 2 else "box"); f.text(558, y + 23, result, "onacc" if i == 2 else "cs")
    f.save(out(HC2 / "03-links-and-images" / "img" / "path-resolution.svg"))


# ---------- HTML/CSS 2.04: устройство таблицы ----------
def table_anatomy():
    f = Figure(880, 250, "Таблица позиций заказа: thead с ячейками th, tbody со строками tr и ячейками td, tfoot с ячейкой на три колонки")
    x0, widths = 20, [300, 140, 100, 140]
    heads = ["Товар", "Цена", "Кол-во", "Сумма"]
    body = [["Чайник Steel", "2490", "1", "2490"], ["Кружка «Код»", "390", "2", "780"]]
    def row(y, cells, cls, tcls):
        x = x0
        for w, s in zip(widths, cells):
            f.box(x, y, w, 34, "", cls, rx=0); f.text(x + 12, y + 22, s, tcls)
            x += w
    row(30, heads, "box2", "t")
    for i, r in enumerate(body):
        row(64 + i * 34, r, "box", "cs")
    f.box(x0, 132, sum(widths[:3]), 34, "", "acc", rx=0); f.text(x0 + 12, 154, 'Итого  (td colspan="3")', "onacc")
    f.box(x0 + sum(widths[:3]), 132, widths[3], 34, "", "box", rx=0); f.text(x0 + sum(widths[:3]) + 12, 154, "3270", "cs")
    for y, label in [(47, "<thead> — th"), (98, "<tbody> — td"), (149, "<tfoot>")]:
        f.line(f"M{x0 + sum(widths) + 6} {y}H724", "lnd"); f.text(732, y + 5, label, "c")
    f.text(20, 200, "Каждая строка — <tr>. Заголовки колонок — <th>, данные — <td>.", "t")
    f.text(20, 224, "colspan объединяет ячейку на несколько колонок — строка «Итого» остаётся ровной.", "s")
    f.save(out(HC2 / "04-tables" / "img" / "table-anatomy.svg"))


# ---------- HTML/CSS 2.05: экранирование ----------
def escaping_flow():
    f = Figure(880, 230, "Текст отзыва без экранирования становится HTML и выполняется, с экранированием — показывается как текст")
    f.box(20, 80, 220, 70, "отзыв покупателя:|<script>…</script>", "box2", "cs")
    f.arrow("M240 100L360 50"); f.arrow("M240 130L360 180")
    f.box(364, 20, 250, 60, "вставили как есть", "err", "errt")
    f.box(364, 150, 250, 60, "экранировали:|&lt;script&gt;…", "ok", "cs")
    f.arrow("M614 50H650"); f.arrow("M614 180H650")
    f.box(654, 20, 206, 60, "браузер выполнит|скрипт — XSS", "err", "errt")
    f.box(654, 150, 206, 60, "браузер покажет|текст <script>…", "ok", "cs")
    f.save(out(HC2 / "05-escaping" / "img" / "escaping-flow.svg"))


# ---------- HTML/CSS 3.01: форма → запрос ----------
HC3 = ROOT / "html-css" / "03-forms"


def form_to_request():
    f = Figure(880, 330, "GET-форма кладёт поля в query-параметры URL, POST-форма — в тело запроса")
    for c, (title, form, req) in enumerate([
        ("GET — поиск", ['<form action="/search/"', '      method="get">', '  <input name="q">', '  <input name="sort">'],
         ["GET /search/?q=%D1%87%D0%B0…&sort=price", "Host: shop.example", "", "(тела нет)"]),
        ("POST — отзыв", ['<form action="/reviews/"', '      method="post">', '  <input name="rating">', '  <textarea name="text">'],
         ["POST /reviews/ HTTP/1.1", "Host: shop.example", "", "rating=5&text=%D0%9E%D1%82…"]),
    ]):
        x = 20 + c * 440
        f.text(x, 24, title, "h")
        f.box(x, 36, 420, 118, "", "box2")
        for i, s in enumerate(form):
            f.text(x + 16, 62 + i * 24, s, "cs")
        f.arrow(f"M{x + 210} 154V184")
        f.raw(f'<rect x="{x}" y="188" width="420" height="112" rx="14" class="fig-term"/>')
        for i, s in enumerate(req):
            f.text(x + 16, 214 + i * 24, s, "tt")
    f.text(20, 322, "В запрос попадают только поля с атрибутом name: name=значение.", "s")
    f.save(out(HC3 / "01-form-and-submit" / "img" / "form-to-request.svg"))


# ---------- HTML/CSS 3.03: два уровня проверки ----------
def validation_layers():
    f = Figure(880, 240, "Проверка в браузере — подсказка для покупателя, настоящая проверка — на сервере")
    f.box(20, 70, 170, 70, "Покупатель|заполняет форму", "box")
    f.arrow("M190 105H250")
    f.box(254, 50, 250, 110, "", "box2")
    f.text(270, 76, "Браузер: required, min, max,", "t"); f.text(270, 98, "pattern, type=\"email\"", "c")
    f.text(270, 128, "быстро, но обходится", "errt"); f.text(270, 148, "за секунды", "errt")
    f.arrow("M504 105H564")
    f.box(568, 50, 292, 110, "", "ok")
    f.text(584, 76, "Сервер (Django-форма):", "t"); f.text(584, 98, "те же правила + остатки, цены,", "s")
    f.text(584, 118, "права — то, чего браузер не знает", "s"); f.text(584, 148, "обязательна всегда", "t")
    f.arrow("M105 140V200H714V164", "lnd")
    f.text(120, 222, "curl, DevTools, свой скрипт — запрос в обход браузера всё равно придёт на сервер", "s")
    f.save(out(HC3 / "03-browser-validation" / "img" / "validation-layers.svg"))


# ---------- HTML/CSS 3.05: CSRF-атака ----------
def csrf_attack():
    f = Figure(880, 300, "Чужой сайт отправляет форму в магазин, браузер прикладывает cookie сессии; токен CSRF такую форму отсекает")
    f.box(20, 20, 200, 60, "evil.example|скрытая форма", "err", "errt")
    f.box(340, 110, 200, 70, "Браузер покупателя|cookie: sessionid=k3x9", "box", "cs")
    f.box(660, 20, 200, 60, "shop.example", "box2")
    f.arrow("M120 80L340 130"); f.text(150, 128, "1. страница сама", "s"); f.text(150, 146, "отправляет форму", "s")
    f.arrow("M540 130L700 80"); f.text(580, 120, "2. POST /orders/", "cs")
    f.text(580, 140, "+ Cookie: sessionid", "cs")
    f.box(560, 200, 300, 80, "", "ok")
    f.text(576, 226, "3. Django: где csrf-токен?", "t")
    f.text(576, 248, "у чужого сайта его нет → 403", "s")
    f.text(576, 268, "своя форма содержит токен → OK", "s")
    f.arrow("M760 80V196")
    f.text(20, 230, "Cookie браузер прикладывает", "s"); f.text(20, 248, "к любому запросу в магазин —", "s")
    f.text(20, 266, "даже начатому с чужого сайта.", "s")
    f.save(out(HC3 / "05-csrf" / "img" / "csrf-attack.svg"))


# ---------- HTML/CSS 4.01: каскад и специфичность ----------
HC4 = ROOT / "html-css" / "04-css"


def css_specificity():
    f = Figure(880, 250, "Три правила задают цвет одной цене; побеждает правило с большей специфичностью, при равной — то, что ниже")
    f.text(20, 30, "<p class=\"price\" id=\"main-price\">", "c")
    rows = [("p { color: gray; }", "0-0-1", "box"),
            (".card .price { color: green; }", "0-2-0", "box"),
            ("#main-price { color: red; }", "1-0-0", "acc")]
    for k, (rule, spec, cls) in enumerate(rows):
        y = 52 + k * 56
        f.box(20, y, 380, 44, "", cls)
        f.text(36, y + 27, rule, "onacc" if cls == "acc" else "c")
        f.box(420, y, 100, 44, spec, "box2", "c")
    f.text(420, 230, "id - классы - теги", "s")
    f.arrow("M520 186H580")
    f.box(584, 160, 276, 52, "Итог: color: red", "ok")
    f.text(584, 66, "Сравниваем слева направо:", "t")
    f.text(584, 90, "один id сильнее любых классов,", "s")
    f.text(584, 110, "один класс сильнее любых тегов.", "s")
    f.text(584, 134, "Равны — побеждает правило ниже.", "s")
    f.save(out(HC4 / "01-selectors" / "img" / "specificity.svg"))


# ---------- HTML/CSS 4.03: блоковая модель ----------
def box_model():
    f = Figure(880, 280, "Блоковая модель: содержимое, внутренний отступ, рамка и внешний отступ")
    f.raw('<rect x="20" y="20" width="520" height="240" rx="6" class="fig-dash"/>')
    f.text(32, 42, "margin — снаружи, прозрачный", "s")
    f.raw('<rect x="60" y="56" width="440" height="168" rx="6" class="fig-box2" style="stroke-width:6"/>')
    f.text(76, 82, "border", "s")
    f.raw('<rect x="66" y="62" width="428" height="156" rx="4" class="fig-box"/>')
    f.text(90, 100, "padding — внутри рамки, фон карточки", "s")
    f.box(140, 114, 280, 70, "содержимое|Кружка «Код», 499 ₽", "acc", "onacc")
    f.text(570, 60, "width при box-sizing: content-box", "t")
    f.text(570, 84, "= только содержимое;", "s")
    f.text(570, 104, "рамка и padding прибавляются сверху", "s")
    f.text(570, 150, "width при box-sizing: border-box", "t")
    f.text(570, 174, "= содержимое + padding + border;", "s")
    f.text(570, 194, "карточка ровно той ширины, что задана", "s")
    f.text(570, 240, "margin в ширину не входит никогда", "s")
    f.save(out(HC4 / "03-box-model" / "img" / "box-model.svg"))


# ---------- HTML/CSS 4.04: оси Flexbox ----------
def flex_axes():
    f = Figure(880, 250, "Flexbox: главная ось и поперечная; justify-content двигает по главной, align-items — по поперечной")
    f.box(20, 40, 640, 120, "", "box2")
    f.text(32, 26, "<header> — display: flex", "c")
    f.box(40, 70, 130, 60, "логотип", "box")
    f.raw('<rect x="386" y="56" width="264" height="88" rx="10" class="fig-dash"/>')
    f.text(396, 52, "<nav> — второй элемент", "cs")
    f.box(400, 70, 110, 60, "поиск", "box")
    f.box(530, 70, 110, 60, "корзина", "acc", "onacc")
    f.arrow("M40 190H640"); f.text(40, 212, "главная ось (flex-direction: row) → justify-content", "s")
    f.arrow("M690 40V160"); f.text(700, 100, "поперечная ось", "s")
    f.text(700, 120, "→ align-items", "s")
    f.text(40, 238, "space-between: логотип к левому краю, <nav> к правому; gap — расстояние между поиском и корзиной", "s")
    f.save(out(HC4 / "04-flexbox" / "img" / "flex-axes.svg"))


# ---------- HTML/CSS 4.05: адаптивный каталог ----------
def responsive_grid():
    f = Figure(880, 260, "Один и тот же каталог: четыре карточки в ряд на ПК и одна на телефоне — меняет @media")
    f.box(20, 30, 520, 200, "", "box2")
    f.text(32, 22, "ПК, 1024 px", "h")
    for k in range(4):
        f.box(40 + k * 124, 60, 108, 140, f"товар {k + 1}", "box")
    f.box(600, 30, 150, 220, "", "box2")
    f.text(612, 22, "телефон, 375 px", "h")
    for k in range(3):
        f.box(616, 46 + k * 66, 118, 56, f"товар {k + 1}", "box")
    f.text(770, 60, "@media", "c")
    f.text(770, 82, "(max-width:", "c")
    f.text(770, 104, "600px)", "c")
    f.text(770, 134, "карточка", "s")
    f.text(770, 152, "во всю", "s")
    f.text(770, 170, "ширину", "s")
    f.save(out(HC4 / "05-responsive" / "img" / "responsive-grid.svg"))


# ---------- HTML/CSS 5.01: карточка товара как компонент ----------
HC5 = ROOT / "html-css" / "05-whole-page"


def card_anatomy():
    f = Figure(880, 320, "Карточка товара: блок card и его части с именами card__…, вариант card--sale")
    f.box(20, 20, 260, 260, "", "box")
    f.box(36, 36, 228, 110, "фото", "box2")
    f.text(36, 172, "Кружка «Код»", "t")
    f.text(36, 200, "499 ₽", "t"); f.text(100, 200, "699 ₽", "s")
    f.box(36, 222, 120, 40, "В корзину", "acc", "onacc")
    labels = [(272, ".card — блок, рамка карточки", 20), (91, ".card__image", 36),
              (167, ".card__title", 160), (195, ".card__price, .card__price--old", 190),
              (242, ".card__buy", 222)]
    for y, name, _ in labels:
        f.line(f"M{284 if y < 260 else 280} {y}H420", "lnd")
        f.text(430, y + 5, name, "c")
    f.text(430, 40, "блок = компонент: свои классы, без id", "s")
    f.text(430, 306, "<article class=\"card card--sale\"> — вариант блока", "cs")
    f.save(out(HC5 / "01-product-card" / "img" / "card-anatomy.svg"))


# ---------- HTML/CSS 5.02: состояния каталога ----------
def catalog_states():
    f = Figure(880, 250, "Каталог: список карточек, пустое состояние и пагинация обычными ссылками")
    f.text(20, 24, "товары есть", "h")
    f.box(20, 36, 400, 150, "", "box2")
    for k in range(3):
        f.box(36 + k * 128, 52, 112, 80, f"карточка {k + 1}", "box")
    f.box(36, 146, 80, 28, "← назад", "box", "cs")
    f.text(176, 165, "стр. 2 из 5", "s")
    f.box(324, 146, 80, 28, "дальше →", "box", "cs")
    f.text(460, 24, "товаров нет", "h")
    f.box(460, 36, 400, 150, "", "box2")
    f.text(660, 100, "По запросу «самовар» ничего нет", "t", "middle")
    f.text(660, 126, "ссылка: «Весь каталог»", "s", "middle")
    f.text(20, 214, "Пагинация — ссылки <a href=\"?page=3\">: номер страницы уходит на сервер в query-параметре.", "s")
    f.text(20, 236, "Пустой список — отдельное сообщение, а не пустая страница.", "s")
    f.save(out(HC5 / "02-catalog" / "img" / "catalog-states.svg"))


# ---------- HTML/CSS 5.03: общие части страниц ----------
def shared_layout():
    f = Figure(880, 280, "Три страницы с одной шапкой и подвалом: копии расходятся, шаблон хранит их в одном месте")
    f.text(20, 24, "копии в каждом файле", "h")
    for k, name in enumerate(("index.html", "catalog.html", "about.html")):
        x = 20 + k * 136
        f.box(x, 36, 124, 200, "", "box2")
        f.box(x + 8, 44, 108, 32, "шапка", "err" if k == 2 else "box", "errt" if k == 2 else "t")
        f.text(x + 62, 140, name, "cs", "middle")
        f.box(x + 8, 196, 108, 32, "подвал", "box")
    f.text(20, 262, "about.html: забыли добавить новую ссылку в шапку", "errt")
    f.arrow("M440 136H500")
    f.text(520, 24, "один шаблон + страницы", "h")
    f.box(520, 36, 340, 84, "", "ok")
    f.text(536, 62, "base.html: шапка, подвал,", "t")
    f.text(536, 86, "место для содержимого", "t")
    f.text(536, 108, "{% block content %}", "cs")
    for k, name in enumerate(("index", "catalog", "about")):
        f.box(520 + k * 116, 170, 108, 50, name + "|extends base", "box", "cs")
        f.arrow(f"M{574 + k * 116} 170V124")
    f.text(520, 254, "шапку правят в одном файле — меняются все страницы", "s")
    f.save(out(HC5 / "03-shared-parts" / "img" / "shared-layout.svg"))


# ---------- SQL 1.01: приложение, СУБД, файлы ----------
SQ1 = ROOT / "sql" / "01-intro"


def app_dbms():
    f = Figure(880, 250, "Приложения отправляют SQL-запросы СУБД; только она работает с файлами базы на диске")
    for k, name in enumerate(("Сайт магазина", "Админка", "Скрипт отчёта")):
        f.box(20, 30 + k * 70, 180, 50, name, "box")
        f.arrow(f"M200 {55 + k * 70}L330 {125 + (k - 1) * 20}")
    f.text(214, 30, "SQL-запрос →", "cs")
    f.text(214, 226, "← строки результата", "cs")
    f.box(334, 40, 280, 170, "", "acc")
    f.text(474, 72, "СУБД PostgreSQL", "onacc", "middle")
    for k, line in enumerate(("очередь одновременных запросов", "проверка ограничений", "поиск по индексам",
                              "транзакции: всё или ничего")):
        f.text(352, 104 + k * 26, "• " + line, "onacc")
    f.arrow("M614 125H690")
    f.box(694, 70, 166, 110, "файлы базы|на диске", "box2")
    f.text(694, 206, "напрямую их не читает", "s")
    f.text(694, 224, "никто, кроме СУБД", "s")
    f.save(out(SQ1 / "01-what-is-db" / "img" / "app-dbms.svg"))


# ---------- SQL 1.02: первичный и внешний ключ ----------
def _grid(f, x, y, cols, rows, key):
    cx = x
    for name, w in cols:
        f.box(cx, y, w, 34, name, "acc" if name == key else "box2", "onacc" if name == key else "c", rx=4)
        cx += w
    for r, row in enumerate(rows):
        cx = x
        for (name, w), v in zip(cols, row):
            f.box(cx, y + 34 + r * 34, w, 34, v, "box", "t" if name in ("name", "status") else "c", rx=4)
            cx += w


def table_keys():
    f = Figure(880, 260, "Таблица orders ссылается на users: значение user_id равно id покупателя")
    f.text(20, 24, "users", "h")
    _grid(f, 20, 34, [("id", 60), ("name", 180)],
          [("1", "Анна Смирнова"), ("2", "Борис Иванов"), ("3", "Вера Кузнецова")], "id")
    f.text(540, 24, "orders", "h")
    _grid(f, 540, 34, [("id", 60), ("user_id", 100), ("status", 140)],
          [("1", "1", "shipped"), ("2", "2", "shipped"), ("3", "3", "cancelled"), ("6", "1", "shipped")], "user_id")
    for r_from, r_to in ((0, 0), (1, 1), (2, 2), (3, 0)):
        f.arrow(f"M540 {85 + r_from * 34}L264 {85 + r_to * 34}", "lnd")
    f.text(20, 190, "id — первичный ключ: уникален, не NULL,", "s")
    f.text(20, 208, "по нему строку находят однозначно", "s")
    f.text(540, 222, "user_id — внешний ключ: значение id", "s")
    f.text(540, 240, "строки в users; заказ 6 — снова Анна", "s")
    f.save(out(SQ1 / "02-tables-keys" / "img" / "table-keys.svg"))


# ---------- SQL 1.03: схема БД магазина ----------
def shop_schema():
    f = Figure(880, 510, "Таблицы магазина и связи между ними: стрелка идёт от внешнего ключа к таблице, на которую он ссылается")

    def tab(key, x, y, cols, acc=False, w=170):
        f.box(x, y, w, 30 + 20 * len(cols), "", "box")
        f.raw(f'<rect x="{x}" y="{y}" width="{w}" height="30" rx="12" class="fig-{"acc" if acc else "box2"}"/>')
        f.text(x + 12, y + 20, key, "onacc" if acc else "c")
        for k, c in enumerate(cols):
            f.text(x + 12, y + 46 + k * 20, c, "cs")

    tab("users", 20, 20, ["id", "email", "name", "city ?", "is_active", "created_at"], True)
    tab("profiles", 20, 240, ["user_id → users", "phone ?", "birth_date ?"])
    tab("reviews", 20, 380, ["user_id → users", "product_id → …", "rating, text ?"])
    tab("orders", 250, 20, ["id", "user_id → users", "promo_code_id ?", "status", "created_at"], True)
    tab("promo_codes", 250, 240, ["id", "code", "discount_percent", "valid_until", "is_active"])
    tab("order_items", 480, 20, ["order_id → orders", "product_id →", "quantity", "price"])
    tab("products", 480, 240, ["id", "category_id →", "name", "price", "stock", "attributes", "created_at"], True)
    tab("product_tags", 700, 20, ["product_id →", "tag_id →"], w=160)
    tab("tags", 700, 120, ["id", "name"], w=160)
    tab("categories", 700, 240, ["id", "name", "parent_id ?"], w=160)
    f.arrow("M160 240V156")                      # profiles → users
    f.arrow("M190 420H215V100H190")              # reviews → users
    f.arrow("M105 470V495H565V410")              # reviews → products
    f.arrow("M250 75H190")                       # orders → users
    f.arrow("M335 150V240")                      # orders → promo_codes
    f.arrow("M480 75H420")                       # order_items → orders
    f.arrow("M565 130V240")                      # order_items → products
    f.arrow("M700 60H675V265H650")               # product_tags → products
    f.arrow("M780 90V120")                       # product_tags → tags
    f.arrow("M650 301H700")                      # products → categories
    f.arrow("M860 341H874V258H860")              # categories → categories (родитель)
    f.text(700, 380, "→ внешний ключ: стрелка", "s")
    f.text(700, 398, "к таблице, на которую он", "s")
    f.text(700, 416, "ссылается", "s")
    f.text(700, 440, "? — может быть NULL", "s")
    f.text(700, 464, "лайм — главные таблицы", "s")
    f.save(out(SQ1 / "03-shop-db" / "img" / "shop-schema.svg"))

# ---------- SQL 2.01: SELECT выбирает столбцы, WHERE — строки ----------
SQ2 = ROOT / "sql" / "02-select"


def select_where():
    f = Figure(880, 280, "SELECT оставляет нужные столбцы, WHERE — нужные строки")
    cols = [("id", 50), ("name", 230), ("price", 110), ("stock", 80)]
    rows = [("1", "Ноутбук Aster 14", "64990.00", "5"), ("3", "Ноутбук Nimbus Air", "54990.00", "0"),
            ("4", "Беспроводная мышь", "1499.00", "12"), ("8", "USB-хаб на 4 порта", "1499.00", "0")]
    keep_cols, keep_rows = {"name", "price"}, {1, 3}
    cx = 20
    for name, w in cols:
        f.box(cx, 30, w, 32, name, "acc" if name in keep_cols else "box2", "onacc" if name in keep_cols else "c", rx=4)
        for r, row in enumerate(rows):
            v = row[[c for c, _ in cols].index(name)]
            on = name in keep_cols and r in keep_rows
            f.box(cx, 62 + r * 32, w, 32, v, "acc" if on else "box", "onacc" if on else "t", rx=4)
        cx += w
    f.text(20, 22, "products", "h")
    f.text(20, 214, "SELECT name, price — лаймовые столбцы", "s")
    f.text(20, 234, "WHERE stock = 0 — строки 3 и 8", "s")
    f.arrow("M500 126H580")
    for r, (a, b) in enumerate((("name", "price"), ("Ноутбук Nimbus Air", "54990.00"), ("USB-хаб на 4 порта", "1499.00"))):
        f.box(584, 78 + r * 32, 180, 32, a, "box2" if r == 0 else "box", "c" if r == 0 else "t", rx=4)
        f.box(764, 78 + r * 32, 96, 32, b, "box2" if r == 0 else "box", "c" if r == 0 else "t", rx=4)
    f.text(584, 200, "(2 rows)", "cs")
    f.save(out(SQ2 / "01-select" / "img" / "select-where.svg"))


# ---------- SQL 2.04: сравнение с NULL ----------
def null_compare():
    f = Figure(880, 230, "Сравнение с NULL даёт «неизвестно», и WHERE отбрасывает строку")
    f.box(20, 30, 250, 60, "city = 'Москва'|для city = NULL", "box", "c")
    f.arrow("M270 60H330")
    f.box(334, 30, 150, 60, "NULL|«неизвестно»", "box2")
    f.arrow("M484 60H544")
    f.box(548, 30, 312, 60, "WHERE берёт только TRUE —|строка отброшена", "err", "errt")
    f.box(20, 130, 250, 60, "city IS NULL", "box", "c")
    f.arrow("M270 160H330")
    f.box(334, 130, 150, 60, "TRUE", "ok")
    f.arrow("M484 160H544")
    f.box(548, 130, 312, 60, "строка в результате", "ok")
    f.text(20, 218, "= NULL, <> NULL, > NULL — всегда NULL; проверять отсутствие значения — только IS NULL / IS NOT NULL", "s")
    f.save(out(SQ2 / "04-null" / "img" / "null-compare.svg"))


# ---------- SQL 2.05: LIMIT и OFFSET ----------
def limit_offset():
    f = Figure(880, 220, "Пагинация: ORDER BY задаёт порядок, OFFSET пропускает строки предыдущих страниц, LIMIT берёт страницу")
    for k in range(15):
        page = k // 5
        cls = "acc" if page == 1 else ("box2" if page == 0 else "box")
        f.box(20 + k * 56, 50, 50, 50, str(k + 1), cls, "onacc" if page == 1 else "c", rx=6)
    f.text(20, 36, "строки после ORDER BY price, id", "h")
    f.line("M20 116H294", "ln"); f.text(20, 138, "OFFSET 5 — пропустить страницу 1", "s")
    f.line("M300 116H574", "ln"); f.text(300, 138, "LIMIT 5 — взять страницу 2", "s")
    f.text(580, 138, "страница 3 — OFFSET 10", "s")
    f.text(20, 186, "OFFSET = (номер страницы − 1) × размер страницы. Без ORDER BY порядок строк не гарантирован,", "s")
    f.text(20, 206, "и одна и та же строка может попасть на две страницы.", "s")
    f.save(out(SQ2 / "05-order-limit" / "img" / "limit-offset.svg"))


# ---------- SQL 3.01: откуда значения новой строки ----------
SQ3 = ROOT / "sql" / "03-modify"


def insert_defaults():
    f = Figure(880, 290, "INSERT: столбцы из списка берут значения из VALUES, остальные — из DEFAULT")
    f.box(20, 20, 840, 44, "INSERT INTO products (category_id, name, price) VALUES (9, 'Книга', 2290)", "box2", "c", rx=8)
    cols = [("id", 70, "24", "счётчик"), ("category_id", 120, "9", "VALUES"), ("name", 120, "Книга", "VALUES"),
            ("price", 110, "2290.00", "VALUES"), ("stock", 80, "0", "DEFAULT"), ("attributes", 120, "{}", "DEFAULT"),
            ("created_at", 220, "now()", "DEFAULT")]
    cx = 20
    for name, w, v, src in cols:
        given = src == "VALUES"
        f.box(cx, 110, w, 32, name, "acc" if given else "box2", "onacc" if given else "c", rx=4)
        f.box(cx, 142, w, 32, v, "box", "c", rx=4)
        f.text(cx + w / 2, 196, src, "s", "middle")
        cx += w
    f.arrow("M300 64V106")
    f.text(20, 98, "products — новая строка", "h")
    f.text(20, 236, "лайм — столбцы из списка INSERT: значения из VALUES по порядку;", "s")
    f.text(20, 256, "id выдаёт счётчик GENERATED ALWAYS AS IDENTITY; stock, attributes, created_at — DEFAULT из CREATE TABLE.", "s")
    f.text(20, 276, "Столбец без DEFAULT получил бы NULL, а с NOT NULL и без DEFAULT — ошибку.", "s")
    f.save(out(SQ3 / "01-insert" / "img" / "insert-defaults.svg"))


# ---------- SQL 3.03: ON DELETE ----------
def fk_actions():
    f = Figure(880, 330, "Что делает внешний ключ, когда удаляют строку, на которую он ссылается")
    rows = [
        ("RESTRICT", "DELETE FROM users|WHERE id = 4", "orders.user_id", "ошибка: на покупателя|ссылаются заказы", "err", "errt"),
        ("CASCADE", "DELETE FROM orders|WHERE id = 3", "order_items.order_id", "позиции заказа|удалены вместе с ним", "box2", "t"),
        ("SET NULL", "DELETE FROM promo_codes|WHERE id = 4", "orders.promo_code_id", "заказы остались,|promo_code_id = NULL", "ok", "t"),
    ]
    f.text(20, 24, "ON DELETE", "h")
    f.text(160, 24, "запрос", "h")
    f.text(410, 24, "кто ссылается", "h")
    f.text(626, 24, "результат", "h")
    for k, (rule, query, ref, result, cls, tcls) in enumerate(rows):
        y = 36 + k * 90
        f.box(20, y, 120, 70, rule, "acc", "onacc")
        f.box(160, y, 220, 70, query, "box", "c")
        f.arrow(f"M380 {y + 35}H406")
        f.box(410, y, 190, 70, ref, "box2", "cs")
        f.arrow(f"M600 {y + 35}H622")
        f.box(626, y, 234, 70, result, cls, tcls)
    f.text(20, 318, "RESTRICT отменяет весь DELETE целиком; CASCADE и SET NULL срабатывают для каждой удалённой строки.", "s")
    f.save(out(SQ3 / "03-delete" / "img" / "fk-actions.svg"))


# ---------- SQL 3.04: INSERT … ON CONFLICT ----------
def upsert_flow():
    f = Figure(880, 300, "INSERT … ON CONFLICT: для каждой строки из VALUES база ищет строку с тем же уникальным ключом")
    f.box(20, 110, 200, 60, "строка из VALUES|= EXCLUDED", "box2", "c")
    f.arrow("M220 140H270")
    f.diamond(360, 140, 180, 80, "ключ уже есть?")
    f.arrow("M360 100V60H446")
    f.text(368, 52, "нет", "s")
    f.box(450, 30, 410, 60, "INSERT — новая строка", "ok")
    f.arrow("M450 140H500")
    f.text(458, 132, "да", "s")
    f.box(504, 110, 356, 60, "DO NOTHING — строка пропущена,|в RETURNING её нет", "box")
    f.arrow("M360 180V230H446")
    f.text(368, 214, "да", "s")
    f.box(450, 200, 410, 60, "DO UPDATE SET qty = t.qty + EXCLUDED.qty|t.qty — из базы, EXCLUDED.qty — новая", "acc", "onacc")
    f.text(20, 290, "Ключ — PRIMARY KEY или UNIQUE из ON CONFLICT (…); без такого ограничения запрос падает.", "s")
    f.save(out(SQ3 / "04-upsert" / "img" / "upsert-flow.svg"))


# ---------- SQL 4.01: выбор типа ----------
SQ4 = ROOT / "sql" / "04-tables"


def type_choice():
    f = Figure(880, 300, "Тип столбца выбирают по смыслу значения")
    rows = [("цена, сумма, скидка в рублях", "numeric(10,2)", "real — погрешность: 0.1 + 0.2 ≠ 0.3"),
            ("количество, остаток, ключ", "integer / bigint", "numeric — лишняя точность"),
            ("название, email, адрес", "text", "varchar(255) — лимит без смысла"),
            ("да / нет", "boolean", "'yes' / 'no', 0 / 1"),
            ("день без времени", "date", "text — сортировка по алфавиту"),
            ("момент события", "timestamptz", "timestamp — неизвестен пояс"),
            ("разные характеристики", "jsonb", "столбец на каждый ключ")]
    f.text(20, 24, "значение", "h")
    f.text(310, 24, "тип", "h")
    f.text(540, 24, "не так", "h")
    for k, (what, typ, bad) in enumerate(rows):
        y = 34 + k * 37
        f.box(20, y, 270, 31, what, "box", "t", rx=6)
        f.arrow(f"M290 {y + 15}H306")
        f.box(310, y, 210, 31, typ, "acc", "onacc", rx=6)
        f.text(540, y + 20, bad, "s")
    f.save(out(SQ4 / "01-create-types" / "img" / "type-choice.svg"))


# ---------- SQL 4.03: внешние ключи wishlist ----------
def wishlist_fk():
    f = Figure(880, 250, "wishlist ссылается на users и products; ON DELETE CASCADE удаляет строки избранного вместе с покупателем или товаром")

    def tab(key, x, y, cols, acc=False, w=230):
        f.box(x, y, w, 30 + 22 * len(cols), "", "box")
        f.raw(f'<rect x="{x}" y="{y}" width="{w}" height="30" rx="12" class="fig-{"acc" if acc else "box2"}"/>')
        f.text(x + 12, y + 20, key, "onacc" if acc else "c")
        for k, c in enumerate(cols):
            f.text(x + 12, y + 48 + k * 22, c, "cs")

    tab("users", 20, 20, ["id  PRIMARY KEY", "email", "name"])
    tab("products", 20, 140, ["id  PRIMARY KEY", "name", "price"])
    tab("wishlist", 560, 60, ["user_id → users", "product_id → products", "added_at", "PK (user_id, product_id)"], True, w=300)
    f.arrow("M560 107H400V45H250")
    f.arrow("M560 129H400V165H250")
    f.text(268, 36, "ON DELETE CASCADE", "s")
    f.text(268, 184, "ON DELETE CASCADE", "s")
    f.text(560, 210, "ссылка — только на PRIMARY KEY или UNIQUE;", "s")
    f.text(560, 228, "users и products создают раньше wishlist", "s")
    f.save(out(SQ4 / "03-foreign-keys" / "img" / "wishlist-fk.svg"))


# ---------- SQL 4.05: порядок DROP ----------
def drop_order():
    f = Figure(880, 250, "Удаляют сначала таблицу, которая ссылается; DROP … CASCADE удаляет только внешний ключ")
    f.box(20, 40, 240, 60, "import_rows|batch_id → import_batches", "box2", "c")
    f.arrow("M260 70H330")
    f.text(297, 120, "внешний ключ", "s", "middle")
    f.box(334, 40, 200, 60, "import_batches", "box2", "c")
    f.box(580, 30, 280, 36, "1. DROP TABLE import_rows", "ok", "c", rx=8)
    f.box(580, 74, 280, 36, "2. DROP TABLE import_batches", "ok", "c", rx=8)
    f.box(20, 150, 514, 60, "DROP TABLE import_batches → ошибка:|cannot drop … other objects depend on it", "err", "errt")
    f.box(580, 140, 280, 80, "DROP TABLE import_batches CASCADE|import_rows остаётся,|удалён только внешний ключ", "box", "t")
    f.text(20, 240, "Или обе таблицы одной командой: DROP TABLE import_rows, import_batches — порядок PostgreSQL выберет сам.", "s")
    f.save(out(SQ4 / "05-drop" / "img" / "drop-order.svg"))


# ---------- SQL 5.01: виды связей ----------
SQ5 = ROOT / "sql" / "05-joins"


def relation_types():
    f = Figure(880, 300, "Один ко многим, один к одному и многие ко многим в базе магазина")

    def tab(x, y, name, w=150, acc=False):
        f.box(x, y, w, 40, name, "acc" if acc else "box2", "onacc" if acc else "c", rx=8)

    f.text(20, 24, "1:N", "h")
    tab(20, 40, "users"); tab(20, 140, "orders")
    f.arrow("M95 140V80")
    f.text(105, 116, "orders.user_id", "cs")
    f.text(20, 210, "у покупателя много заказов;", "s")
    f.text(20, 228, "ключ — на стороне «многих»", "s")
    f.text(300, 24, "1:1", "h")
    tab(300, 40, "users"); tab(300, 140, "profiles")
    f.arrow("M375 140V80")
    f.text(385, 116, "user_id — PK", "cs")
    f.text(300, 210, "внешний ключ ещё и уникален —", "s")
    f.text(300, 228, "второго профиля не будет", "s")
    f.text(570, 24, "N:M", "h")
    tab(570, 40, "orders", 130); tab(730, 40, "products", 130)
    tab(625, 140, "order_items", 180, True)
    f.arrow("M670 140L635 80"); f.arrow("M760 140L795 80")
    f.text(570, 210, "связка: пара «заказ — товар»", "s")
    f.text(570, 228, "+ quantity, price", "s")
    f.text(20, 280, "Стрелка — внешний ключ: от таблицы, где он хранится, к таблице, на которую ссылается.", "s")
    f.save(out(SQ5 / "01-relations" / "img" / "relation-types.svg"))


def _cells(f, x, y, cols, rows, colors=None):
    """Таблица ячейками: cols — [(имя, ширина)], rows — кортежи значений, colors — {номер строки: класс}."""
    cx = x
    for name, w in cols:
        f.box(cx, y, w, 30, name, "box2", "c", rx=4)
        cx += w
    for k, row in enumerate(rows):
        cx = x
        for (_, w), v in zip(cols, row):
            f.box(cx, y + 30 + k * 30, w, 30, v, (colors or {}).get(k, "box"), "c", rx=4)
            cx += w


# ---------- SQL 5.02: INNER JOIN ----------
def inner_join():
    f = Figure(880, 280, "INNER JOIN: в результат попадают только пары, для которых выполнено ON")
    f.text(20, 22, "users", "h")
    _cells(f, 20, 30, [("id", 50), ("name", 120)], [("1", "Анна"), ("2", "Борис"), ("9", "Ирина")], {0: "m1", 1: "m2"})
    f.text(260, 22, "orders", "h")
    _cells(f, 260, 30, [("id", 50), ("user_id", 100)], [("1", "1"), ("2", "2"), ("6", "1")], {0: "m1", 1: "m2", 2: "m1"})
    f.text(480, 22, "результат", "h")
    _cells(f, 480, 30, [("name", 120), ("order_id", 100)], [("Анна", "1"), ("Борис", "2"), ("Анна", "6")], {0: "m1", 1: "m2", 2: "m1"})
    f.arrow("M410 105H476")
    f.text(20, 186, "ON u.id = o.user_id: пары одного цвета.", "s")
    f.text(20, 206, "У Анны два заказа — две строки результата.", "s")
    f.text(20, 226, "У Ирины заказов нет — в результате её нет.", "s")
    f.save(out(SQ5 / "02-inner-join" / "img" / "inner-join.svg"))


# ---------- SQL 5.03: LEFT JOIN ----------
def left_join():
    f = Figure(880, 280, "LEFT JOIN сохраняет все строки левой таблицы; без пары — NULL справа")
    f.text(20, 22, "users (левая)", "h")
    _cells(f, 20, 30, [("id", 50), ("name", 120)], [("1", "Анна"), ("2", "Борис"), ("9", "Ирина")], {0: "m1", 1: "m2", 2: "m3"})
    f.text(260, 22, "orders", "h")
    _cells(f, 260, 30, [("id", 50), ("user_id", 100)], [("1", "1"), ("2", "2"), ("6", "1")], {0: "m1", 1: "m2", 2: "m1"})
    f.text(480, 22, "результат", "h")
    _cells(f, 480, 30, [("name", 120), ("order_id", 100)], [("Анна", "1"), ("Анна", "6"), ("Борис", "2"), ("Ирина", "NULL")],
           {0: "m1", 1: "m1", 2: "m2", 3: "m3"})
    f.arrow("M410 105H476")
    f.text(20, 186, "Ирина без заказов осталась: столбцы orders — NULL.", "s")
    f.text(20, 206, "WHERE o.id IS NULL оставит только таких — «покупатели без заказов».", "s")
    f.text(20, 226, "Условие на orders в WHERE выбросило бы Ирину — его пишут в ON.", "s")
    f.save(out(SQ5 / "03-left-join" / "img" / "left-join.svg"))


# ---------- SQL 5.04: цепочка JOIN ----------
def join_chain():
    f = Figure(880, 200, "Каждое соединение идёт по внешнему ключу и присоединяет таблицу к уже собранному результату")
    names = [("users", 20), ("orders", 200), ("order_items", 380), ("products", 580), ("categories", 740)]
    for name, x in names:
        f.box(x, 50, 140 if name != "order_items" else 160, 44, name, "acc" if name == "order_items" else "box2",
              "onacc" if name == "order_items" else "c", rx=8)
    f.arrow("M200 72H164"); f.text(170, 120, "o.user_id", "cs")
    f.arrow("M380 72H344"); f.text(340, 120, "oi.order_id", "cs")
    f.arrow("M540 72H576"); f.text(530, 120, "oi.product_id", "cs")
    f.arrow("M720 72H736"); f.text(700, 120, "p.category_id", "cs")
    f.text(20, 170, "к одному (заказ → покупатель, позиция → товар) — строк не прибавляется;", "s")
    f.text(20, 188, "ко многим (заказ → позиции) — строка заказа повторяется для каждой позиции.", "s")
    f.save(out(SQ5 / "04-many-joins" / "img" / "join-chain.svg"))


# ---------- SQL 5.05: самосвязь ----------
def self_join():
    f = Figure(880, 250, "Самосвязь: таблица categories участвует в запросе дважды — как c и как p")
    f.text(20, 22, "categories c", "h")
    _cells(f, 20, 30, [("id", 50), ("name", 140), ("parent_id", 100)],
           [("2", "Компьютеры", "1"), ("3", "Ноутбуки", "2"), ("9", "Книги", "NULL")], {0: "m1", 1: "m2", 2: "m3"})
    f.text(470, 22, "categories p", "h")
    _cells(f, 470, 30, [("id", 50), ("name", 150)], [("1", "Электроника"), ("2", "Компьютеры")], {0: "m1", 1: "m2"})
    f.arrow("M310 75H466"); f.arrow("M310 105H466")
    f.text(320, 56, "p.id = c.parent_id", "cs")
    f.text(20, 190, "Ноутбуки → родитель Компьютеры, Компьютеры → Электроника.", "s")
    f.text(20, 210, "У Книг parent_id — NULL: пары нет, поэтому LEFT JOIN, иначе корни пропадут.", "s")
    f.text(20, 230, "ON c.id = p.parent_id искал бы наоборот — детей категории.", "s")
    f.save(out(SQ5 / "05-full-cross-self" / "img" / "self-join.svg"))


# ---------- SQL 5.06: UNION, INTERSECT, EXCEPT ----------
def set_operations():
    f = Figure(880, 250, "UNION, INTERSECT и EXCEPT: что остаётся от двух наборов строк")
    f.raw('<defs><clipPath id="so-a"><circle cx="370" cy="110" r="60"/></clipPath></defs>')
    for k, (title, op) in enumerate((("A UNION B", "union"), ("A INTERSECT B", "intersect"), ("A EXCEPT B", "except"))):
        ax, bx = 90 + k * 280, 160 + k * 280
        if op == "union":
            f.raw(f'<circle cx="{ax}" cy="110" r="60" class="fig-acc"/><circle cx="{bx}" cy="110" r="60" class="fig-acc"/>')
        elif op == "intersect":
            f.raw(f'<circle cx="{bx}" cy="110" r="60" class="fig-acc" clip-path="url(#so-a)"/>')
        else:
            f.raw(f'<circle cx="{ax}" cy="110" r="60" class="fig-acc"/><circle cx="{bx}" cy="110" r="60" class="fig-box"/>')
        f.raw(f'<circle cx="{ax}" cy="110" r="60" class="fig-ln"/><circle cx="{bx}" cy="110" r="60" class="fig-ln"/>')
        f.text(ax - 30, 114, "A", "c", "middle"); f.text(bx + 30, 114, "B", "c", "middle")
        f.text((ax + bx) / 2, 204, title, "c", "middle")
    f.text(20, 236, "Запросы — с одинаковым числом столбцов; строки сравниваются целиком; UNION ALL — как UNION, но с повторами.", "s")
    f.save(out(SQ5 / "06-set-operations" / "img" / "set-operations.svg"))


# ---------- SQL 6.01: count и NULL ----------
SQ6 = ROOT / "sql" / "06-aggregation"


def count_null():
    f = Figure(880, 250, "count(*) считает строки, count(city) — непустые значения, count(DISTINCT city) — разные непустые")
    cities = ["Москва", "Москва", "Казань", "NULL", "Казань", "Москва", "NULL", "Краснодар"]
    f.text(20, 22, "users.city (часть строк)", "h")
    for k, c in enumerate(cities):
        f.box(20 + k * 100, 32, 96, 32, c, "box2" if c == "NULL" else "box", "c", rx=4)
    rows = [("count(*)", "8 — все строки"), ("count(city)", "6 — без NULL"), ("count(DISTINCT city)", "3 — Москва, Казань, Краснодар")]
    for k, (fn, res) in enumerate(rows):
        y = 100 + k * 44
        f.box(20, y, 240, 34, fn, "acc", "onacc", rx=6)
        f.arrow(f"M260 {y + 17}H296")
        f.text(304, y + 22, res, "t")
    f.save(out(SQ6 / "01-aggregates" / "img" / "count-null.svg"))


# ---------- SQL 6.02: GROUP BY ----------
def group_by():
    f = Figure(880, 270, "GROUP BY status раскладывает заказы по статусам; count(*) считает строки каждой группы")
    groups = [("cancelled", 5, "m2"), ("new", 3, "m1"), ("paid", 4, "m3"), ("shipped", 22, "acc")]
    f.text(20, 22, "orders", "h")
    order = ["shipped", "shipped", "cancelled", "shipped", "new", "paid", "shipped", "cancelled", "paid", "new"]
    cls = {g: c for g, _, c in groups}
    for k, st in enumerate(order):
        f.box(20, 30 + k * 22, 150, 20, st, cls[st], "cs", rx=3)
    f.text(20, 256, "… ещё 24 заказа", "s")
    f.arrow("M180 140H260")
    for k, (g, n, c) in enumerate(groups):
        y = 30 + k * 52
        f.box(270, y, 220, 44, g, c, "c", rx=8)
        f.arrow(f"M490 {y + 22}H546")
        f.box(550, y, 130, 44, f"count = {n}", "box", "c", rx=8)
    f.text(700, 60, "строка результата", "s")
    f.text(700, 78, "на каждую группу", "s")
    f.save(out(SQ6 / "02-group-by" / "img" / "group-by.svg"))


# ---------- SQL 6.03: WHERE и HAVING ----------
def where_having():
    f = Figure(880, 200, "WHERE отбирает строки до группировки, HAVING — группы после неё")
    steps = [("orders", "34 строки", "box2"), ("WHERE status|<> 'cancelled'", "29 строк", "box"),
             ("GROUP BY user_id", "9 групп", "box"), ("HAVING|count(*) >= 4", "3 группы", "acc")]
    for k, (title, note, c) in enumerate(steps):
        x = 20 + k * 215
        f.box(x, 40, 190, 64, title, c, "onacc" if c == "acc" else "c", rx=10)
        f.text(x + 95, 128, note, "s", "middle")
        if k:
            f.arrow(f"M{x - 25} 72H{x - 4}")
    f.text(20, 170, "Агрегат в WHERE — ошибка: групп ещё нет. Псевдоним из SELECT в HAVING — ошибка: SELECT выполняется позже.", "s")
    f.save(out(SQ6 / "03-having" / "img" / "where-having.svg"))


# ---------- SQL 6.04: count после JOIN ----------
def join_count():
    f = Figure(880, 230, "После JOIN с позициями строка заказа повторяется — count(*) считает позиции, count(DISTINCT o.id) — заказы")
    f.text(20, 22, "orders JOIN order_items (заказ 1)", "h")
    _cells(f, 20, 30, [("o.id", 70), ("o.user_id", 100), ("oi.product_id", 140)],
           [("1", "1", "1"), ("1", "1", "4"), ("1", "1", "7")], {0: "m1", 1: "m1", 2: "m1"})
    f.box(400, 40, 250, 34, "count(*) = 3", "box", "c", rx=6)
    f.box(400, 84, 250, 34, "count(o.id) = 3", "box", "c", rx=6)
    f.box(400, 128, 250, 34, "count(DISTINCT o.id) = 1", "acc", "onacc", rx=6)
    f.arrow("M330 90H394")
    f.text(670, 62, "позиции", "s"); f.text(670, 106, "тоже позиции", "s"); f.text(670, 150, "заказы", "s")
    f.text(20, 210, "Сумма столбца заказа по таким строкам тоже завышена втрое — суммы считают по позициям или до соединения.", "s")
    f.save(out(SQ6 / "04-join-aggregates" / "img" / "join-count.svg"))


# ---------- SQL 6.05: порядок выполнения ----------
def query_order():
    f = Figure(880, 220, "SELECT пишут первым, а выполняется он после WHERE, GROUP BY и HAVING")
    written = ["SELECT", "FROM", "WHERE", "GROUP BY", "HAVING", "ORDER BY", "LIMIT"]
    run = ["FROM", "WHERE", "GROUP BY", "HAVING", "SELECT", "ORDER BY", "LIMIT"]
    f.text(20, 22, "пишем", "h"); f.text(20, 100, "выполняется", "h")
    for k, w in enumerate(written):
        f.box(20 + k * 122, 30, 112, 34, w, "acc" if w == "SELECT" else "box2", "onacc" if w == "SELECT" else "c", rx=6)
    for k, w in enumerate(run):
        f.box(20 + k * 122, 108, 112, 34, f"{k + 1}. {w}", "acc" if w == "SELECT" else "box", "onacc" if w == "SELECT" else "c", rx=6)
        if k:
            f.arrow(f"M{20 + k * 122 - 10} 125H{20 + k * 122 - 1}")
    f.text(20, 176, "Псевдонимы из SELECT видны только справа от него: в ORDER BY (и в GROUP BY как расширение PostgreSQL).", "s")
    f.text(20, 196, "WHERE и HAVING выполняются раньше — псевдонимов там нет.", "s")
    f.save(out(SQ6 / "05-query-order" / "img" / "query-order.svg"))


# ---------- SQL 7: продвинутые запросы ----------
SQ7 = ROOT / "sql" / "07-advanced"


def subquery_kinds():
    f = Figure(880, 250, "Подзапрос возвращает значение, список или таблицу — и стоит там, где это ожидается")
    rows = [("скалярный", "(SELECT avg(price) FROM products)", "16113.55", "WHERE price > …"),
            ("список", "(SELECT user_id FROM orders …)", "1, 3, 12", "WHERE id IN …"),
            ("таблица", "(SELECT user_id, count(*) … ) AS t", "строки и столбцы", "FROM … AS t")]
    for k, (kind, q, res, where) in enumerate(rows):
        y = 20 + k * 72
        f.box(20, y, 120, 52, kind, "acc", "onacc", rx=8)
        f.box(156, y, 330, 52, q, "box", "cs", rx=8)
        f.arrow(f"M486 {y + 26}H516")
        f.box(520, y, 150, 52, res, "box2", "c", rx=8)
        f.text(690, y + 31, where, "cs")
    f.text(20, 240, "Скалярный: ноль строк — NULL, больше одной — ошибка. Список: повторы не размножают строки внешнего запроса.", "s")
    f.save(out(SQ7 / "01-subqueries" / "img" / "subquery-kinds.svg"))


def correlated():
    f = Figure(880, 230, "Коррелированный подзапрос берёт category_id из текущей строки внешнего запроса")
    f.text(20, 22, "products p (внешний запрос)", "h")
    _cells(f, 20, 30, [("name", 230), ("price", 100), ("category_id", 110)],
           [("Механическая клавиатура", "5490.00", "4"), ("Коврик для мыши", "490.00", "4"), ("Книга «Python с нуля»", "1890.00", "9")],
           {0: "m1", 1: "m1", 2: "m2"})
    f.box(520, 40, 340, 44, "avg по category_id = 4 → 2259.67", "m1", "cs", rx=8)
    f.box(520, 100, 340, 44, "avg по category_id = 9 → 1790.00", "m2", "cs", rx=8)
    f.arrow("M460 75H516"); f.arrow("M460 135L516 122")
    f.text(20, 190, "WHERE p2.category_id = p.category_id — связь с внешней строкой.", "s")
    f.text(20, 210, "Без неё подзапрос один для всех строк: средняя по всему каталогу.", "s")
    f.save(out(SQ7 / "02-exists" / "img" / "correlated.svg"))


def cte_steps():
    f = Figure(880, 200, "CTE — именованный шаг: его результат основной запрос использует как таблицу, даже дважды")
    f.box(20, 40, 300, 90, "WITH user_totals AS (|сумма покупок|каждого покупателя)", "acc", "onacc", rx=10)
    f.box(380, 20, 480, 60, "SELECT user_id, total FROM user_totals", "box", "cs", rx=10)
    f.box(380, 100, 480, 60, "WHERE total > (SELECT avg(total) FROM user_totals)", "box", "cs", rx=10)
    f.arrow("M320 70L376 50"); f.arrow("M320 100L376 130")
    f.text(20, 186, "Шаги читаются сверху вниз; CTE живёт до конца запроса (до точки с запятой).", "s")
    f.save(out(SQ7 / "03-cte" / "img" / "cte-steps.svg"))


def recursive_steps():
    f = Figure(880, 240, "Рекурсивный CTE: каждый шаг находит детей строк, найденных на прошлом шаге")
    steps = [("старт", ["Электроника"]), ("шаг 1", ["Компьютеры", "Смартфоны"]),
             ("шаг 2", ["Ноутбуки", "Аксессуары"]), ("шаг 3", ["— пусто, стоп"])]
    for k, (title, items) in enumerate(steps):
        x = 20 + k * 215
        f.text(x, 24, title, "h")
        for j, it in enumerate(items):
            last = it.startswith("—")
            f.box(x, 34 + j * 50, 190, 40, it, "box2" if last else ("acc" if k == 0 else "box"),
                  "t" if last else ("onacc" if k == 0 else "c"), rx=8)
        if k:
            f.arrow(f"M{x - 25} 54H{x - 4}")
    f.text(20, 190, "Стартовая часть — до UNION ALL; рекурсивная — после, с JOIN tree t ON c.parent_id = t.id.", "s")
    f.text(20, 210, "Результат — строки всех шагов: 5 категорий поддерева.", "s")
    f.save(out(SQ7 / "04-recursive-cte" / "img" / "recursive-steps.svg"))


def ranking():
    f = Figure(880, 250, "row_number, rank и dense_rank по-разному нумеруют одинаковые значения")
    _cells(f, 20, 20, [("price", 110), ("row_number", 130), ("rank", 100), ("dense_rank", 130)],
           [("5490.00", "1", "1", "1"), ("3990.00", "2", "2", "2"), ("1890.00", "3", "3", "3"),
            ("1890.00", "4", "3", "3"), ("1590.00", "5", "5", "4")], {2: "m1", 3: "m1", 4: "m2"})
    f.text(520, 60, "row_number — у каждой строки свой номер;", "s")
    f.text(520, 80, "порядок равных — произвольный", "s")
    f.text(520, 120, "rank — равные делят место,", "s")
    f.text(520, 140, "следующее пропускается (нет 4)", "s")
    f.text(520, 180, "dense_rank — равные делят место,", "s")
    f.text(520, 200, "без пропусков", "s")
    f.save(out(SQ7 / "05-window-ranking" / "img" / "ranking.svg"))


def lag_running():
    f = Figure(880, 250, "lag берёт значение из предыдущей строки окна, sum с ORDER BY копит итог от начала окна")
    _cells(f, 20, 20, [("month", 120), ("revenue", 120), ("lag", 120), ("running", 120)],
           [("2025-11", "113520", "NULL", "113520"), ("2025-12", "41770", "113520", "155290"),
            ("2026-01", "126798", "41770", "282088"), ("2026-02", "81009", "126798", "363097")],
           {0: "m1", 1: "m1"})
    f.text(20, 190, "Выручка ноября (113520) в строке декабря стала lag — значением прошлой строки.", "s")
    f.text(520, 50, "lag(revenue) OVER (ORDER BY month):", "cs")
    f.text(520, 70, "значение прошлой строки; у первой — NULL", "s")
    f.text(520, 110, "sum(revenue) OVER (ORDER BY month):", "cs")
    f.text(520, 130, "сумма от первой строки до текущей", "s")
    f.text(520, 170, "PARTITION BY — своё окно на группу:", "s")
    f.text(520, 190, "соседи только внутри неё", "s")
    f.save(out(SQ7 / "06-window-offset" / "img" / "lag-running.svg"))


def jsonb_operators():
    f = Figure(880, 200, "-> возвращает значение как jsonb, ->> — как текст")
    f.box(20, 60, 300, 50, '{"color": "black", "size": "L"}', "box2", "cs", rx=8)
    f.arrow("M320 75L420 45"); f.arrow("M320 95L420 125")
    f.box(424, 20, 200, 44, "-> 'color'", "box", "cs", rx=8)
    f.box(424, 104, 200, 44, "->> 'color'", "box", "cs", rx=8)
    f.arrow("M624 42H660"); f.arrow("M624 126H660")
    f.box(664, 20, 196, 44, '"black"  (jsonb)', "box2", "cs", rx=8)
    f.box(664, 104, 196, 44, "black  (text)", "acc", "onacc", rx=8)
    f.text(20, 186, "Сравнение со строкой и приведение к числу — через ->>. Нет ключа — NULL без ошибки.", "s")
    f.save(out(SQ7 / "07-jsonb" / "img" / "jsonb-operators.svg"))


def view_kinds():
    f = Figure(880, 230, "VIEW выполняет свой запрос при каждом чтении, MATERIALIZED VIEW читает сохранённый результат")
    f.text(20, 24, "VIEW", "h")
    f.box(20, 34, 180, 50, "SELECT … FROM view", "box", "cs", rx=8)
    f.arrow("M200 59H246")
    f.box(250, 34, 200, 50, "текст запроса", "box2", "c", rx=8)
    f.arrow("M450 59H496")
    f.box(500, 34, 200, 50, "таблицы — сейчас", "acc", "onacc", rx=8)
    f.text(20, 134, "MATERIALIZED VIEW", "h")
    f.box(20, 144, 180, 50, "SELECT … FROM mv", "box", "cs", rx=8)
    f.arrow("M200 169H246")
    f.box(250, 144, 200, 50, "сохранённый результат", "box2", "c", rx=8)
    f.box(500, 144, 200, 50, "таблицы", "box", "c", rx=8)
    f.arrow("M500 169H454", "lnd")
    f.text(720, 165, "REFRESH", "cs")
    f.text(720, 183, "пересчитывает", "s")
    f.save(out(SQ7 / "08-views" / "img" / "view-kinds.svg"))


# ---------- SQL 8: проектирование ----------
SQ8 = ROOT / "sql" / "08-design"


def flat_to_tables():
    f = Figure(880, 300, "Плоская таблица повторяет покупателя и склеивает товары; после нормализации каждый факт хранится один раз")
    f.text(20, 22, "orders_flat", "h")
    _cells(f, 20, 30, [("order_id", 80), ("customer", 150), ("products", 250)],
           [("1", "Анна Смирнова", "Ноутбук, Мышь, Коврик"), ("6", "Анна Смирнова", "Книга, Книга"),
            ("8", "Егор Лебедев", "Веб-камера, Мышь, Мышь")], {0: "m1", 1: "m1", 2: "m2"})
    f.text(20, 180, "Покупатель повторяется в каждом заказе, товары — текстом через запятую.", "s")
    f.arrow("M520 90H560")
    for k, (name, cols) in enumerate((("users", "id, name, email"), ("orders", "id, user_id → users"),
                                      ("order_items", "order_id, product_id, quantity"))):
        y = 30 + k * 70
        f.box(570, y, 290, 56, f"{name}|{cols}", "acc" if name == "order_items" else "box2",
              "onacc" if name == "order_items" else "cs", rx=8)
    f.text(20, 260, "Имя меняется в одном месте, покупатель существует без заказов, количество и ссылка на товар — у позиции.", "s")
    f.save(out(SQ8 / "01-first-nf" / "img" / "flat-to-tables.svg"))


def dependencies():
    f = Figure(880, 260, "2НФ: столбец зависит от всего ключа; 3НФ: неключевые столбцы не зависят друг от друга")
    f.text(20, 22, "order_items_wide — ключ (order_id, product_id)", "h")
    for k, (c, cls) in enumerate((("order_id", "acc"), ("product_id", "acc"), ("product_name", "err"), ("quantity", "box"))):
        f.box(20 + k * 140, 32, 130, 40, c, cls, "onacc" if cls == "acc" else ("errt" if cls == "err" else "c"), rx=6)
    f.arrow("M230 72Q260 100 330 76", "lnd")
    f.text(590, 50, "product_name — только от product_id:", "s")
    f.text(590, 68, "частичная зависимость (2НФ)", "s")
    f.text(20, 142, "customers — ключ id", "h")
    for k, (c, cls) in enumerate((("id", "acc"), ("name", "box"), ("city", "box"), ("region", "err"))):
        f.box(20 + k * 140, 152, 130, 40, c, cls, "onacc" if cls == "acc" else ("errt" if cls == "err" else "c"), rx=6)
    f.arrow("M370 192Q400 220 470 196", "lnd")
    f.text(590, 170, "region — от city, а не от id:", "s")
    f.text(590, 188, "транзитивная зависимость (3НФ)", "s")
    f.text(20, 246, "Исправление: product_name — в products, region — в справочник cities.", "s")
    f.save(out(SQ8 / "02-second-third-nf" / "img" / "dependencies.svg"))


def denormalization():
    f = Figure(880, 240, "orders.total — копия суммы позиций: читается без JOIN, но обновляется вместе с позициями")
    f.box(20, 30, 260, 70, "order_items|quantity × price", "box2", "c", rx=10)
    f.arrow("M280 65H356")
    f.text(290, 54, "sum", "cs")
    f.box(360, 30, 220, 70, "orders.total|копия", "acc", "onacc", rx=10)
    f.box(620, 30, 240, 70, "изменили позицию —|обновить total", "err", "errt", rx=10)
    f.arrow("M580 65H616")
    f.box(20, 140, 260, 60, "order_items.price", "box", "c", rx=10)
    f.box(360, 140, 500, 60, "цена на момент покупки — факт, не копия;|с products.price не синхронизируют", "ok", "t", rx=10)
    f.arrow("M280 170H356")
    f.save(out(SQ8 / "03-denormalization" / "img" / "denormalization.svg"))


def reviews_design():
    f = Figure(880, 320, "Фото — 1:N к отзыву, лайки — связка покупатель ↔ отзыв с ключом из пары")

    def tab(key, x, y, cols, acc=False, w=250):
        f.box(x, y, w, 30 + 22 * len(cols), "", "box")
        f.raw(f'<rect x="{x}" y="{y}" width="{w}" height="30" rx="12" class="fig-{"acc" if acc else "box2"}"/>')
        f.text(x + 12, y + 20, key, "onacc" if acc else "c")
        for k, c in enumerate(cols):
            f.text(x + 12, y + 48 + k * 22, c, "cs")

    tab("users", 20, 20, ["id"], w=160)
    tab("reviews", 20, 140, ["id", "product_id", "rating, text"], w=160)
    tab("review_likes", 300, 20, ["user_id → users", "review_id → reviews", "created_at", "PK (user_id, review_id)"], True)
    tab("review_photos", 300, 150, ["id", "review_id → reviews", "url", "position 1–5", "UNIQUE (review_id, position)"], True, w=300)
    f.arrow("M300 70H180"); f.arrow("M300 92H240V170H180"); f.arrow("M300 210H180")
    f.text(640, 60, "лайк — один раз:", "s"); f.text(640, 78, "ключ из пары", "s")
    f.text(640, 190, "до пяти фото:", "s"); f.text(640, 208, "CHECK + UNIQUE", "s")
    f.text(640, 250, "удалили отзыв — CASCADE", "s")
    f.save(out(SQ8 / "04-design-from-scratch" / "img" / "reviews-design.svg"))


# ---------- SQL 9: производительность и транзакции ----------
SQ9 = ROOT / "sql" / "09-performance"


def btree():
    f = Figure(880, 280, "Без индекса база читает все строки; B-tree приводит к нужным строкам за несколько шагов")
    f.text(20, 22, "Seq Scan", "h")
    for k in range(10):
        f.box(20 + k * 38, 32, 34, 34, "", "m1" if k == 6 else "box2", rx=3)
    f.text(20, 90, "200 000 строк — каждая проверяется условием", "s")
    f.text(460, 22, "B-tree по user_id", "h")
    f.box(600, 34, 140, 36, "1 … 2500 … 5000", "box2", "cs", rx=6)
    f.box(470, 110, 140, 36, "1 … 40 … 1250", "box2", "cs", rx=6)
    f.box(730, 110, 140, 36, "2500 … 5000", "box", "cs", rx=6)
    f.box(470, 186, 140, 36, "41, 42, 43", "acc", "onacc", rx=6)
    f.arrow("M640 70L560 106"); f.arrow("M700 70L780 106"); f.arrow("M540 146V182")
    f.arrow("M610 204H690", "lnd")
    f.box(694, 186, 176, 36, "40 строк таблицы", "m1", "c", rx=6)
    f.text(20, 260, "Корень → страница диапазона → лист со значением 42 и адресами строк. Шагов — единицы даже для миллионов строк.", "s")
    f.save(out(SQ9 / "01-indexes" / "img" / "btree.svg"))


def composite():
    f = Figure(880, 280, "Индекс (user_id, viewed_at DESC): строки покупателя идут подряд, внутри — новые первыми")
    _cells(f, 20, 20, [("user_id", 110), ("viewed_at", 200)],
           [("41", "2026-05-10 …"), ("42", "2026-05-11 09:12"), ("42", "2026-04-02 18:40"), ("42", "2026-03-07 07:05"),
            ("43", "2026-05-11 …"), ("43", "2026-04-29 …")], {1: "m1", 2: "m1", 3: "m1"})
    f.text(380, 60, "WHERE user_id = 42 ORDER BY viewed_at DESC LIMIT 5", "cs")
    f.text(380, 80, "строки 42 подряд и уже отсортированы — без Sort", "s")
    f.text(380, 140, "WHERE viewed_at > '2026-04-01'", "cs")
    f.text(380, 160, "даты разбросаны по всему индексу —", "s")
    f.text(380, 178, "левого префикса (user_id) нет", "s")
    f.save(out(SQ9 / "02-index-kinds" / "img" / "composite.svg"))


def explain_node():
    f = Figure(880, 230, "Строка плана: узел, оценки планировщика и вложенные узлы, которые выполняются раньше")
    f.box(20, 30, 230, 40, "Bitmap Heap Scan", "acc", "onacc", rx=6)
    f.box(258, 30, 160, 40, "on page_views", "box2", "cs", rx=6)
    f.box(426, 30, 200, 40, "cost=4.60..143.84", "box", "cs", rx=6)
    f.box(634, 30, 110, 40, "rows=40", "box", "cs", rx=6)
    f.box(752, 30, 108, 40, "width=24", "box", "cs", rx=6)
    f.text(20, 92, "тип узла", "s"); f.text(258, 92, "таблица", "s"); f.text(426, 92, "оценка: начало..конец, не мс", "s")
    f.text(634, 92, "ожидаемые строки", "s")
    f.box(60, 120, 520, 40, "->  Bitmap Index Scan on page_views_user_id_idx", "box2", "cs", rx=6)
    f.text(600, 145, "вложенный — выполняется первым", "s")
    f.box(100, 170, 300, 36, "Index Cond: (user_id = 42)", "box", "cs", rx=6)
    f.text(420, 193, "поиск по индексу; Filter — проверка каждой строки", "s")
    f.save(out(SQ9 / "03-explain" / "img" / "explain-node.svg"))


def transaction():
    f = Figure(880, 240, "Изменения транзакции фиксируются вместе по COMMIT или отменяются вместе")
    steps = ["BEGIN", "INSERT заказ", "INSERT позиция", "UPDATE остаток"]
    for k, st in enumerate(steps):
        f.box(20 + k * 150, 90, 136, 44, st, "box2" if k == 0 else "box", "cs", rx=8)
        if k:
            f.arrow(f"M{20 + k * 150 - 14} 112H{20 + k * 150 - 2}")
    f.arrow("M606 100L660 60"); f.arrow("M606 124L660 166")
    f.box(664, 34, 196, 50, "COMMIT —|все три в базе", "ok", "t", rx=8)
    f.box(664, 144, 196, 50, "ROLLBACK или ошибка —|ни одного", "err", "errt", rx=8)
    f.text(20, 226, "До COMMIT изменения видит только сама транзакция; после ошибки работает лишь ROLLBACK (или ROLLBACK TO SAVEPOINT).", "s")
    f.save(out(SQ9 / "04-transactions" / "img" / "transaction.svg"))


def mvcc():
    f = Figure(880, 250, "UPDATE создаёт новую версию строки; транзакция видит версии из своего снимка")
    f.text(20, 22, "строка товара 1", "h")
    f.box(20, 32, 240, 44, "версия 1: stock = 5", "box2", "c", rx=8)
    f.box(20, 92, 240, 44, "версия 2: stock = 4", "acc", "onacc", rx=8)
    f.arrow("M140 76V88")
    f.text(20, 154, "версию 2 создал UPDATE транзакции A", "s")
    f.box(520, 32, 340, 44, "B (снимок до COMMIT A) → 5", "m2", "c", rx=8)
    f.box(520, 92, 340, 44, "A и все после COMMIT A → 4", "m1", "c", rx=8)
    f.arrow("M516 54H264", "lnd"); f.arrow("M516 114H264", "lnd")
    f.text(20, 186, "Читатели не ждут писателей: B читает старую версию, пока A не зафиксирована.", "s")
    f.text(20, 206, "Старые версии, которые больше никто не видит, удаляет VACUUM.", "s")
    f.save(out(SQ9 / "05-isolation" / "img" / "mvcc.svg"))


def deadlock():
    f = Figure(880, 250, "Взаимная блокировка: каждая транзакция держит строку, которую ждёт другая")
    f.box(20, 40, 220, 60, "транзакция A", "m1", "c", rx=10)
    f.box(640, 40, 220, 60, "транзакция B", "m2", "c", rx=10)
    f.box(330, 10, 220, 50, "товар 1", "box2", "c", rx=8)
    f.box(330, 130, 220, 50, "товар 2", "box2", "c", rx=8)
    f.line("M240 60L330 35"); f.text(250, 36, "держит", "s")
    f.arrow("M240 85L326 150", "lnd"); f.text(250, 140, "ждёт", "s")
    f.line("M640 85L550 155"); f.text(590, 166, "держит", "s")
    f.arrow("M640 60L554 40", "lnd"); f.text(600, 34, "ждёт", "s")
    f.text(20, 216, "PostgreSQL находит цикл (deadlock_timeout, 1 с) и прерывает одну транзакцию: «deadlock detected».", "s")
    f.text(20, 236, "Защита — блокировать строки в одном порядке (по id) и уметь повторить транзакцию.", "s")
    f.save(out(SQ9 / "06-locks" / "img" / "deadlock.svg"))


# ---------- SQL 10: SQL из приложения ----------
SQ10 = ROOT / "sql" / "10-from-python"


def driver_flow():
    f = Figure(880, 230, "Код вызывает драйвер, драйвер говорит с сервером PostgreSQL по сети")
    f.box(20, 40, 230, 80, "код Python|cur.execute(sql, params)", "box", "cs", rx=10)
    f.arrow("M250 70H316")
    f.box(320, 40, 200, 80, "драйвер psycopg|соединение, курсор", "acc", "onacc", rx=10)
    f.arrow("M520 70H596")
    f.text(470, 30, "SQL + параметры →", "s")
    f.box(600, 40, 260, 80, "сервер PostgreSQL|процесс на соединение", "box2", "c", rx=10)
    f.arrow("M596 104H524")
    f.text(530, 130, "строки", "s")
    f.arrow("M316 104H254")
    f.text(256, 150, "кортежи или словари:", "s")
    f.text(256, 168, "numeric → Decimal, NULL → None", "s")
    f.text(20, 214, "Один интерфейс DB-API у psycopg и sqlite3: connect → cursor → execute → fetchone / fetchall → commit.", "s")
    f.save(out(SQ10 / "01-connect" / "img" / "driver-flow.svg"))


def injection():
    f = Figure(880, 250, "f-строка смешивает ввод с кодом; параметр передаёт его отдельно, как данные")
    f.text(20, 22, "ввод в поиске: ' OR '1'='1", "h")
    f.text(20, 58, "f-строка", "h")
    f.box(20, 66, 840, 44, "", "err", rx=8)
    f.text(36, 94, "WHERE name = '", "c")
    f.raw('<rect x="166" y="74" width="150" height="28" rx="4" class="fig-m2"/>')
    f.text(176, 94, "' OR '1'='1", "c")
    f.text(320, 94, "'  →  условие истинно для всех строк", "c")
    f.text(20, 150, "параметр", "h")
    f.box(20, 158, 400, 44, "WHERE name = %s", "ok", "c", rx=8)
    f.box(450, 158, 410, 44, "значение: \"' OR '1'='1\" — просто строка", "box2", "c", rx=8)
    f.text(20, 236, "Драйвер передаёт текст запроса и значения раздельно, и база не выполняет ввод как SQL.", "s")
    f.save(out(SQ10 / "02-parameters" / "img" / "injection.svg"))


def with_connection():
    f = Figure(880, 230, "with psycopg.connect(...) — одна транзакция: COMMIT при успехе, ROLLBACK при исключении")
    f.box(20, 70, 160, 50, "with connect()", "box2", "cs", rx=8)
    f.arrow("M180 95H216")
    f.box(220, 70, 150, 50, "execute #1", "box", "cs", rx=8)
    f.arrow("M370 95H406")
    f.box(410, 70, 150, 50, "execute #2", "box", "cs", rx=8)
    f.arrow("M560 85L640 50"); f.arrow("M560 105L640 150")
    f.box(644, 24, 216, 50, "без исключения → COMMIT", "ok", "t", rx=8)
    f.box(644, 126, 216, 50, "исключение → ROLLBACK", "err", "errt", rx=8)
    f.text(20, 212, "В обоих случаях соединение закрывается. Без with — conn.commit() вручную, иначе изменения пропадут при close().", "s")
    f.save(out(SQ10 / "03-transactions-code" / "img" / "with-connection.svg"))


# ---------- Терминал и Git: раздел 1 ----------
TG1 = ROOT / "terminal-git" / "01-terminal"


def command_parts():
    f = Figure(880, 200, "Строка терминала: приглашение, команда, флаги и аргумент через пробелы")
    parts = [("shop@server:~/shop$", 200, "box2", "приглашение: кто, где"), ("ls", 70, "acc", "команда"),
             ("-la", 80, "box", "флаги"), ("templates", 140, "box", "аргумент")]
    x = 20
    for text, w, cls, label in parts:
        f.box(x, 40, w, 50, text, cls, "onacc" if cls == "acc" else "c", rx=8)
        f.text(x + w / 2, 116, label, "s", "middle")
        x += w + 16
    f.text(20, 160, "Короткие флаги склеиваются: -la = -l -a. Длинные — с двумя дефисами: --help.", "s")
    f.text(20, 180, "Код выхода после команды: 0 — успех, другое число — ошибка (echo $?).", "s")
    f.save(out(TG1 / "01-commands" / "img" / "command-parts.svg"))


def path_tree():
    f = Figure(880, 300, "Абсолютный путь — от корня /, относительный — от текущей папки")
    nodes = [("/", 20, 20), ("home", 60, 64), ("shop  (~)", 100, 108), ("shop  (проект)", 140, 152),
             ("manage.py", 180, 196), ("orders  ← мы здесь", 180, 230), ("shop", 180, 264)]
    for name, x, y in nodes:
        f.text(x, y, name, "cs")
    f.text(240, 288, "settings.py", "cs")
    f.line("M28 26V60H56"); f.line("M68 70V104H96"); f.line("M108 114V148H136"); f.line("M148 158V260H176")
    f.line("M148 192H176"); f.line("M148 226H176"); f.line("M188 270V284H236")
    f.box(430, 40, 430, 60, "абсолютный путь|/home/shop/shop/shop/settings.py", "box2", "cs", rx=8)
    f.box(430, 120, 430, 60, "относительный из orders|../shop/settings.py", "acc", "onacc", rx=8)
    f.box(430, 200, 430, 60, "через домашнюю папку|~/shop/shop/settings.py", "box", "cs", rx=8)
    f.save(out(TG1 / "02-paths" / "img" / "path-tree.svg"))


def cp_mv():
    f = Figure(880, 240, "cp оставляет исходник, mv переносит или переименовывает — и перезаписывает существующее")
    f.text(20, 24, "cp -r templates backup", "cs")
    f.box(20, 36, 170, 44, "templates/", "box2", "c", rx=8)
    f.arrow("M190 58H246")
    f.box(250, 36, 170, 44, "templates/", "box2", "c", rx=8)
    f.box(250, 88, 170, 44, "backup/", "acc", "onacc", rx=8)
    f.arrow("M190 70L246 104", "lnd")
    f.text(470, 24, "mv draft.md README.md", "cs")
    f.box(470, 36, 170, 44, "draft.md", "box2", "c", rx=8)
    f.box(470, 88, 170, 44, "README.md (старый)", "box", "c", rx=8)
    f.arrow("M640 58H696")
    f.box(700, 36, 160, 44, "README.md", "acc", "onacc", rx=8)
    f.text(470, 160, "draft.md исчез, старый README.md перезаписан без вопросов.", "s")
    f.text(20, 160, "Без -r cp пропустит папку: omitting directory.", "s")
    f.text(20, 220, "Сохранить старый файл: сначала mv README.md README.old.md, потом mv draft.md README.md.", "s")
    f.save(out(TG1 / "03-files" / "img" / "cp-mv.svg"))


def argv():
    f = Figure(880, 210, "Всё, что после имени скрипта, попадает в sys.argv строками")
    words = [("python3", "box2", None), ("export_orders.py", "acc", "[0]"), ("2026-04-15", "box", "[1]"),
             ("--format", "box", "[2]"), ("csv", "box", "[3]")]
    x = 20
    for text, cls, idx in words:
        w = 30 + 11 * len(text)
        f.box(x, 40, w, 46, text, cls, "onacc" if cls == "acc" else "c", rx=8)
        if idx:
            f.text(x + w / 2, 112, f"sys.argv{idx}", "cs", "middle")
        else:
            f.text(x + w / 2, 112, "не входит", "s", "middle")
        x += w + 14
    f.text(20, 160, "sys.argv == ['export_orders.py', '2026-04-15', '--format', 'csv'] — все элементы str.", "s")
    f.text(20, 180, "Код выхода: 0 — дошёл до конца, 1 — исключение, sys.exit(n) — свой.", "s")
    f.save(out(TG1 / "04-run-python" / "img" / "argv.svg"))


def venv():
    f = Figure(880, 240, "После активации python и pip берутся из окружения проекта")
    f.text(20, 24, "до активации", "h")
    f.box(20, 34, 380, 50, "python3, pip → /usr/bin (система)", "box2", "cs", rx=8)
    f.box(20, 94, 380, 50, "pip install → externally-managed-environment", "err", "errt", rx=8)
    f.arrow("M410 90H466")
    f.text(330, 170, "source venv/bin/activate", "cs")
    f.text(480, 24, "(venv) после активации", "h")
    f.box(480, 34, 380, 50, "python, pip → ~/shop/venv/bin", "acc", "onacc", rx=8)
    f.box(480, 94, 380, 50, "пакеты → ~/shop/venv/lib/…/site-packages", "ok", "t", rx=8)
    f.text(20, 200, "Активация действует в одном терминале; deactivate — выключить; без активации — venv/bin/pip.", "s")
    f.text(20, 220, "Папку venv не коммитят и не переносят — её создают заново по requirements.txt.", "s")
    f.save(out(TG1 / "05-venv" / "img" / "venv.svg"))


def requirements():
    f = Figure(880, 220, "requirements.txt переносит точный состав окружения")
    f.box(20, 50, 200, 70, "venv на ноутбуке|Django 5.1.4 …", "box2", "c", rx=10)
    f.arrow("M220 85H286"); f.text(200, 38, "pip freeze >", "cs")
    f.box(290, 50, 220, 70, "requirements.txt|в git", "acc", "onacc", rx=10)
    f.arrow("M510 85H576"); f.text(490, 38, "pip install -r", "cs")
    f.box(580, 50, 280, 70, "новое venv на сервере|те же версии", "box2", "c", rx=10)
    f.text(20, 170, "asgiref==3.8.1   Django==5.1.4   sqlparse==0.5.3 — точные версии, включая зависимости.", "cs")
    f.text(20, 196, "Без -r pip ищет пакет с именем requirements.txt; без версий у каждого окажутся свои.", "s")
    f.save(out(TG1 / "06-pip" / "img" / "requirements.svg"))


# ---------- Терминал и Git: раздел 2 ----------
TG2 = ROOT / "terminal-git" / "02-git"


def _commit(f, x, y, sha, msg, cls="box2", w=200):
    f.box(x, y, w, 56, f"{sha}|{msg}", cls, "onacc" if cls == "acc" else "cs", rx=10)


def commits_chain():
    f = Figure(880, 200, "История — цепочка коммитов: снимок файлов, автор, дата и сообщение; каждый знает предыдущий")
    _commit(f, 20, 50, "5700f91", "Каркас магазина")
    _commit(f, 320, 50, "3243adf", "Каталог: модель товара")
    _commit(f, 620, 50, "34b56d0", "Настройки для прода", "acc", 240)
    f.arrow("M320 78H224"); f.arrow("M620 78H524")
    f.text(620, 132, "HEAD -> main", "cs")
    f.text(20, 170, "Стрелка — ссылка на родителя. Хеш однозначно определяет коммит; хватает первых 7 символов.", "s")
    f.save(out(TG2 / "01-why-vcs" / "img" / "commits-chain.svg"))


def three_areas():
    f = Figure(880, 220, "Коммит делается в два шага: git add кладёт в индекс, git commit сохраняет индекс в историю")
    f.box(20, 40, 240, 90, "рабочая папка|файлы на диске", "box2", "c", rx=12)
    f.box(320, 40, 240, 90, "индекс|следующий коммит", "acc", "onacc", rx=12)
    f.box(620, 40, 240, 90, "репозиторий|коммиты в .git", "box2", "c", rx=12)
    f.arrow("M260 85H316"); f.arrow("M560 85H616")
    f.text(250, 30, "git add", "cs"); f.text(548, 30, "git commit", "cs")
    f.text(20, 160, "untracked / modified", "s"); f.text(320, 160, "staged — Changes to be committed", "s")
    f.text(620, 160, "clean — nothing to commit", "s")
    f.text(20, 200, "git status показывает, что лежит в какой области; в коммит идёт версия файла на момент git add.", "s")
    f.save(out(TG2 / "02-first-commit" / "img" / "three-areas.svg"))


def diff_areas():
    f = Figure(880, 220, "git diff и git diff --staged сравнивают разные пары областей")
    f.box(20, 40, 240, 70, "рабочая папка", "box2", "c", rx=12)
    f.box(320, 40, 240, 70, "индекс", "acc", "onacc", rx=12)
    f.box(620, 40, 240, 70, "последний коммит", "box2", "c", rx=12)
    f.line("M140 120V150H440V120", "lnd"); f.text(160, 170, "git diff — ещё не добавленное", "cs")
    f.line("M440 30V14H740V30", "lnd"); f.text(460, 10, "git diff --staged — войдёт в коммит", "cs")
    f.text(20, 205, "После git add обычный git diff пуст: изменения уже в индексе.", "s")
    f.save(out(TG2 / "03-history-diff" / "img" / "diff-areas.svg"))


def gitignore():
    f = Figure(880, 230, ".gitignore прячет неотслеживаемые файлы; уже закоммиченные убирают git rm --cached")
    f.box(20, 30, 270, 60, ".gitignore|.env  venv/  __pycache__/", "box2", "cs", rx=8)
    for k, (name, cls) in enumerate((("manage.py → в коммит", "ok"), (".env → не видно Git", "box"),
                                     ("venv/ → не видно Git", "box"))):
        f.box(320, 20 + k * 50, 260, 40, name, cls, "t", rx=8)
    f.box(620, 30, 240, 100, ".env уже в коммите:|.gitignore не действует|→ git rm --cached .env", "err", "errt", rx=8)
    f.text(20, 200, "git rm --cached убирает файл из индекса, оставляя на диске; секрет из истории всё равно меняют.", "s")
    f.save(out(TG2 / "04-gitignore" / "img" / "gitignore.svg"))


def branches():
    f = Figure(880, 260, "Ветка — указатель на коммит; при fast-forward git merge просто сдвигает main")
    f.text(20, 24, "до слияния", "h")
    _commit(f, 20, 34, "5be578d", "Каркас", w=150); _commit(f, 200, 34, "a9d5869", ".gitignore", w=150)
    _commit(f, 380, 34, "f675ed6", "О магазине", "acc", 150)
    f.arrow("M200 62H174"); f.arrow("M380 62H354")
    f.text(220, 112, "main", "cs"); f.text(400, 112, "HEAD -> about", "cs")
    f.text(20, 154, "после git switch main; git merge about", "h")
    _commit(f, 20, 164, "5be578d", "Каркас", w=150); _commit(f, 200, 164, "a9d5869", ".gitignore", w=150)
    _commit(f, 380, 164, "f675ed6", "О магазине", "acc", 150)
    f.arrow("M200 192H174"); f.arrow("M380 192H354")
    f.text(400, 242, "HEAD -> main, about", "cs")
    f.text(580, 200, "нового коммита нет —", "s"); f.text(580, 218, "main догнал about", "s")
    f.save(out(TG2 / "05-branches" / "img" / "branches.svg"))


def conflict():
    f = Figure(880, 250, "Обе ветки изменили одну строку после общего коммита — Git просит выбрать вручную")
    _commit(f, 20, 96, "d4153a5", "TIME_ZONE = 'UTC'", w=220)
    _commit(f, 320, 30, "4ca0a0f  main", "TIME_ZONE = 'Europe/Kazan'", w=260)
    _commit(f, 320, 160, "7dc2562  timezone", "TIME_ZONE = 'Europe/Moscow'", w=260)
    f.arrow("M320 58L244 110"); f.arrow("M320 188L244 140")
    f.box(640, 70, 220, 110, "<<<<<<< HEAD|Kazan|=======|Moscow|>>>>>>> timezone", "err", "errt", rx=8)
    f.arrow("M584 120H636")
    f.text(20, 240, "Решение: оставить нужный вариант без маркеров → git add → git commit; отмена — git merge --abort.", "s")
    f.save(out(TG2 / "06-conflict" / "img" / "conflict.svg"))


def push_pull():
    f = Figure(880, 220, "push отправляет коммиты на GitHub, pull забирает новые, clone скачивает репозиторий целиком")
    f.box(20, 50, 280, 90, "локальный репозиторий|~/shop/.git", "box2", "c", rx=12)
    f.box(580, 50, 280, 90, "GitHub (origin)|anna/shop.git", "acc", "onacc", rx=12)
    f.arrow("M300 76H576"); f.text(380, 66, "git push (-u origin main)", "cs")
    f.arrow("M576 114H304"); f.text(400, 134, "git pull / git clone", "cs")
    f.text(20, 186, "Push отклонён (fetch first) — на GitHub есть чужие коммиты: git pull --no-rebase, затем git push.", "s")
    f.text(20, 206, "Доступ — SSH-ключ: публичный .pub на GitHub, приватный остаётся у вас.", "s")
    f.save(out(TG2 / "07-github" / "img" / "push-pull.svg"))


if __name__ == "__main__":
    for build in (traceback_anatomy, names_to_values, string_indices, delivery_elif, while_loop,
                  sets_venn, nested_order, copy_modes, comprehension_anatomy,
                  mutable_default, legb_scopes, recursion_stack, decorator_wrap,
                  try_flow, traceback_stack, for_protocol, generator_flow, lazy_pipeline,
                  dict_lookup, lost_key, objects_and_class,
                  attribute_lookup, inheritance_mro, shop_errors,
                  is_a_has_a, with_flow,
                  pytest_failure, fixture_per_test, mock_gateway,
                  request_flow, project_structure, first_page,
                  route_params, url_reverse, request_response,
                  render_flow, extends_include, filters_flow, static_flow,
                  model_table, null_blank, foreign_key, many_to_many, meta_constraints, model_inheritance,
                  client_server, url_anatomy, dns_lookup, http_message,
                  post_redirect_get, session_cookie, https_visibility,
                  document_tree, semantic_layout, path_resolution, table_anatomy, escaping_flow,
                  form_to_request, validation_layers, csrf_attack,
                  css_specificity, box_model, flex_axes, responsive_grid,
                  card_anatomy, catalog_states, shared_layout,
                  app_dbms, table_keys, shop_schema,
                  select_where, null_compare, limit_offset,
                  insert_defaults, fk_actions, upsert_flow,
                  type_choice, wishlist_fk, drop_order,
                  relation_types, inner_join, left_join, join_chain, self_join, set_operations,
                  count_null, group_by, where_having, join_count, query_order,
                  subquery_kinds, correlated, cte_steps, recursive_steps, ranking, lag_running,
                  jsonb_operators, view_kinds,
                  flat_to_tables, dependencies, denormalization, reviews_design,
                  btree, composite, explain_node, transaction, mvcc, deadlock,
                  driver_flow, injection, with_connection,
                  command_parts, path_tree, cp_mv, argv, venv, requirements,
                  commits_chain, three_areas, diff_areas, gitignore, branches, conflict, push_pull):
        build()
    print("ok")
