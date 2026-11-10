// Движок SQL-тренажёра (src/static/js/engines/sql/): разбор запросов, выполнение,
// снимки таблиц и схема. База — PGlite из npm той же версии, что грузится с CDN
// в браузере, данные — учебный магазин из content/backend/_shared/.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { mentionedColumns, parseJoin } from '../../src/static/js/engines/sql/join.js';
import { mask, splitStatements, statementKind } from '../../src/static/js/engines/sql/split.js';
import { joinColors, mentionedTables, plural } from '../../src/static/js/engines/sql/view.js';
import {
  describeSchema, diffSnapshots, hasTables, resetDatabase, runScript, shortType, snapshotTables, textParsers,
} from '../../src/static/js/engines/sql/session.js';

const SHARED = new URL('../../content/backend/_shared/', import.meta.url);
const BASE = ['schema.sql', 'seed.sql'].map((name) => readFileSync(new URL(name, SHARED), 'utf8')).join('\n');

describe('разбор SQL на запросы', () => {
  it('точка с запятой в строках, именах, $$ и комментариях запрос не заканчивает', () => {
    const text = [
      "SELECT 'a;b', \"x;y\" FROM t; -- конец; не здесь",
      "/* один; /* вложенный; */ ещё; */ SELECT E'\\';'; SELECT 'it''s;';",
      'CREATE FUNCTION f() RETURNS int AS $body$ SELECT 1; $body$ LANGUAGE sql;',
      '',
      'SELECT $$;$$',
    ].join('\n');
    const parts = splitStatements(text);
    assert.deepEqual(parts.map((part) => part.sql), [
      "SELECT 'a;b', \"x;y\" FROM t",
      "SELECT E'\\';'",
      "SELECT 'it''s;'",
      'CREATE FUNCTION f() RETURNS int AS $body$ SELECT 1; $body$ LANGUAGE sql',
      'SELECT $$;$$',
    ]);
    assert.deepEqual(parts.map((part) => part.line), [1, 2, 2, 3, 5]);
    assert.equal(mask(text).length, text.length);
  });

  it('пустые запросы и одни комментарии пропускаются', () => {
    assert.deepEqual(splitStatements(';;  -- только комментарий\n;'), []);
    assert.deepEqual(splitStatements('-- что выбрать\nSELECT 1').map((part) => [part.sql, part.line]), [['SELECT 1', 2]]);
  });

  it('вид запроса', () => {
    const kinds = {
      'select * from users': 'query',
      '  -- комментарий\n  SELECT 1': 'query',
      'WITH t AS (SELECT 1) SELECT * FROM t': 'query',
      'WITH old AS (DELETE FROM orders RETURNING *) SELECT count(*) FROM old': 'query',
      'WITH n AS (SELECT 1) INSERT INTO tags (name) VALUES (\'x\')': 'dml',
      'update products set price = 1': 'dml',
      'SELECT * INTO archive FROM orders': 'ddl',
      "SELECT 'insert into' AS text": 'query',
      'alter table users add column age int': 'ddl',
      'BEGIN': 'tx',
      'rollback': 'tx',
      'SET search_path TO public': 'set',
      'VACUUM': 'other',
    };
    for (const [sql, kind] of Object.entries(kinds)) assert.equal(statementKind(sql), kind, sql);
  });
});

