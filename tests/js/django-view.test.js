// Тренажёр Django: поиск N+1 и форматирование SQL (src/static/js/engines/django/view.js).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findNPlusOne, formatSql, plural, sqlShape } from '../../src/static/js/engines/django/view.js';

const category = (id) => ({ sql: `SELECT "shop_category"."id", "shop_category"."name" FROM "shop_category" WHERE "shop_category"."id" = ${id} LIMIT 21`, ms: 0 });
const list = { sql: 'SELECT "shop_product"."id" FROM "shop_product" ORDER BY "shop_product"."price" ASC', ms: 0 };

describe('SQL в тренажёре Django', () => {
  it('форма запроса: значения → ?', () => {
    assert.equal(sqlShape(category(3).sql), sqlShape(category(12).sql));
    assert.equal(sqlShape(`SELECT 1 WHERE name = 'O''Neil' AND x = 2.5`), 'SELECT ? WHERE name = ? AND x = ?');
    assert.notEqual(sqlShape(category(1).sql), sqlShape(list.sql));
  });

  it('N+1: от трёх запросов одной формы подряд', () => {
    const queries = [list, category(3), category(3), category(2), category(1), list];
    assert.deepEqual(findNPlusOne(queries), [{ start: 1, count: 4, table: 'shop_category' }]);
    assert.deepEqual(findNPlusOne([list, category(1), category(2)]), []);
    assert.deepEqual(findNPlusOne([]), []);
  });

  it('SQL по строкам: FROM, WHERE, JOIN, ORDER BY, LIMIT', () => {
    assert.equal(formatSql(category(3).sql),
      'SELECT "shop_category"."id", "shop_category"."name"\nFROM "shop_category"\nWHERE "shop_category"."id" = 3\nLIMIT 21');
    assert.equal(formatSql('SELECT a FROM t INNER JOIN u ON (t.u_id = u.id) WHERE a = 1 AND b = 2'),
      'SELECT a\nFROM t\nINNER JOIN u ON (t.u_id = u.id)\nWHERE a = 1\n  AND b = 2');
  });

  it('подписи', () => {
    assert.deepEqual([1, 3, 8].map((n) => plural(n, 'запрос', 'запроса', 'запросов')), ['1 запрос', '3 запроса', '8 запросов']);
  });
});
