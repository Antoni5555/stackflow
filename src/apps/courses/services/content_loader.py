"""Загрузка контента из папки content/ в БД (команда load_content).

Структура и поля — docs/content-format.md:

    content/<направление>/_track.yaml
    content/<направление>/_shared/schema.sql, seed.sql     — учебная база SQL
    content/<направление>/<курс>/_course.yaml
    content/<направление>/<курс>/NN-<раздел>/_section.yaml
    content/<направление>/<курс>/NN-<раздел>/NN-<тема>/_topic.yaml
                                                    NN-<slug>.md     — урок
                                                    NN-<slug>.yaml   — задачи

Правила:
- повторный запуск обновляет записи, а не создаёт дубли (ищем по slug внутри родителя);
- всё в одной транзакции: ошибка в любом файле — БД не меняется;
- то, чего больше нет в content/, не удаляется, а скрывается (is_published=False).
"""
import re
from collections import Counter
from dataclasses import dataclass, field

import yaml
from django.db import transaction

from apps.courses.models import Course, Exercise, Lesson, Section, Topic, Track

from .rendering import render_inline, render_markdown


class ContentError(Exception):
    """Ошибка в файле контента: какой файл и что не так."""

    def __init__(self, path, message):
        super().__init__(f'{path}: {message}')


@dataclass
class LoadReport:
    """Итог загрузки: сколько записей создано, обновлено, скрыто."""

    created: Counter = field(default_factory=Counter)
    updated: Counter = field(default_factory=Counter)
    hidden: Counter = field(default_factory=Counter)


NUMBERED = re.compile(r'^(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)$')
FRONT_MATTER = re.compile(r'\A---\n(.*?)\n---\n', flags=re.S)


def read_yaml(path, expect=dict):
    """YAML-файл → словарь (или список). Битый YAML — понятная ошибка с именем файла."""
    try:
        data = yaml.safe_load(path.read_text(encoding='utf-8'))
    except yaml.YAMLError as error:
        raise ContentError(path, f'YAML не читается: {error}') from error
    if not isinstance(data, expect):
        raise ContentError(
            path, 'ожидался словарь полей' if expect is dict else 'ожидался список',
        )
    return data


def require(data, path, *keys):
    """Проверяет, что обязательные поля есть и не пустые."""
    missing = [key for key in keys if data.get(key) in (None, '', [], {})]
    if missing:
        raise ContentError(path, f'нет обязательных полей: {", ".join(missing)}')


def numbered(path):
    """'02-variables-and-types' → (2, 'variables-and-types')."""
    match = NUMBERED.match(path.stem if path.is_file() else path.name)
    if not match:
        raise ContentError(path, 'имя должно быть вида NN-slug (латиница, kebab-case)')
    return int(match.group(1)), match.group(2)


def child_dirs(path, marker):
    """Подпапки, в которых лежит файл-маркер (_course.yaml, _section.yaml…)."""
    return sorted(
        child for child in path.iterdir()
        if child.is_dir() and (child / marker).is_file()
    )


