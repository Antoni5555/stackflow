// Движок Django: тот же воркер Pyodide, что у Python, но с Django внутри
// (облегчённый архив static/vendor/django.zip и engines/django/runner.py).
// Каждый запуск собирает проект ученика заново на новой базе — см. runner.py.

import { PythonEngine } from '../python/engine.js';

// Запуск = сборка приложения + migrate + учебные данные + запросы: дольше,
// чем программа Python. Зависание (бесконечный цикл во view) — перезапуск воркера.
const DJANGO_TIMEOUT = 8000;
// Тесты ученика запускаются на коде задачи и на каждой «сломанной» версии
const TESTS_TIMEOUT = 15000;
const TESTS_TIMEOUT_MESSAGE = 'Тесты не завершились за 15 секунд — возможно, бесконечный цикл '
  + 'в тестах. Среда Django перезапущена.';
const TIMEOUT_MESSAGE = 'Запрос не завершился за 8 секунд — возможно, бесконечный цикл во view '
  + 'или в шаблоне. Среда Django перезапущена.';

/** urls — как у PythonEngine плюс { django, djangoRunner } (адреса архива и runner.py). */
export class DjangoEngine extends PythonEngine {
  /**
   * Запустить проект: files — {имя: текст} (models.py, views.py, urls.py, templates/…),
   * setup — учебные данные через ORM, requests — [{method, path, data?}], orm — строка ORM,
   * strictSetup: false — ошибка учебных данных не останавливает запуск (песочница).
   * Ответ — { requests, orm, models } или { error, stage }, после тайм-аута — { aborted }.
   */
  run({ files, setup = '', requests = [], orm = '', strictSetup = true, settings = null }) {
    const data = { files, setup, requests, orm, strictSetup, settings };
    return this.request('django', data, DJANGO_TIMEOUT, TIMEOUT_MESSAGE);
  }

  /**
   * Проверить задачу: тесты по порядку (client, csrf_client, max_queries, templates_used…).
   * Ответ — { failed: [fail…], total, error } или { error, stage }, после тайм-аута — { aborted }.
   */
  check({ files, setup = '', tests, settings = null }) {
    const data = { files, setup, tests, settings };
    return this.request('djangoCheck', data, DJANGO_TIMEOUT, TIMEOUT_MESSAGE);
  }

  /**
   * Задача «напишите тесты»: files с tests.py ученика, mutants — [{files, fail}].
   * Ответ — { failed, total, error, output } или { error, stage }, после тайм-аута — { aborted }.
   */
  checkTests({ files, mutants, settings = null }) {
    const data = { files, mutants, settings };
    return this.request('djangoCheckTests', data, TESTS_TIMEOUT, TESTS_TIMEOUT_MESSAGE);
  }
}
