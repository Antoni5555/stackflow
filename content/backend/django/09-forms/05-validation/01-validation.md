---
title: Валидация
type: lesson
level: 2
reading_time: 12
---

## Теория
Встроенные проверки полей (обязательность, формат почты, длина) не знают правил магазина: промокод должен существовать и не быть просроченным, без самовывоза нужен адрес. Свои правила пишут в форме двумя способами.

**`clean_<поле>(self)`** — проверка одного поля. Вызывается после встроенных проверок этого поля, значение — в `self.cleaned_data["поле"]`. Метод либо бросает **`forms.ValidationError("текст")`** — ошибка встанет у поля, — либо **возвращает** значение, которое и попадёт в `cleaned_data`. Значит, здесь же можно его нормализовать: `strip().upper()` для промокода. Забыли `return` — в `cleaned_data` окажется `None`.

**`clean(self)`** — проверка, где участвуют несколько полей. Вызывается после всех `clean_<поле>`; сначала `cleaned = super().clean()`. Поля, которые не прошли свои проверки, в `cleaned` **отсутствуют** — берут через `.get()`. `ValidationError` из `clean()` — ошибка формы в целом (`form.non_field_errors()`, ключ `__all__`); привязать её к полю — `self.add_error("поле", "текст")`.

Порядок внутри `is_valid()`: для каждого поля — приведение типа, встроенные проверки и валидаторы, затем `clean_<поле>`; после всех полей — `clean()`. Обращаться к **другому** полю в `clean_<поле>` нельзя: оно могло ещё не обработаться.

**Валидаторы модели** (`validators=[…]`, `unique`, `choices`) и метод модели `clean()` работают в ModelForm и в админке. Но **`save()` их не вызывает**: `Review(rating=9).save()` запишет 9. Проверить объект вручную — `obj.full_clean()`.

## Наглядно
**Рисунок 1.** Порядок проверок в `is_valid()`.

![Рисунок 1. Для каждого поля: приведение к типу → встроенные проверки и валидаторы → clean_поле(); после всех полей — clean() формы; ошибки полей — в form.errors[поле], ошибки clean() — в non_field_errors](img/validation-order.svg)

**Таблица 1.** Где писать проверку.

| Правило | Где | Ошибка |
|---|---|---|
| значение одного поля (промокод есть и действует) | `clean_code()` | у поля |
| несколько полей (адрес или самовывоз) | `clean()` | у формы (`__all__`) или `add_error` |
| правило данных, верное везде (оценка 1–5) | `validators` поля модели | у поля, во всех ModelForm и админке |
| объект целиком в коде | `obj.full_clean()` | `ValidationError` со словарём |

## На практике
Задача: поле «Промокод» в корзине и выбор доставки «адрес или самовывоз». Промокоды в базе: `SALE10` — действует, `OLD5` — истёк 31 января 2026.

### Шаг 1. Проверка одного поля
Файл `forms.py`:
```python
from django import forms
from django.utils import timezone

from .models import Promo


class PromoForm(forms.Form):
    code = forms.CharField(label="Промокод", max_length=20)

    def clean_code(self):
        code = self.cleaned_data["code"].strip().upper()
        promo = Promo.objects.filter(code=code).first()
        if promo is None:
            raise forms.ValidationError("Такого промокода нет.")
        if promo.valid_until < timezone.localdate():
            raise forms.ValidationError("Срок действия промокода истёк.")
        return code
```
Файл `orm.py`:
```python
from shop.forms import PromoForm
for code in [" sale10 ", "OLD5", "FREE"]:
    f = PromoForm({"code": code})
    print(f.is_valid(), f.cleaned_data.get("code"), f.errors.get("code"))
```
Результат:
```
True SALE10 None
False None <ul class="errorlist" id="id_code_error"><li>Срок действия промокода истёк.</li></ul>
False None <ul class="errorlist" id="id_code_error"><li>Такого промокода нет.</li></ul>
```
Ввод « sale10 » стал `SALE10` — то, что вернул `clean_code`. Дату сравниваем с `timezone.localdate()` — сегодняшней датой в часовом поясе проекта.

Без `return code` в конце метода:
```
True {'code': None}
```
Форма «верная», а промокода нет.

