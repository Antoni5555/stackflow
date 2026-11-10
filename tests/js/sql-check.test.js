// Проверка SQL-задач (src/static/js/engines/sql/checker.js): result, state, schema
// на учебной базе магазина — тем же PGlite, что в браузере.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { checkSolution, verifySqlTask } from '../../src/static/js/engines/sql/checker.js';
import { textParsers } from '../../src/static/js/engines/sql/session.js';

const SHARED = new URL('../../content/backend/_shared/', import.meta.url);
const BASE = ['schema.sql', 'seed.sql'].map((name) => readFileSync(new URL(name, SHARED), 'utf8')).join('\n');

const NO_ORDERS = {
  solution: 'SELECT u.id, u.email FROM users u LEFT JOIN orders o ON o.user_id = u.id WHERE o.id IS NULL ORDER BY u.id;',
  check: { type: 'result', order_matters: true },
};

const WISHLIST = {
  setup: 'CREATE TABLE wishlist (user_id integer NOT NULL REFERENCES users (id), product_id integer NOT NULL);',
  solution: `ALTER TABLE wishlist ADD PRIMARY KEY (user_id, product_id);
ALTER TABLE wishlist ADD COLUMN added_at timestamptz NOT NULL DEFAULT now();`,
  check: { type: 'schema', tables: [{ name: 'wishlist', columns: null }] },
};

const CANCEL = {
  solution: "UPDATE orders SET status = 'cancelled' WHERE status = 'new' AND created_at < '2026-03-01';",
  check: { type: 'state', tables: [{ name: 'orders', columns: null }] },
};

const NEW_PRODUCT = {
  solution: "INSERT INTO products (category_id, name, price) VALUES (4, 'Подставка', 990);",
  check: { type: 'state', tables: [{ name: 'products', columns: ['name', 'price', 'stock'] }] },
};