class ContentLoader:
    """Обходит content/ и сохраняет контент в БД."""

    def __init__(self, content_dir):
        self.content_dir = content_dir
        self.report = LoadReport()
        models = (Track, Course, Section, Topic, Lesson, Exercise)
        self.seen = {model: set() for model in models}

    def load(self):
        """Загружает всё. Возвращает LoadReport."""
        with transaction.atomic():
            for track_dir in child_dirs(self.content_dir, '_track.yaml'):
                self.load_track(track_dir)
            self.hide_missing()
        return self.report

    # --- сохранение ---

    def save(self, model, lookup, fields):
        """Создаёт или обновляет запись; сохраняет, только если что-то изменилось."""
        obj = model.objects.filter(**lookup).first()
        if obj is None:
            obj = model.objects.create(**lookup, **fields)
            self.report.created[model.__name__] += 1
        else:
            changed = [
                name for name, value in fields.items() if getattr(obj, name) != value
            ]
            if changed:
                for name in changed:
                    setattr(obj, name, fields[name])
                obj.save(update_fields=changed)
                self.report.updated[model.__name__] += 1
        self.seen[model].add(obj.pk)
        return obj

    def hide_missing(self):
        """Скрывает записи, которых больше нет в content/."""
        for model, ids in self.seen.items():
            count = (
                model.objects.filter(is_published=True)
                .exclude(pk__in=ids)
                .update(is_published=False)
            )
            if count:
                self.report.hidden[model.__name__] += count

    # --- уровни иерархии ---

    def load_track(self, track_dir):
        path = track_dir / '_track.yaml'
        data = read_yaml(path)
        require(data, path, 'title')
        track = self.save(Track, {'slug': track_dir.name}, {
            'title': data['title'],
            'description': data.get('description') or '',
            'order': data.get('order') or 0,
            'sql_dataset': load_sql_dataset(track_dir),
            'is_published': True,
        })
        for course_dir in child_dirs(track_dir, '_course.yaml'):
            self.load_course(track, course_dir)

    def load_course(self, track, course_dir):
        path = course_dir / '_course.yaml'
        data = read_yaml(path)
        require(data, path, 'title', 'order')
        engine = data.get('engine') or ''
        if engine not in Course.Engine.values + ['']:
            raise ContentError(path, f'неизвестный engine: {engine}')
        kind = data.get('kind') or Course.Kind.MAIN
        if kind not in Course.Kind.values:
            raise ContentError(path, 'kind — main или module')
        course = self.save(Course, {'slug': course_dir.name}, {
            'track': track,
            'title': data['title'],
            'description': data.get('description') or '',
            'engine': engine,
            'kind': kind,
            'order': data['order'],
            'is_published': True,
        })
        for section_dir in child_dirs(course_dir, '_section.yaml'):
            self.load_section(course, section_dir)

    def load_section(self, course, section_dir):
        path = section_dir / '_section.yaml'
        data = read_yaml(path)
        require(data, path, 'title')
        order, slug = numbered(section_dir)
        level = data.get('level') or 1
        if level not in Section.Level.values:
            raise ContentError(path, 'level — 1, 2 или 3')
        section = self.save(Section, {'course': course, 'slug': slug}, {
            'title': data['title'],
            'level': level,
            'order': order,
            'is_published': True,
        })
        for topic_dir in child_dirs(section_dir, '_topic.yaml'):
            self.load_topic(section, topic_dir)

    def load_topic(self, section, topic_dir):
        path = topic_dir / '_topic.yaml'
        data = read_yaml(path)
        require(data, path, 'title')
        order, slug = numbered(topic_dir)
        topic = self.save(Topic, {'section': section, 'slug': slug}, {
            'title': data['title'],
            'order': order,
            'practice': load_practice(topic_dir),
            'is_published': True,
        })

        lessons = sorted(topic_dir.glob('*.md'))
        if len(lessons) > 1:
            raise ContentError(topic_dir, 'в теме должен быть один урок (.md)')
        if lessons:
            self.load_lesson(topic, lessons[0])

        for exercise_path in sorted(topic_dir.glob('*.yaml')):
            if not exercise_path.name.startswith('_'):
                self.load_exercise(topic, exercise_path)

    def load_lesson(self, topic, path):
        text = path.read_text(encoding='utf-8')
        match = FRONT_MATTER.match(text)
        if not match:
            raise ContentError(path, 'нет блока --- с полями урока в начале файла')
        try:
            meta = yaml.safe_load(match.group(1)) or {}
        except yaml.YAMLError as error:
            message = f'YAML в начале урока не читается: {error}'
            raise ContentError(path, message) from error
        require(meta, path, 'title')
        try:
            body_html = render_markdown(text[match.end():], base_dir=path.parent)
        except FileNotFoundError as error:
            raise ContentError(path, str(error)) from error
        self.save(Lesson, {'topic': topic}, {
            'title': meta['title'],
            'body_html': body_html,
            'reading_time': meta.get('reading_time') or 5,
            'is_published': True,
        })

    def load_exercise(self, topic, path):
        data = read_yaml(path)
        require(data, path, 'title', 'type', 'difficulty', 'pitfall', 'statement',
                'explanation')
        order, slug = numbered(path)
        if data['type'] not in Exercise.Type.values:
            raise ContentError(path, f'неизвестный type: {data["type"]}')
        self.save(Exercise, {'topic': topic, 'slug': slug}, {
            'type': data['type'],
            'title': data['title'],
            'difficulty': data['difficulty'],
            'pitfall': data['pitfall'],
            'statement_html': render_markdown(data['statement']),
            'explanation_html': render_markdown(data['explanation']),
            'spec': exercise_spec(data, path, engine=topic.section.course.engine),
            'order': order,
            'is_published': True,
        })


