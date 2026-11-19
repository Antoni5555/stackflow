---
title: ModelForm
type: lesson
level: 2
reading_time: 11
---

## Теория
Форма отзыва повторяет поля модели `Review`: имя, оценка, текст. Описывать их второй раз не нужно — **`forms.ModelForm`** строит поля по модели:
```
class ReviewForm(forms.ModelForm):
    class Meta:
        model = Review
        fields = ["author", "rating", "text"]
```
Из модели берутся тип поля (`CharField` → текстовое поле, `IntegerField` → число), `max_length`, обязательность (`blank=True` → `required=False`), подпись (`verbose_name`) и **валидаторы**: `MaxValueValidator(5)` у модели — ошибка формы при оценке 7. Уникальность (`unique=True`) форма тоже проверит — запросом к базе до сохранения.

`fields` — **обязательный** белый список: какие поля пользователь может прислать. `fields = "__all__"` подставит все поля, включая те, что пользователь менять не должен (товар отзыва, цену, автора-пользователя), — так через форму меняют то, чего нет на странице. Без `fields` и `exclude` Django не создаст класс: `ImproperlyConfigured`. Подписи и виджеты меняют в `Meta`: `labels = {…}`, `widgets = {…}`.

Сохранение — **`form.save()`**: создаёт объект из `cleaned_data` и возвращает его. Поля, которых нет в форме (товар отзыва — из адреса страницы), заполняют так:
```
review = form.save(commit=False)   # объект без INSERT
review.product = product
review.save()
```

Редактирование — **`instance=`**: `ReviewForm(instance=review)` рисует поля с текущими значениями, `ReviewForm(request.POST, instance=review)` после `save()` делает `UPDATE` этого объекта, а не `INSERT` нового.

## Наглядно
**Рисунок 1.** ModelForm берёт поля из модели; товар отзыва приходит из адреса и подставляется перед сохранением.

![Рисунок 1. Модель Review: product, author, rating с валидаторами 1–5, text blank=True. ReviewForm с fields author, rating, text: три поля, text необязательное, rating проверяется 1–5. POST /products/aster-14/ → form.save(commit=False) → review.product = product → review.save() → INSERT](img/modelform.svg)

**Таблица 1.** Что ModelForm берёт из модели.

| В модели | В форме |
|---|---|
| `CharField(max_length=100)` | `CharField`, `maxlength="100"` |
| `TextField(blank=True)` | `CharField` + `Textarea`, `required=False` |
| `PositiveSmallIntegerField(validators=[…])` | `IntegerField` + те же валидаторы |
| `ForeignKey(Category)` | `ModelChoiceField` — `<select>` категорий |
| `unique=True` | проверка запросом при `is_valid()` |
| `verbose_name` | подпись (`label`) |

## На практике
Задача: на странице товара — список отзывов и форма «Оставить отзыв»; правка своего отзыва.

### Шаг 1. Модель, форма, view
Валидаторы оценки — в модели, чтобы работали в любой форме и в админке:

Файл `models.py` (фрагмент):
```python
class Review(models.Model):
    product = models.ForeignKey(
        Product, on_delete=models.CASCADE, related_name="reviews"
    )
    author = models.CharField(max_length=100)
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    text = models.TextField(blank=True)
```
Файл `forms.py`:
```python
from django import forms

from .models import Review


class ReviewForm(forms.ModelForm):
    class Meta:
        model = Review
        fields = ["author", "rating", "text"]
```
Файл `views.py`:
```python
from django.shortcuts import get_object_or_404, redirect, render

from .forms import ReviewForm
from .models import Product


def product(request, slug):
    product = get_object_or_404(Product, slug=slug)
    if request.method == "POST":
        form = ReviewForm(request.POST)
        if form.is_valid():
            review = form.save(commit=False)
            review.product = product
            review.save()
            return redirect("product", slug=slug)
    else:
        form = ReviewForm()
    return render(request, "shop/product.html", {"product": product, "form": form})
```
Шаблон выводит `product.reviews.all` списком и форму с `{% csrf_token %}` и `{{ form.as_p }}`.

### Шаг 2. Отправка
POST на `/products/aster-14/`: «Борис», 4, «Тихий и лёгкий» → `302 Found`, `Location: /products/aster-14/`. Страница после редиректа:
```html
<h1>Ноутбук Aster 14</h1>
<ul>
    <li>Борис: 4 — Тихий и лёгкий</li>
</ul>
```
Оценка 7 → `200 OK`, форма с ошибкой из валидатора модели:
```html
  <ul class="errorlist" id="id_rating_error"><li>Убедитесь, что это значение меньше либо равно 5.</li></ul>
```
Подписи полей — `Author:`, `Rating:`, `Text:`: Django взял имена полей, потому что у модели нет `verbose_name`.

