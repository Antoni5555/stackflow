# Курс: FastAPI — шаг 67 (этап 2, отложен)

> Курс FastAPI появится во втором этапе. Программа FastAPI пока не написана. Ниже — готовый блок **SQLAlchemy 2.0**: он станет ORM-частью этого курса, по аналогии с тем, как ORM вплетён в курс Django.

**Контекст:** магазину нужен отдельный API-сервис (например, для мобильного приложения или партнёров) на FastAPI. Он работает с той же БД через SQLAlchemy.
**Тренажёр:** Pyodide + SQLAlchemy + SQLite; показ сгенерированного SQL.
**Источники:** `КОНСПЕКТЫ/ТЕОРИЯ/FastAPI/` (проверить). По SQLAlchemy конспектов нет — пишем по документации 2.0 (только стиль `select()`).

Формат — [docs/content-format.md](../../docs/content-format.md), легенда — [00-overview.md](00-overview.md).

## 1. Введение ●○○
| # | Тема | Что разбираем | Задача из магазина | Сырьё |
|---|---|---|---|---|
| 01 | Что такое SQLAlchemy | Core vs ORM, сравнение с Django ORM (таблица) | зачем сервису отчётов SQLAlchemy | ❌ |
| 02 | Engine и первый запрос | `create_engine`, `connect`, `text()`, параметры | посчитать заказы «сырым» SQL | ❌ |
| 03 | Session | `Session`, `with Session(engine) as session`, `sessionmaker` | открыть сессию сервиса | ❌ |

## 2. Модели ●○○
| # | Тема | Что разбираем | Задача из магазина | Сырьё |
|---|---|---|---|---|
| 01 | Декларативные модели | `DeclarativeBase`, `Mapped[...]`, `mapped_column()` | модель `Product` | ❌ |
| 02 | Типы и ограничения | `Numeric`, `String`, `nullable` через `Mapped[X | None]`, `unique`, `server_default`, `CheckConstraint` | модель `PromoCode` | ❌ |
| 03 | Связь 1:N | `ForeignKey`, `relationship`, `back_populates` | `User.orders` ↔ `Order.user` | ❌ |
| 04 | Связи N:M и 1:1 | таблица-связка (`secondary`), association object, `uselist=False` | теги; `OrderItem` с ценой; `Profile` | ❌ |
| 05 | Создание схемы | `metadata.create_all()`, почему в проде так не делают | создать таблицы сервиса отчётов | ❌ |
| 06 | Миграции Alembic | `alembic init`, `revision --autogenerate`, `upgrade/downgrade` | добавить поле `attributes` миграцией | ❌ (теория + разбор файлов миграций) |

## 3. Изменение данных ●●○
| # | Тема | Что разбираем | Задача из магазина | Сырьё |
|---|---|---|---|---|
| 01 | Добавление | `session.add`, `add_all`, `commit`, `flush`, `refresh` | создать заказ с позициями | ❌ |
| 02 | Изменение и удаление объектов | изменение атрибутов, `delete`, `cascade` | отменить заказ | ❌ |
| 03 | Массовые операции | `insert()`, `update()`, `delete()` конструкциями | поднять цены категории | ❌ |
| 04 | Жизненный цикл объекта | состояния (transient/pending/persistent/detached), identity map, `rollback` | почему объект «устарел» после коммита | ❌ |

## 4. Запросы `select()` ●●○
| # | Тема | Что разбираем | Задача из магазина | Сырьё |
|---|---|---|---|---|
| 01 | select, scalars, execute | разница `scalars()` и `execute()`, строки vs объекты | все активные пользователи | ❌ |
| 02 | Условия | `where`, операторы, `and_`, `or_`, `in_`, `like/ilike`, `is_(None)` | товары от 1000 до 5000 ₽ | ❌ |
| 03 | Сортировка и пагинация | `order_by`, `desc`, `limit/offset`, `distinct` | вторая страница каталога | ❌ |
| 04 | Получение результата | `all`, `first`, `one`, `one_or_none`, `scalar_one`, `session.get` | найти пользователя по email | ❌ |

## 5. Связи и загрузка ●●●
| # | Тема | Что разбираем | Задача из магазина | Сырьё |
|---|---|---|---|---|
| 01 | JOIN | `join`, `outerjoin`, по `relationship` и явное условие | заказы с email покупателя | ❌ |
| 02 | Ленивая загрузка и N+1 | `lazy`, как увидеть N+1 (`echo=True`) | список заказов с пользователями | ❌ |
| 03 | Стратегии загрузки | `selectinload`, `joinedload`, когда что | отчёт «заказы + позиции + товары» | ❌ |

## 6. Агрегация и продвинутое ●●●
| # | Тема | Что разбираем | Задача из магазина | Сырьё |
|---|---|---|---|---|
| 01 | Агрегация | `func.count/sum`, `group_by`, `having`, `label` | выручка по категориям | ❌ |
| 02 | Подзапросы и CTE | `.subquery()`, `.cte()`, `exists()` | товары дороже средней цены | ❌ |
| 03 | Оконные функции | `func.rank().over(partition_by=...)` | топ-3 товара в каждой категории | ❌ |
| 04 | Транзакции | `session.begin()`, `with_for_update`, savepoint `begin_nested` | оформление заказа со списанием остатков | ❌ |
| 05 | Асинхронный SQLAlchemy | `create_async_engine`, `AsyncSession`, `await session.execute` | асинхронный эндпоинт отчёта | ❌ (теория + задачи, если Pyodide позволит) ⚠️ |

## Итог
Блок SQLAlchemy: 6 разделов, 25 тем, всё с нуля. Задачи по возможности те же, что в SQL и Django ORM.
⚠️ «Разработке»: подтвердить SQLAlchemy 2.0 в Pyodide и вариант с async.