# Что нужно странице задачи каждого типа (кроме общих полей)
# Задача на вёрстку — exercise с check.type: dom: файлы и правила по готовой странице
DOM_FIELDS = (['files', 'check', 'solution'], [])
# Задача в терминале — exercise с check.type: state: setup (файлы до начала), правила
# по итоговому состоянию и solution — команды эталона по одной на строку
STATE_FIELDS = (['setup', 'check', 'solution'], [])
STATE_PATH_CHECKS = {
    'exists', 'contains', 'not_contains', 'mode', 'owner', 'group', 'link_to',
}
# Git (курс с движком git): ключи setup и правила; «есть / нет» — через exists: false
STATE_SETUP_KEYS = {
    'cwd', 'files', 'dirs', 'links', 'services', 'processes', 'repo', 'commits', 'head',
    'remote', 'venv', 'gitconfig', 'now', 'crontab', 'docker',
}
# setup.now — «сейчас» симулятора (время Москвы): от него date, ls -l, find -mtime
SETUP_NOW = re.compile(r'^\d{4}-\d\d-\d\d( \d\d:\d\d(:\d\d)?)?$')
GIT_RULES = {
    'branch': {'exists'}, 'tag': {'exists'},
    'tracked': {'exists'}, 'staged': {'exists'},
    'head': set(), 'commit_in': set(), 'commit_count': set(), 'clean': set(),
    'merged': set(), 'pushed': set(), 'config': set(), 'stash_count': set(),
    'pip_package': {'venv'},
}
# Учебный systemd (js/engines/linux/system.js): сервис запущен/включён, процесс есть/нет
SYSTEM_RULES = {
    'service': {'active', 'enabled'}, 'process': {'running'}, 'port': {'listening'},
}
PROCESS_FIELDS = {'command', 'user', 'name', 'pid', 'cpu', 'mem', 'listen'}
# crontab пользователя (js/engines/linux/cron.js): строка есть / нет, crontab есть / нет
CRON_RULES = {'crontab': {'matches', 'not_matches', 'exists'}}
OBJECT_RULES = {**GIT_RULES, **SYSTEM_RULES, **CRON_RULES}
# Учебный Docker (js/engines/docker/rules.js): {docker: вид, поля…};
# первое множество — поля, из которых нужно хотя бы одно, второе — необязательные
DOCKER_RULES = {
    'container': ({'name', 'image'}, {'status'}),
    'port': ({'container'}, {'host', 'port'}),
    'volume': ({'name'}, {'exists', 'mounted_in', 'path'}),
    'image': ({'ref'}, {'exists', 'max_size_mb', 'user_not_root'}),
    'network': ({'name'}, {'exists', 'containers'}),
}
DOCKER_STATUSES = {'running', 'exited', 'created', 'exists', 'absent'}
DOCKER_SETUP_KEYS = {'images', 'volumes', 'containers'}
DOCKER_CONTAINER_KEYS = {
    'name', 'image', 'ports', 'env', 'volumes', 'running', 'command', 'network',
    'restart',
}
DOM_CHECKS = {'count', 'min', 'exists', 'attr', 'text', 'style'}
SPEC_FIELDS = {
    'exercise': (['starter_code', 'solution', 'check'], ['inputs']),
    'predict': (['code', 'answer'], []),
    'quiz': (['kind', 'options', 'answer'], []),
    'fix': (['files', 'check', 'solution'], []),
}


def validate_dom_rules(rules, path):
    """Правило dom: selector + что проверить, или must_match/must_not_match.

    Сами правила выполняет браузер (js/engines/html/checker.js) — здесь только форма.
    """
    for number, rule in enumerate(rules, start=1):
        if not isinstance(rule, dict) or not rule.get('fail'):
            raise ContentError(path, f'правило {number}: нужен словарь с fail')
        if 'selector' in rule:
            unknown = set(rule) - DOM_CHECKS - {'selector', 'fail', 'width'}
            if unknown:
                raise ContentError(
                    path, f'правило {number}: неизвестные поля {sorted(unknown)}',
                )
        elif not {'must_match', 'must_not_match'} & set(rule):
            raise ContentError(path, f'правило {number}: нужен selector или must_match')