### Шаг 3. Подписи и виджет
Файл `forms.py` (фрагмент):
```python
        fields = ["author", "rating", "text"]
        labels = {"author": "Имя", "rating": "Оценка", "text": "Отзыв"}
        widgets = {"text": forms.Textarea(attrs={"rows": 3})}
```
`ReviewForm().as_p()` — фрагмент:
```html
    <label for="id_text">Отзыв:</label>
    <textarea name="text" cols="40" rows="3" id="id_text">
```

### Шаг 4. Редактирование
Файл `orm.py`:
```python
from shop.forms import ReviewForm
r = Review.objects.get(author="Анна")
f = ReviewForm(instance=r)
print(f["rating"].value(), f.initial)
data = {"author": "Анна", "rating": 4, "text": "Удобная, но шумная"}
f = ReviewForm(data, instance=r)
print(f.is_valid(), f.has_changed(), f.changed_data)
f.save()
print(Review.objects.count(), Review.objects.get(pk=r.pk).rating)
```
Результат:
```
5 {'author': 'Анна', 'rating': 5, 'text': 'Удобная'}
True True ['rating', 'text']
1 4
```
С `instance` форма показала текущие значения, а `save()` обновил тот же отзыв — отзывов по-прежнему один.

## Частые ошибки
- **`fields = "__all__"`.** В форму попадает всё, включая поля, которые пользователь менять не должен; добавленное в модель позже поле тоже окажется в форме. Перечисляйте явно.
- **Нет ни `fields`, ни `exclude`.** `ImproperlyConfigured: Creating a ModelForm without either the 'fields' attribute or the 'exclude' attribute is prohibited; form ReviewForm needs updating.`
- **`save()` без обязательного поля, которого нет в форме.** `IntegrityError: NOT NULL constraint failed: shop_review.product_id`. Сначала `save(commit=False)`, заполнить, потом `save()`.
- **Редактирование без `instance`.** `ReviewForm(request.POST).save()` создаёт новый отзыв вместо правки старого.
- **Товар из скрытого поля формы.** `<input type="hidden" name="product">` пользователь подменит в браузере. Связи, которые определяет страница, берут из адреса или `request.user`.
- **Проверки только в форме.** Ограничения в модели (`validators`) работают во всех формах и в админке; проверка, написанная в одной форме, — только в ней.

## Итог
**ModelForm**
- Поля, валидаторы и уникальность — из модели; `fields` — обязательный белый список.
- Подписи и виджеты — `Meta.labels`, `Meta.widgets`.

**Сохранение**
- `form.save()` — `INSERT`; `save(commit=False)` → заполнить остальное → `save()`.
- `instance=obj` — форма редактирования, `save()` делает `UPDATE`.

## Вопросы на собеседовании
<details><summary>Зачем в ModelForm указывать `fields` и чем опасен `"__all__"`?</summary>

`fields` — список полей, которые форма принимает от пользователя. С `"__all__"` в форму попадают все поля модели, и злоумышленник может прислать значения полей, которых нет на странице (mass assignment): чужого автора, цену, флаг модерации. Явный список защищает и от полей, добавленных в модель позже.
</details>

<details><summary>Что делает `form.save(commit=False)`?</summary>

Создаёт объект модели из `cleaned_data`, не сохраняя его в базу. Это позволяет заполнить поля, которых нет в форме (связь с товаром, текущий пользователь), и вызвать `obj.save()` самостоятельно. Связи «многие ко многим» после этого сохраняют `form.save_m2m()`.
</details>

<details><summary>Как ModelForm проверяет уникальность поля?</summary>

В `is_valid()` вызывается `instance.validate_unique()`: запрос к базе, есть ли другая строка с таким значением. Ошибка — у поля («Product с таким Slug уже существует.»). Это не защищает от гонки двух одновременных запросов — окончательно уникальность гарантирует ограничение в базе.
</details>

## Глубже
Свои правила проверки (промокод действует, адрес или самовывоз) — следующая тема «Валидация». Готовые классы для страниц создания и редактирования (`CreateView`, `UpdateView`) — раздел «Class-based views».