describe('разбор JOIN', () => {
  it('две таблицы, псевдонимы, вид JOIN, условие ON', () => {
    const join = parseJoin(`SELECT p.name, c.name AS category
      FROM products p JOIN categories AS c ON c.id = p.category_id AND c.name <> 'x'
      WHERE p.price > 100 ORDER BY p.price LIMIT 3`);
    assert.equal(join.type, 'INNER JOIN');
    assert.deepEqual([join.left, join.right], [
      { table: 'products', alias: 'p' }, { table: 'categories', alias: 'c' }]);
    assert.equal(join.on, "c.id = p.category_id AND c.name <> 'x'");
    assert.match(join.from, /^FROM products p .* WHERE p\.price > 100$/s);
    assert.match(join.tail, /ORDER BY p\.price LIMIT 3$/);
    assert.equal(join.grouped, false);

    assert.equal(parseJoin('select * from users left outer join orders on orders.user_id = users.id').type, 'LEFT JOIN');
    assert.equal(parseJoin('SELECT c.name, count(*) FROM categories c JOIN products p ON p.category_id = c.id GROUP BY c.name').grouped, true);
    assert.equal(parseJoin('SELECT DISTINCT u.city FROM users u JOIN orders o ON o.user_id = u.id').grouped, true);
  });

  it('без картинки: USING, запятая, три таблицы, подзапрос', () => {
    for (const sql of [
      'SELECT * FROM orders JOIN users USING (id)',
      'SELECT * FROM orders o, users u WHERE o.user_id = u.id',
      'SELECT * FROM a JOIN b ON b.a_id = a.id JOIN c ON c.b_id = b.id',
      'SELECT * FROM (SELECT 1) s JOIN users u ON true',
      'UPDATE users SET name = 1',
    ]) assert.equal(parseJoin(sql), null, sql);
  });

  it('колонки и таблицы из запроса', () => {
    assert.deepEqual(mentionedColumns('SELECT p.name FROM products p WHERE price > 1', ['id', 'name', 'price', 'stock']), ['name', 'price']);
    assert.deepEqual(mentionedTables("SELECT * FROM orders o JOIN users u ON true WHERE 'tags' = ''", ['orders', 'users', 'tags']), ['orders', 'users']);
  });

  it('цвета пар: ключевая сторона — где совпавших строк меньше', () => {
    // три товара: два в категории A, один в B; товар 4 без пары (в результат не попал)
    const view = { pairs: [['p1', 'cA'], ['p2', 'cA'], ['p3', 'cB']] };
    const colors = joinColors(view);
    assert.deepEqual(['p1', 'p2', 'p3', 'p4'].map(colors.left), ['m1', 'm1', 'm2', 'row--unmatched']);
    assert.deepEqual(['cA', 'cB', 'cC'].map(colors.right), ['m1', 'm2', 'row--unmatched']);
    assert.equal(colors.result(['p3', 'cB']), 'm2');
    // LEFT JOIN: пользователь без заказов в результате есть — без цвета, но не серый
    const left = joinColors({ pairs: [['u1', 'o1'], ['u1', 'o2'], ['u2', null]] });
    assert.deepEqual(['u1', 'u2', 'u3'].map(left.left), ['m1', '', 'row--unmatched']);
    assert.equal(left.result(['u2', null]), '');
  });

  it('подписи: число строк и типы колонок', () => {
    assert.deepEqual([1, 2, 5, 11, 21, 22].map((n) => plural(n, 'строка', 'строки', 'строк')),
      ['1 строка', '2 строки', '5 строк', '11 строк', '21 строка', '22 строки']);
    assert.equal(shortType({ type: 'timestamp with time zone', notNull: true }), 'timestamptz');
    assert.equal(shortType({ type: 'integer', notNull: false }), 'int?');
  });
});