def validate_state(spec, path):
    """Задача в терминале: форма setup и правил. Сами правила проверяет браузер
    (js/engines/linux/checker.js, для Git — engines/git/checker.js), эталон
    прогоняет тест сайта через Node."""
    setup = spec['setup']
    if not isinstance(setup, dict) or set(setup) - STATE_SETUP_KEYS:
        unknown = set(setup) - STATE_SETUP_KEYS if isinstance(setup, dict) else set()
        raise ContentError(path, f'setup: неизвестные ключи {sorted(unknown)}')
    if not isinstance(setup.get('files', {}), dict):
        raise ContentError(path, 'setup.files — словарь {путь: текст или настройки}')
    services = setup.get('services', {})
    if not isinstance(services, dict) or not all(
        isinstance(state, dict) and set(state) <= {'active', 'enabled'}
        for state in services.values()
    ):
        raise ContentError(path, 'setup.services — {сервис: {active, enabled}}')
    processes = setup.get('processes', [])
    if not isinstance(processes, list) or not all(
        isinstance(proc, dict) and 'command' in proc
        and set(proc) <= PROCESS_FIELDS
        for proc in processes
    ):
        raise ContentError(
            path, 'setup.processes — список {command, user?, listen?, …}',
        )
    links = setup.get('links', {})
    if not isinstance(links, dict) or not all(
        isinstance(target, str) or (isinstance(target, dict) and 'target' in target)
        for target in links.values()
    ):
        raise ContentError(path, 'setup.links — словарь {путь ссылки: цель}')
    if 'now' in setup and not SETUP_NOW.match(str(setup['now'])):
        raise ContentError(path, 'setup.now — "ГГГГ-ММ-ДД ЧЧ:ММ" (время Москвы)')
    crontabs = setup.get('crontab', {})
    if not isinstance(crontabs, dict) or not all(
        isinstance(text, str) for text in crontabs.values()
    ):
        raise ContentError(path, 'setup.crontab — {пользователь: строки расписания}')
    validate_docker_setup(setup.get('docker'), path)
    if not isinstance(spec['solution'], str):
        raise ContentError(path, 'solution — команды по одной на строку (текст)')
    for number, rule in enumerate(spec['check']['expect'], start=1):
        if not isinstance(rule, dict) or not rule.get('fail'):
            raise ContentError(path, f'правило {number}: нужен словарь с fail')
        checks = set(rule) - {'path', 'fail'}
        git = [key for key in OBJECT_RULES if key in rule]
        if 'docker' in rule:
            validate_docker_rule(rule, number, path)
        elif git:
            extra = set(rule) - {git[0], 'fail'} - OBJECT_RULES[git[0]]
            if len(git) > 1 or extra:
                raise ContentError(
                    path,
                    f'правило {number}: {git[0]} — без {sorted(extra or set(git[1:]))}',
                )
            if git[0] == 'crontab' and len(set(rule) & CRON_RULES['crontab']) != 1:
                raise ContentError(
                    path,
                    f'правило {number}: crontab — с одним из '
                    'matches, not_matches, exists',
                )
            if git[0] == 'service' and not {'active', 'enabled'} & set(rule):
                raise ContentError(
                    path, f'правило {number}: service — с active или enabled',
                )
        elif 'output_matches' in rule:
            if checks != {'output_matches'} or 'path' in rule:
                raise ContentError(
                    path, f'правило {number}: output_matches — только с fail',
                )
        elif 'path' not in rule or len(checks) != 1 or not checks <= STATE_PATH_CHECKS:
            raise ContentError(
                path, f'правило {number}: path + одно из {sorted(STATE_PATH_CHECKS)}',
            )


def validate_docker_setup(docker, path):
    """setup.docker: {images: [...], volumes: [...], containers: [{name, image, …}]}."""
    if docker is None:
        return
    if not isinstance(docker, dict) or set(docker) - DOCKER_SETUP_KEYS:
        raise ContentError(
            path, f'setup.docker — словарь с ключами {sorted(DOCKER_SETUP_KEYS)}',
        )
    for key in ('images', 'volumes'):
        items = docker.get(key, [])
        if not isinstance(items, list) or not all(
            isinstance(item, str) for item in items
        ):
            raise ContentError(path, f'setup.docker.{key} — список строк')
    containers = docker.get('containers', [])
    if not isinstance(containers, list) or not all(
        isinstance(item, dict) and 'image' in item
        and set(item) <= DOCKER_CONTAINER_KEYS
        for item in containers
    ):
        raise ContentError(
            path,
            'setup.docker.containers — список {image, name?, ports?, env?, volumes?, '
            'running?, command?, network?, restart?}',
        )