describe('проверка SQL-задач', () => {
  let db;
  let parsers;
  const check = (task, code) => checkSolution(db, parsers, BASE, task, code);

  before(async () => {
    db = new PGlite();
    parsers = await textParsers(db);
  });
  after(() => db.close());

  it('result: эталон проходит, INNER JOIN вместо LEFT — лишних нет, не хватает строк', async () => {
    assert.equal((await check(NO_ORDERS, NO_ORDERS.solution)).ok, true);
    const wrong = await check(NO_ORDERS, 'SELECT u.id, u.email FROM users u JOIN orders o ON o.user_id = u.id WHERE o.id IS NULL;');
    assert.equal(wrong.ok, false);
    assert.match(wrong.message, /^Ожидалось 4 строки, получилось 0; не хватает: 4 строки, например \(9, irina/);
    assert.equal(wrong.panel.kind, 'result');
    assert.equal(wrong.panel.actual.rows.filter((row) => row.mark === 'missing').length, 4);
  });

  it('result: колонки по имени и порядку, порядок строк, ошибка, пустое решение', async () => {
    const swapped = await check(NO_ORDERS, 'SELECT u.email, u.id FROM users u LEFT JOIN orders o ON o.user_id = u.id WHERE o.id IS NULL ORDER BY u.id;');
    assert.match(swapped.message, /^Колонки по порядку: ожидалось id, email — получилось email, id/);
    const order = await check(NO_ORDERS, 'SELECT u.id, u.email FROM users u LEFT JOIN orders o ON o.user_id = u.id WHERE o.id IS NULL ORDER BY u.id DESC;');
    assert.equal(order.message, 'Строки те же, но порядок другой — проверьте ORDER BY.');
    assert.equal((await checkSolution(db, parsers, BASE, { ...NO_ORDERS, check: { type: 'result', order_matters: false } },
      'SELECT u.id, u.email FROM users u LEFT JOIN orders o ON o.user_id = u.id WHERE o.id IS NULL ORDER BY u.id DESC;')).ok, true);
    const error = await check(NO_ORDERS, 'SELECT idd FROM users;');
    assert.equal(error.error.message, 'column "idd" does not exist');
    assert.equal(error.log.length, 1);
    assert.match((await check(NO_ORDERS, 'UPDATE users SET name = name WHERE id = 0;')).message, /ничего не вернул/);
  });

  it('state: таблица после решения; база перед проверкой — заново', async () => {
    assert.equal((await check(CANCEL, CANCEL.solution)).ok, true);
    // повторная проверка того же — снова на свежей базе, не на уже изменённой
    assert.equal((await check(CANCEL, CANCEL.solution)).ok, true);
    const wrong = await check(CANCEL, "UPDATE orders SET status = 'cancelled' WHERE status = 'new';");
    assert.equal(wrong.ok, false);
    assert.match(wrong.message, /^Таблица orders: строка \(.*cancelled.*\) не такая, как нужно — ожидалась \(.*new/);
    assert.equal(wrong.panel.table, 'orders');
    // в панели — только различающиеся строки
    assert.equal(wrong.panel.expected.rows.length, wrong.panel.actual.rows.length);
    assert.ok(wrong.panel.same > 0);
  });

  it('state с колонками: время now() и id не сравниваются', async () => {
    assert.equal((await check(NEW_PRODUCT, NEW_PRODUCT.solution)).ok, true);
    const wrong = await check(NEW_PRODUCT, "INSERT INTO products (category_id, name, price) VALUES (4, 'Подставка', 99);");
    assert.match(wrong.message, /\(Подставка, 99\.00, 0\) не такая, как нужно — ожидалась \(Подставка, 990\.00, 0\)/);
    const missing = await checkSolution(db, parsers, BASE,
      { ...NEW_PRODUCT, check: { type: 'state', tables: [{ name: 'products', columns: ['weight'] }] } }, NEW_PRODUCT.solution);
    assert.match(missing.message, /нет колонки weight/);
  });

  it('schema: колонки и ограничения, данные не важны', async () => {
    assert.equal((await check(WISHLIST, WISHLIST.solution)).ok, true);
    const noPk = await check(WISHLIST, 'ALTER TABLE wishlist ADD COLUMN added_at timestamptz NOT NULL DEFAULT now();');
    assert.equal(noPk.message, 'В таблице wishlist не хватает ограничения: PRIMARY KEY (user_id, product_id).');
    const nullable = await check(WISHLIST, `ALTER TABLE wishlist ADD PRIMARY KEY (user_id, product_id);
      ALTER TABLE wishlist ADD COLUMN added_at timestamptz DEFAULT now();`);
    assert.match(nullable.message, /^wishlist\.added_at: ожидалось timestamptz, NOT NULL, DEFAULT now\(\) — у вас timestamptz, может быть NULL/);
    // имя ограничения своё — не важно
    assert.equal((await check(WISHLIST, `ALTER TABLE wishlist ADD CONSTRAINT wl_pk PRIMARY KEY (user_id, product_id);
      ALTER TABLE wishlist ADD COLUMN added_at timestamptz NOT NULL DEFAULT now();
      INSERT INTO wishlist VALUES (1, 1);`)).ok, true);
  });

  it('тест эталонов: эталон проходит, заготовка — нет', async () => {
    assert.deepEqual(await verifySqlTask(db, parsers, BASE, { ...NO_ORDERS, starter_code: 'SELECT id, email FROM users;' }), []);
    assert.deepEqual(await verifySqlTask(db, parsers, BASE, { ...NO_ORDERS, starter_code: NO_ORDERS.solution }),
      ['заготовка уже проходит проверку — задача решается без изменений']);
    const noop = { solution: "UPDATE orders SET status = 'cancelled' WHERE status = 'new' AND created_at < '2020-01-01';",
      check: CANCEL.check };
    assert.match((await verifySqlTask(db, parsers, BASE, noop))[0], /ничего не делает \(SELECT 1\)/);
    assert.deepEqual(await verifySqlTask(db, parsers, BASE, { ...NO_ORDERS, solution: 'SELECT nope;' }),
      ['эталон падает: column "nope" does not exist']);
  });
});
