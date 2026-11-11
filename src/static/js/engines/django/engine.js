// Движок Django: тот же воркер Pyodide, что у Python, но с Django внутри
// (облегчённый архив static/vendor/django.zip и engines/django/runner.py).
// Каждый запуск собирает проект ученика заново на новой базе — см. runner.py.

import { PythonEngine } from '../python/engine.js';

// Запуск = сборка приложения + migrate + учебные данные + запросы: дольше,
// чем программа Python. Зависание (бесконечный цикл во view) — перезапуск воркера.
const DJANGO_TIMEOUT = 8000;
const TIMEOUT_MESSAGE = 'Запрос не завершился за 8 секунд — возможно, бесконечный цикл во view '
  + 'или в шаблоне. Среда Django перезапущена.';

/** urls — как у PythonEngine плюс { django, djangoRunner } (адреса архива и runner.py). */
export class DjangoEngine extends PythonEngine {
  /**
   * Запустить проект: files — {имя: текст} (models.py, views.py, urls.py, templates/…),
   * setup — учебные данные через ORM, requests — [{method, path, data?}], orm — строка ORM.
   * Ответ — { requests, orm, models } или { error, stage }, после тайм-аута — { aborted }.
   */
  run({ files, setup = '', requests = [], orm = '' }) {
    return this.request('django', { files, setup, requests, orm }, DJANGO_TIMEOUT, TIMEOUT_MESSAGE);
  }
}