def validate_docker_rule(rule, number, path):
    """Правило {docker: container|port|volume|image|network, …}."""
    kind = rule['docker']
    if kind not in DOCKER_RULES:
        raise ContentError(
            path, f'правило {number}: docker — одно из {sorted(DOCKER_RULES)}',
        )
    required, optional = DOCKER_RULES[kind]
    fields = set(rule) - {'docker', 'fail'}
    if not fields & required or fields - required - optional:
        raise ContentError(
            path,
            f'правило {number}: docker {kind} — поля {sorted(required)} '
            f'и необязательные {sorted(optional)}',
        )
    if kind == 'container' and rule.get('status', 'running') not in DOCKER_STATUSES:
        raise ContentError(
            path, f'правило {number}: status — одно из {sorted(DOCKER_STATUSES)}',
        )
    if kind == 'port' and 'host' not in rule:
        raise ContentError(path, f'правило {number}: docker port — нужен host')


# SQL (курс с движком sql): setup — SQL после учебных данных, проверка — по результату
# последнего запроса, по таблицам после решения или по их структуре
SQL_FIELDS = (['solution', 'check'], ['setup', 'starter_code'])
SQL_CHECKS = {'result': {'order_matters'}, 'state': {'tables'}, 'schema': {'tables'}}
SQL_DATASET_FILES = ('schema.sql', 'seed.sql')


def load_sql_dataset(track_dir):
    """Учебная база направления: _shared/schema.sql, затем seed.sql (если есть)."""
    parts = []
    for name in SQL_DATASET_FILES:
        path = track_dir / '_shared' / name
        if path.exists():
            parts.append(path.read_text(encoding='utf-8'))
    return '\n'.join(parts)


def sql_tables(value, path):
    """tables: [orders] — все колонки; {products: [id, name]} — только эти.

    Храним списком [{name, columns}]: JSONB в Postgres переставил бы ключи словаря.
    """
    if isinstance(value, list) and value and all(isinstance(t, str) for t in value):
        return [{'name': name, 'columns': None} for name in value]
    if isinstance(value, dict) and value and all(
        isinstance(columns, list) and columns
        and all(isinstance(column, str) for column in columns)
        for columns in value.values()
    ):
        return [{'name': name, 'columns': columns} for name, columns in value.items()]
    raise ContentError(
        path, 'tables — список таблиц или словарь {таблица: [колонки]}',
    )


def sql_spec(data, path):
    """Задача SQL: решение, setup и проверка. Решения ученика и эталона выполняет
    браузер (js/engines/sql/), эталоны прогоняет Node-тест сайта."""
    required, optional = SQL_FIELDS
    require(data, path, *required)
    spec = {key: data[key] for key in required + optional if key in data}
    for key in ('solution', 'setup', 'starter_code'):
        if key in spec and not isinstance(spec[key], str):
            raise ContentError(path, f'{key} — текст SQL')
    check = spec['check']
    kind = check.get('type') if isinstance(check, dict) else None
    if kind not in SQL_CHECKS:
        raise ContentError(path, 'check.type — result, state или schema')
    if extra := set(check) - {'type'} - SQL_CHECKS[kind]:
        raise ContentError(path, f'check ({kind}): лишние поля {sorted(extra)}')
    if kind == 'result':
        order_matters = check.get('order_matters', True)
        if not isinstance(order_matters, bool):
            raise ContentError(path, 'order_matters — true или false')
        spec['check'] = {'type': kind, 'order_matters': order_matters}
    else:
        require(check, path, 'tables')
        spec['check'] = {'type': kind, 'tables': sql_tables(check['tables'], path)}
    if kind == 'schema' and any(table['columns'] for table in spec['check']['tables']):
        raise ContentError(path, 'schema: tables — список таблиц, без колонок')
    spec['hints'] = [render_inline(str(hint)) for hint in data.get('hints') or []]
    return spec


# Django (курс с движком django): приложение shop из файлов, проверка — тесты с client
# (check.tests) или тесты ученика против «сломанных» версий кода (check.mutants).
# Проект и тесты выполняет браузер (js/engines/django/runner.py), эталоны — тест сайта
DJANGO_FIELDS = (['files', 'solution', 'check'], ['setup', 'settings'])
# как FIXED_SETTINGS в runner.py: на них тренажёр собирает проект
DJANGO_FIXED_SETTINGS = {
    'INSTALLED_APPS', 'DATABASES', 'ROOT_URLCONF', 'AUTH_USER_MODEL', 'TEMPLATES',
}
DJANGO_LIST_SETTINGS = ('MIDDLEWARE', 'CONTEXT_PROCESSORS')