### Шаг 2. Проверка нескольких полей
Файл `forms.py` (фрагмент):
```python
class DeliveryForm(forms.Form):
    pickup = forms.BooleanField(label="Самовывоз", required=False)
    address = forms.CharField(label="Адрес", required=False)

    def clean(self):
        cleaned = super().clean()
        if not cleaned.get("pickup") and not cleaned.get("address"):
            raise forms.ValidationError("Укажите адрес или выберите самовывоз.")
        return cleaned
```
Файл `orm.py`:
```python
from shop.forms import DeliveryForm
f = DeliveryForm({})
print(f.is_valid(), f.non_field_errors())
print(f.errors.as_data())
f = DeliveryForm({"pickup": "on"})
print(f.is_valid(), f.cleaned_data)
```
Результат:
```
False <ul class="errorlist nonfield"><li>Укажите адрес или выберите самовывоз.</li></ul>
{'__all__': [ValidationError(['Укажите адрес или выберите самовывоз.'])]}
True {'pickup': True, 'address': ''}
```
В шаблоне общие ошибки выводят `{{ form.non_field_errors }}` (в `{{ form.as_p }}` они уже есть — над полями). С `self.add_error("address", "Укажите адрес или выберите самовывоз.")` вместо `raise` ошибка встанет у поля адреса: `{'address': [ValidationError([…])]}`.

### Шаг 3. Валидаторы модели и save()
Валидаторы оценки — в модели (`MinValueValidator(1)`, `MaxValueValidator(5)`, как в теме `ModelForm`):

Файл `orm.py`:
```python
r = Review(product=Product.objects.first(), author="Борис", rating=9)
r.save()
print(r.pk, r.rating)
r.full_clean()
```
Результат:
```
2 9
```
и затем:
```
django.core.exceptions.ValidationError: {'rating': ['Убедитесь, что это значение меньше либо равно 5.']}
```
`save()` записал оценку 9 — валидаторы работают только в формах и `full_clean()`. Жёсткое правило данных дополнительно закрепляют ограничением в базе (`CheckConstraint`, раздел «Модели»).

## Частые ошибки
- **Нет `return` в `clean_<поле>`.** В `cleaned_data` — `None`, форма при этом «верная». Метод всегда возвращает значение.
- **Другое поле в `clean_<поле>`.** `self.cleaned_data["address"]` в `clean_pickup` — `KeyError: 'address'`: поле ещё не обработано. Связь полей — в `clean()`.
- **`cleaned["поле"]` в `clean()`.** Если поле не прошло свою проверку, ключа нет — `KeyError`. Берите `cleaned.get("поле")`.
- **Забыть `super().clean()`.** У ModelForm это ещё и проверка уникальности и `clean()` модели.
- **Ждать проверки от `save()`.** `save()` валидаторы не вызывает; в коде без формы — `full_clean()` перед `save()`.
- **`date.today()` вместо `timezone.localdate()`.** На сервере в UTC около полуночи даты разойдутся с московскими.

## Итог
**В форме**
- `clean_<поле>()` — одно поле: `ValidationError` или `return` значения (можно нормализовать).
- `clean()` — несколько полей: `super().clean()`, `.get()`, ошибка формы или `add_error`.

**В модели**
- `validators`, `unique`, `clean()` — в ModelForm и админке; `save()` их не вызывает, `full_clean()` — вызывает.

## Вопросы на собеседовании
<details><summary>В каком порядке Django валидирует форму?</summary>

Для каждого поля по порядку объявления: `to_python` (приведение типа), `validate` (обязательность и встроенные правила), `run_validators`, затем метод формы `clean_<поле>()`. После всех полей — `clean()` формы. У ModelForm потом `_post_clean`: заполнение `instance`, `instance.full_clean()` (валидаторы и `clean()` модели) и `validate_unique()`.
</details>

<details><summary>Чем `clean_<поле>()` отличается от `clean()`?</summary>

`clean_<поле>()` проверяет одно поле и возвращает его итоговое значение; ошибка — у поля. `clean()` вызывается после всех полей, видит всё `cleaned_data` и нужен для правил, связывающих поля; ошибка — общая (`non_field_errors`) или через `add_error` к конкретному полю.
</details>

<details><summary>Вызывает ли `Model.save()` валидацию?</summary>

Нет. Валидаторы полей, `unique` и `Model.clean()` запускает `full_clean()`, который вызывают ModelForm и админка. Код, создающий объекты напрямую, должен вызвать `full_clean()` сам; жёсткие правила лучше дублировать ограничениями в базе (`UniqueConstraint`, `CheckConstraint`).
</details>

## Глубже
Файлы в формах — следующая тема. Готовые валидаторы (`RegexValidator`, `FileExtensionValidator`) — `django.core.validators`.
