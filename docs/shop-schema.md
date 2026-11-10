# Учебная БД «магазин»

> Утверждено 2026-10-20 (перенесено из `docs/drafts/`). DDL — `content/backend/_shared/schema.sql`, проверен на PostgreSQL 16.

Единая предметная область для всего направления Backend. В SQL — эти таблицы, в Django — модели с теми же полями, в Python — словари и классы с теми же ключами (`{"id": 1, "name": "Беспроводная мышь", "price": Decimal("1499.00"), "stock": 12}`).
Если для задачи не хватает поля, сначала меняем схему здесь и в `schema.sql`, потом пишем задачу.

## Таблицы
**Таблица 1.** Все таблицы магазина: поля, ключи и ограничения.

| Таблица | Поля | Ограничения и смысл |
|---|---|---|
| `users` | `id`, `email`, `name`, `city` NULL, `is_active`, `created_at` | `email` UNIQUE |
| `profiles` | `user_id` PK/FK, `phone` NULL, `birth_date` NULL | **1:1** с `users`, удаляется вместе с пользователем |
| `categories` | `id`, `name`, `parent_id` NULL → `categories` | **дерево** (самосвязь); корневые категории — `parent_id IS NULL` |
| `products` | `id`, `category_id` → `categories`, `name`, `price numeric(10,2)`, `stock`, `attributes jsonb`, `created_at` | `price >= 0`, `stock >= 0`; `attributes` — цвет, размер и т. п. |
| `tags` | `id`, `name` | `name` UNIQUE |
| `product_tags` | `product_id`, `tag_id` | **N:M без доп. полей**; PK из двух полей |
| `promo_codes` | `id`, `code`, `discount_percent`, `valid_until`, `is_active` | `code` UNIQUE, скидка 1–90 % |
| `orders` | `id`, `user_id` → `users`, `promo_code_id` NULL → `promo_codes`, `status`, `created_at` | `status`: `new` / `paid` / `shipped` / `cancelled` |
| `order_items` | `id`, `order_id` → `orders`, `product_id` → `products`, `quantity`, `price` | **N:M с доп. полями**; `price` — цена на момент покупки, может отличаться от `products.price`; UNIQUE (`order_id`, `product_id`) |
| `reviews` | `id`, `user_id` → `users`, `product_id` → `products`, `rating` 1–5, `text` NULL, `created_at` | один отзыв на товар от пользователя: UNIQUE (`user_id`, `product_id`) |

## Связи
**Таблица 2.** Какие виды связей есть в схеме и на каких темах они используются.

| Связь | Где | Для каких тем |
|---|---|---|
| 1:1 | `users` — `profiles` | OneToOne, LEFT JOIN «профиль может отсутствовать» |
| 1:N | `users` — `orders`, `categories` — `products`, `users` — `reviews` | FK, JOIN, агрегация по группам |
| N:M без доп. полей | `products` — `tags` через `product_tags` | ManyToMany |
| N:M с доп. полями | `orders` — `products` через `order_items` | ManyToMany `through`, денормализация цены |
| Самосвязь | `categories.parent_id` | self-join, рекурсивный CTE, рекурсия в Python |
| Необязательная FK | `orders.promo_code_id` | LEFT JOIN, `ON DELETE SET NULL` |

`ON DELETE`: удаление пользователя каскадно удаляет профиль и отзывы, но запрещено, если есть заказы (`RESTRICT`); удаление заказа удаляет его позиции; удаление промокода оставляет заказы, обнуляя ссылку.

## Учебные данные
Файл — `content/backend/_shared/seed.sql` (выполняется после `schema.sql`, проверен на PostgreSQL 16). Даты фиксированы: ноябрь 2025 — апрель 2026, часовой пояс — `Europe/Moscow`. id заданы явно — на строки можно ссылаться в уроках; какие строки за какой случай отвечают — в комментариях файла.

Заложено:
- пользователи без заказов, без профиля, без города (`city IS NULL`), неактивные;
- товары без отзывов, без тегов, с нулевым остатком;
- категории без товаров; дерево категорий в 2–3 уровня;
- отменённые заказы; заказы с промокодом и без; позиция, где `order_items.price` ≠ `products.price`;
- отзывы без текста; одинаковые цены (для `RANK` и `DENSE_RANK`);
- заказы на границах месяцев (для работы с датами); просроченный и неактивный промокоды.

Объём: 13 пользователей, 9 категорий, 22 товара, 6 тегов, 5 промокодов, 34 заказа, 58 позиций, 21 отзыв — результат любого запроса помещается на экран.

## Таблицы для DDL-задач
Задачи на `CREATE`/`ALTER`/`DROP` не трогают основную схему: они работают с отдельными таблицами (например, `import_products`, `wishlist`), чтобы остальные задачи не ломались.