def django_files(value, path, name):
    """{путь внутри shop/: текст} — файлы проекта ученика."""
    if not isinstance(value, dict) or not value or not all(
        isinstance(key, str) and isinstance(text, str) for key, text in value.items()
    ):
        raise ContentError(path, f'{name} — словарь {{путь в shop/: текст}}')
    return value


def django_checks(check, path):
    """check.tests: [{code, fail}] или check.mutants: [{files, fail}] — одно из двух."""
    if not isinstance(check, dict) or check.get('type') != 'django':
        raise ContentError(path, 'check.type должен быть django')
    kinds = [key for key in ('tests', 'mutants') if key in check]
    if len(kinds) != 1 or set(check) - {'type', *kinds}:
        raise ContentError(path, 'check: type django и tests или mutants (одно)')
    kind = kinds[0]
    items = check[kind]
    if not isinstance(items, list) or not items:
        raise ContentError(path, f'check.{kind} — непустой список')
    field = 'code' if kind == 'tests' else 'files'
    for number, item in enumerate(items, start=1):
        if not isinstance(item, dict) or set(item) != {field, 'fail'}:
            raise ContentError(path, f'{kind}, {number}: нужны {field} и fail')
        if kind == 'mutants':
            django_files(item['files'], path, f'mutants, {number}: files')
        elif not isinstance(item['code'], str):
            raise ContentError(path, f'tests, {number}: code — текст Python')
    return {'type': 'django', kind: items}


def django_settings(value, path):
    """settings: — добавки к настройкам тренажёра на время запуска."""
    if not isinstance(value, dict):
        raise ContentError(path, 'settings — словарь {НАСТРОЙКА: значение}')
    if fixed := sorted(DJANGO_FIXED_SETTINGS & set(value)):
        raise ContentError(path, f'settings: {", ".join(fixed)} задача менять не может')
    for key in DJANGO_LIST_SETTINGS:
        if key in value and not (
            isinstance(value[key], list) and all(isinstance(v, str) for v in value[key])
        ):
            raise ContentError(path, f'settings.{key} — список путей строками')
    return value


def django_spec(data, path):
    """Задача Django: файлы заготовки, эталон (изменённые файлы), setup и проверка."""
    required, optional = DJANGO_FIELDS
    require(data, path, *required)
    files = django_files(data['files'], path, 'files')
    solution = django_files(data['solution'], path, 'solution')
    spec = {
        'files': files,
        'solution': solution,
        'check': django_checks(data['check'], path),
        # JSONB переставляет ключи — порядок вкладок храним отдельно; файлы, которых
        # нет в заготовке (forms.py), ученик пишет с нуля — пустая вкладка
        'file_names': list(files) + [name for name in solution if name not in files],
    }
    if 'setup' in data:
        if not isinstance(data['setup'], str):
            raise ContentError(path, 'setup — Python строкой (setup: |)')
        spec['setup'] = data['setup']
    if 'settings' in data:
        spec['settings'] = django_settings(data['settings'], path)
    spec['hints'] = [render_inline(str(hint)) for hint in data.get('hints') or []]
    return spec


# Python «напишите тесты» (check.type: pytest): files — код задачи и заготовка тестов,
# solution — эталонный файл тестов, mutants — сломанные версии кода. Как у Django,
# но тесты ученика запускает pytest (js/engines/python/runner.py, check_tests)
PYTEST_FIELDS = ['files', 'solution', 'check']