describe('выполнение в PGlite', () => {
  let db;
  let parsers;

  before(async () => {
    db = new PGlite();
    parsers = await textParsers(db);
    assert.equal(await hasTables(db), false);
    await resetDatabase(db, BASE);
  });

  after(() => db.close());

  const run = (sql) => runScript(db, parsers, sql);

  it('учебные данные загружены; версия — PostgreSQL 16', async () => {
    assert.equal(await hasTables(db), true);
    const [result] = await run('SELECT version()');
    assert.match(result.rows[0][0], /^PostgreSQL 16\./);
  });

  it('значения — текстом, как выводит PostgreSQL; время — московское', async () => {
    const [result] = await run(`
      SELECT 1499::numeric(10,2) AS price, true AS ok, NULL AS empty, '{"a": 1}'::jsonb AS j,
             ARRAY[1, 2] AS ids, '2026-03-31 23:30+03'::timestamptz AS at,
             date_trunc('month', '2026-03-31 23:30+03'::timestamptz)::date AS month`);
    assert.deepEqual(result.columns, ['price', 'ok', 'empty', 'j', 'ids', 'at', 'month']);
    assert.deepEqual(result.rows, [['1499.00', 't', null, '{"a": 1}', '{1,2}', '2026-03-31 23:30:00+03', '2026-03-01']]);
  });

  it('колонки с одинаковым именем не теряются', async () => {
    const [result] = await run('SELECT 1 AS id, 2 AS id, count(*) FROM users');
    assert.deepEqual(result.columns, ['id', 'id', 'count']);
    assert.deepEqual(result.rows, [['1', '2', '13']]);
  });

  it('ошибка: текст, подсказка, строка и колонка; дальше не выполняется', async () => {
    const results = await run('SELECT 1;\n\nSELECT emial\nFROM users;\nSELECT 2;');
    assert.equal(results.length, 2);
    const { error } = results[1];
    assert.equal(error.message, 'column "emial" does not exist');
    assert.match(error.hint, /users\.email/);
    assert.deepEqual([error.line, error.column], [3, 8]);
  });

  it('UPDATE, INSERT, DELETE — изменённые, новые и удалённые строки', async () => {
    const results = await run(`
      BEGIN;
      UPDATE products SET price = price + 1 WHERE id = 1;
      INSERT INTO tags (name) VALUES ('проверка-метки');
      DELETE FROM product_tags WHERE product_id = 1;
      ROLLBACK;`);
    const [, update, insert, remove, rollback] = results;
    assert.equal(update.affected, 1);
    assert.deepEqual(update.changes.map((change) => [change.table, change.status]), [['products', 'rows']]);
    const changed = update.changes[0].rows.filter((row) => row.mark);
    assert.deepEqual(changed.map((row) => [row.values[0], row.mark, row.changed]), [['1', 'changed', ['price']]]);

    const added = insert.changes[0].rows.filter((row) => row.mark);
    assert.deepEqual(added.map((row) => [row.mark, row.values[1]]), [['added', 'проверка-метки']]);

    const removed = remove.changes[0].rows.filter((row) => row.mark);
    assert.ok(removed.length > 0);
    assert.ok(removed.every((row) => row.mark === 'removed' && row.values[0] === '1'));

    // ROLLBACK вернул всё: изменения — обратные
    assert.deepEqual(rollback.changes.map((change) => change.table).sort(), ['product_tags', 'products', 'tags']);
    const [check] = await run(`SELECT count(*) FROM tags WHERE name = 'проверка-метки'`);
    assert.deepEqual(check.rows, [['0']]);
  });

  it('DDL — созданная, изменённая и удалённая таблица; схема', async () => {
    const [create, alter, drop] = await run(`
      CREATE TABLE wishlist (
          user_id    integer NOT NULL REFERENCES users (id),
          product_id integer NOT NULL REFERENCES products (id),
          PRIMARY KEY (user_id, product_id)
      );
      ALTER TABLE wishlist ADD COLUMN added_at timestamptz NOT NULL DEFAULT now();
      DROP TABLE wishlist;`);
    assert.deepEqual(create.changes.map((change) => [change.table, change.status]), [['wishlist', 'created']]);
    assert.deepEqual(alter.changes.map((change) => [change.status, change.newColumns]), [['altered', ['added_at']]]);
    assert.deepEqual(drop.changes.map((change) => [change.table, change.status]), [['wishlist', 'dropped']]);

    const schema = await describeSchema(db);
    const products = schema.find((table) => table.name === 'products');
    assert.deepEqual(products.columns.find((col) => col.name === 'price'),
      { name: 'price', type: 'numeric(10,2)', notNull: true, default: null, identity: null });
    assert.equal(products.columns.find((col) => col.name === 'id').identity, 'always');
    assert.equal(products.columns.find((col) => col.name === 'stock').default, '0');
    const definitions = products.constraints.map((con) => `${con.type}: ${con.definition}`);
    assert.ok(definitions.includes('check: CHECK ((price >= (0)::numeric))'), definitions.join('\n'));
    assert.ok(definitions.includes('foreign key: FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT'));
    assert.ok(!schema.some((table) => table.name === 'wishlist'));
  });

  it('JOIN: исходные таблицы, пары строк и пара каждой строки результата', async () => {
    const [result] = await run(`
      SELECT p.name, c.name AS category FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.price > 50000 ORDER BY p.price DESC`);
    const { join } = result;
    assert.equal(join.type, 'INNER JOIN');
    assert.deepEqual(join.left.columns, ['id', 'category_id', 'name', 'price']);
    assert.deepEqual(join.right.columns, ['id', 'name']);
    assert.equal(join.pairs.length, result.rows.length);
    assert.equal(join.resultPairs.length, result.rows.length);
    // пара первой строки результата — это товар и категория из этой строки
    const [productId, categoryId] = join.resultPairs[0];
    const product = join.left.rows[join.left.ids.indexOf(productId)];
    const category = join.right.rows[join.right.ids.indexOf(categoryId)];
    assert.deepEqual([product[2], category[1]], result.rows[0]);
  });

  it('UPDATE: прежние значения изменённых колонок', async () => {
    const [, update] = await run('BEGIN; UPDATE products SET stock = 99 WHERE id = 2; ROLLBACK;');
    const row = update.changes[0].rows.find((item) => item.mark === 'changed');
    assert.deepEqual(row.changed, ['stock']);
    assert.ok(row.old.stock !== '99');
  });

  it('снимок таблиц: строки по первичному ключу, без ключа — по тексту строки', async () => {
    await run('CREATE TABLE log (msg text); INSERT INTO log VALUES (\'b\'), (\'a\');');
    const tables = await snapshotTables(db, parsers, ['log', 'product_tags']);
    assert.deepEqual(Object.keys(tables), ['log', 'product_tags']);
    assert.deepEqual(tables.log, { columns: ['msg'], key: [], rows: [['a'], ['b']] });
    assert.deepEqual(tables.product_tags.key, [0, 1]);
    // строка без ключа «изменилась» = удалена старая + добавлена новая
    const [update] = await run(`UPDATE log SET msg = 'c' WHERE msg = 'a'`);
    assert.deepEqual(update.changes[0].rows.map((row) => [row.values[0], row.mark]),
      [['b', null], ['c', 'added'], ['a', 'removed']]);
    assert.deepEqual(diffSnapshots(tables, tables), []);
  });

  it('сброс возвращает учебные данные и счётчики id', async () => {
    await run('DELETE FROM reviews; CREATE SCHEMA extra; CREATE TABLE extra.t (x int);');
    await resetDatabase(db, BASE);
    const [reviews, schemas, insert] = await run(`
      SELECT count(*) > 0 FROM reviews;
      SELECT count(*) FROM pg_namespace WHERE nspname = 'extra';
      INSERT INTO tags (name) VALUES ('после сброса') RETURNING id;`);
    assert.deepEqual(reviews.rows, [['t']]);
    assert.deepEqual(schemas.rows, [['0']]);
    const [maxId] = (await run('SELECT max(id) - 1 FROM tags'))[0].rows;
    assert.deepEqual(insert.rows, [[maxId[0] === null ? null : String(Number(maxId[0]) + 1)]]);
  });
});