def pytest_spec(data, path):
    """Задача «напишите тесты» на Python: файлы, эталон тестов, сломанные версии."""
    require(data, path, *PYTEST_FIELDS)
    files = django_files(data['files'], path, 'files')
    solution = django_files(data['solution'], path, 'solution')
    if len(solution) != 1:
        raise ContentError(path, 'solution — один файл: эталонные тесты test_….py')
    test_file = next(iter(solution))
    if not (test_file.split('/')[-1].startswith('test_') and test_file.endswith('.py')):
        raise ContentError(path, f'solution: {test_file} — нужен файл test_….py')
    check = data['check']
    if set(check) != {'type', 'mutants'}:
        raise ContentError(path, 'check: type pytest и mutants')
    mutants = check['mutants']
    if not isinstance(mutants, list) or not mutants:
        raise ContentError(path, 'check.mutants — непустой список')
    for number, mutant in enumerate(mutants, start=1):
        if not isinstance(mutant, dict) or set(mutant) != {'files', 'fail'}:
            raise ContentError(path, f'mutants, {number}: нужны files и fail')
        broken = django_files(mutant['files'], path, f'mutants, {number}: files')
        if extra := sorted(set(broken) - set(files) | ({test_file} & set(broken))):
            raise ContentError(
                path, f'mutants, {number}: {", ".join(extra)} — не код задачи из files',
            )
    return {
        'files': files,
        'solution': solution,
        'check': {'type': 'pytest', 'mutants': mutants},
        'test_file': test_file,
        # файл тестов ученика — последней вкладкой; его нет в files — пустая заготовка
        'file_names': [name for name in files if name != test_file] + [test_file],
        'hints': [render_inline(str(hint)) for hint in data.get('hints') or []],
    }


PRACTICE_FIELDS = {'title', 'text', 'hint', 'answer'}


def load_practice(topic_dir):
    """Задачник темы из _practice.yaml (необязательный): тексты — сразу в HTML."""
    path = topic_dir / '_practice.yaml'
    if not path.exists():
        return []
    items = read_yaml(path, expect=list)
    if not items:
        raise ContentError(path, 'задачник — непустой список задач')
    practice = []
    for number, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            raise ContentError(path, f'задача {number}: нужен словарь полей')
        missing = [key for key in ('title', 'text', 'answer') if not item.get(key)]
        if missing:
            raise ContentError(path, f'задача {number}: нет полей {", ".join(missing)}')
        if extra := set(item) - PRACTICE_FIELDS:
            raise ContentError(path, f'задача {number}: лишние поля {sorted(extra)}')
        practice.append({
            'title': item['title'],
            'text': render_markdown(item['text'], base_dir=topic_dir),
            'hint': (
                render_markdown(item['hint'], base_dir=topic_dir)
                if item.get('hint') else ''
            ),
            'answer': render_markdown(item['answer'], base_dir=topic_dir),
        })
    return practice


def exercise_spec(data, path, engine=''):
    """Поля задачи, зависящие от её типа, — для JSON-поля Exercise.spec.

    Код, тесты и правила сохраняются как есть; текст для показа
    (подсказки, варианты ответа) — сразу в HTML. engine — движок курса:
    exercise в SQL-курсе устроена по-своему (check.type state там — таблицы, не файлы).
    """
    if engine == Course.Engine.SQL and data['type'] == 'exercise':
        return sql_spec(data, path)
    if engine == Course.Engine.DJANGO and data['type'] == 'exercise':
        return django_spec(data, path)
    check = data.get('check')
    check_type = check.get('type') if isinstance(check, dict) else None
    if data['type'] == 'exercise' and check_type == 'pytest':
        return pytest_spec(data, path)
    is_dom = data['type'] == 'exercise' and check_type == 'dom'
    is_state = data['type'] == 'exercise' and check_type == 'state'
    if is_dom:
        required, optional = DOM_FIELDS
    elif is_state:
        required, optional = STATE_FIELDS
    else:
        required, optional = SPEC_FIELDS[data['type']]
    require(data, path, *required)
    spec = {key: data[key] for key in required + optional if key in data}

    check = spec.get('check')
    if check is not None:
        expected = {'exercise': 'tests', 'fix': 'rules'}[data['type']]
        if is_dom or is_state:
            expected = check_type
        if not isinstance(check, dict) or check.get('type') != expected:
            raise ContentError(path, f'check.type должен быть {expected}')
        # у dom правила лежат в rules, как у fix; у state — в expect
        key = {'dom': 'rules', 'state': 'expect'}.get(expected, expected)
        require(check, path, key)
    if is_dom:
        validate_dom_rules(check['rules'], path)
    if is_state:
        validate_state(spec, path)

    if data['type'] == 'quiz':
        if data['kind'] not in ('single', 'multiple', 'order'):
            raise ContentError(path, 'kind — single, multiple или order')
        spec['options'] = [render_inline(str(option)) for option in data['options']]

    if data['type'] == 'fix' or is_dom:
        # JSONB в Postgres переставляет ключи — порядок файлов из YAML храним отдельно
        spec['file_names'] = list(data['files'])

    spec['hints'] = [render_inline(str(hint)) for hint in data.get('hints') or []]
    return spec
