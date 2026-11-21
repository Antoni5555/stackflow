---
title: Версии Python
type: lesson
level: 2
reading_time: 12
---

## Теория
В Ubuntu 24.04 системный Python — 3.12, в Ubuntu 22.04 — 3.10. Проекту же может понадобиться другая версия: старый сервис склада написан под 3.10, а новый магазин хочет 3.13. Менять системный Python нельзя: на нём работают утилиты Ubuntu (тот же `apt`), и замена версии ломает систему.

**pyenv** — менеджер версий Python для пользователя:
- ставит нужные версии в домашнюю папку (`~/.pyenv/versions/3.10.18`), не трогая системный Python;
- выбирает версию **по папке проекта**: файл `.python-version` в корне проекта говорит, какой Python запускать здесь;
- работает через **shims** — маленькие программы `python`, `pip` в `~/.pyenv/shims`, которые стоят в начале `PATH` и передают запуск нужной версии.

Команды:
- `pyenv install --list` — какие версии можно поставить; `pyenv install 3.10.18` — скачать и собрать версию (несколько минут; нужны пакеты для сборки — `build-essential`, `libssl-dev`, `zlib1g-dev` и др. через `apt`);
- `pyenv versions` — установленные, звёздочка — активная; `system` — системный Python;
- **`pyenv local 3.10.18`** — версия для текущей папки (создаёт `.python-version`); `pyenv local --unset` — вернуть как было;
- `pyenv global 3.10.18` — версия по умолчанию для пользователя; на сервере обычно оставляют `system`;
- `pyenv version` — какая версия выбрана и **почему** (`set by …`); `pyenv which python` — путь к настоящему интерпретатору.

После выбора версии создают виртуальное окружение уже этим Python: `python -m venv venv`. Окружение запоминает версию — дальше `venv/bin/python` всегда 3.10, даже без pyenv (так его и запускает служба systemd).

Установка pyenv — `git clone https://github.com/pyenv/pyenv.git ~/.pyenv` и три строки в `~/.bashrc`:
```
export PYENV_ROOT="$HOME/.pyenv"
[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init - bash)"
```
Первая — где лежит pyenv, вторая — его команда в `PATH`, третья — подключает shims. После правки `~/.bashrc` — новый вход в терминал или `source ~/.bashrc` (подробно о `PATH` — раздел «Процессы, сервисы, сеть»).

Альтернатива без сборки — пакеты `python3.10` из стороннего репозитория deadsnakes; в Docker версия Python задаётся образом (`FROM python:3.10`), и pyenv не нужен.

## Наглядно
**Рисунок 1.** Как pyenv выбирает Python по папке.

![Рисунок 1. Команда python ищется по PATH: первой стоит ~/.pyenv/shims. Shim смотрит .python-version в текущей папке и выше. В /srv/warehouse файл говорит 3.10.18 — запускается ~/.pyenv/versions/3.10.18/bin/python. В другой папке файла нет — версия из ~/.pyenv/version: system, то есть /usr/bin/python3 3.12.3](img/pyenv.svg)

**Таблица 1.** Команды pyenv.

| Задача | Команда |
|---|---|
| какие версии можно поставить | `pyenv install --list` |
| поставить версию | `pyenv install 3.10.18` |
| что установлено | `pyenv versions` |
| версия для проекта | `pyenv local 3.10.18` |
| какая активна и почему | `pyenv version` |
| путь к интерпретатору | `pyenv which python` |
| вернуть системный | `pyenv local --unset` |
| окружение нужной версии | `python -m venv venv` |

## На практике
Задача: сервис склада в `/srv/warehouse` требует Python 3.10, а на сервере Ubuntu 24.04 с Python 3.12. pyenv уже установлен, версия 3.10.18 собрана. Команды выполнены на настоящем Ubuntu (в тренажёре pyenv нет).

### Шаг 1. Что есть сейчас
Системный Python и версии pyenv:
```bash
cd /srv/warehouse
python3 --version
pyenv versions
python --version
```
Результат:
```
Python 3.12.3
* system (set by /home/shop/.pyenv/version)
  3.10.18
pyenv: python: command not found

The `python' command exists in these Python versions:
  3.10.18

Note: See 'pyenv help global' for tips on allowing multiple
      Python versions to be found at the same time.
```
В Ubuntu системная команда — только `python3`; команды `python` нет. pyenv подсказывает, что `python` есть в версии 3.10.18.

### Шаг 2. Версия для проекта
Выбираем 3.10.18 для папки склада:
```bash
pyenv local 3.10.18
cat .python-version
python --version
pyenv version
pyenv which python
```
Результат:
```
3.10.18
Python 3.10.18
3.10.18 (set by /srv/warehouse/.python-version)
/home/shop/.pyenv/versions/3.10.18/bin/python
```
`pyenv local` записал версию в `.python-version`, и в этой папке `python` — 3.10. `pyenv version` объясняет, откуда взялся выбор.

### Шаг 3. Окружение и другая папка
Виртуальное окружение — уже нужной версией; затем выход из проекта:
```bash
python -m venv venv
venv/bin/python --version
cd ..
python --version
```
Результат:
```
Python 3.10.18
pyenv: python: command not found

The `python' command exists in these Python versions:
  3.10.18

Note: See 'pyenv help global' for tips on allowing multiple
      Python versions to be found at the same time.
```
`venv` запомнил 3.10. Вне проекта `.python-version` нет — снова системный выбор, где `python` отсутствует.

### Шаг 4. Версии, которой нет
Попытка выбрать не собранную версию:
```bash
cd /srv/warehouse
pyenv local 3.11.9
```
Результат:
```
pyenv: version `3.11.9' not installed
```
Сначала `pyenv install 3.11.9`, потом `pyenv local`. Посмотреть доступные новые 3.12 — `pyenv install --list | grep " 3.12"`.

## Частые ошибки
- **Менять системный Python.** `sudo apt remove python3` или ссылка `/usr/bin/python3` на другую версию ломают `apt` и утилиты Ubuntu. Свои версии — pyenv.
- **Забыть `.bashrc`.** После `git clone` команда `pyenv` не находится, а `python` не переключается: нет строк инициализации или терминал не перезапущен.
- **Создать `venv` системным Python.** `python3 -m venv venv` до `pyenv local` даёт окружение 3.12 — проект упадёт на старых библиотеках. Сначала версия, потом `venv`.
- **`pyenv install` без пакетов сборки.** Сборка падает или Python получается без `ssl` (pip не скачивает пакеты). Перед установкой — `build-essential`, `libssl-dev`, `zlib1g-dev`, `libffi-dev` и другие из инструкции pyenv.
- **`pyenv global` на сервере «чтобы везде было».** Меняется Python для всех скриптов пользователя. Для проекта — `pyenv local`.
- **Не закоммитить `.python-version`.** Другой разработчик или сервер возьмут свою версию. Файл кладут в репозиторий проекта.

## Итог
**Зачем**
- Нужная версия Python для проекта, не трогая системную.

**Как**
- `pyenv install` — версия в `~/.pyenv`; `pyenv local` — `.python-version` в проекте; shims в `PATH` запускают нужную.
- Проверка — `pyenv version` (с причиной выбора) и `python --version`.

**Дальше**
- `python -m venv venv` — окружение запоминает версию; служба запускает `venv/bin/python`.

## Вопросы на собеседовании
<details><summary>Как запустить проект на версии Python, которой нет в системе?</summary>

Поставить версию менеджером версий (`pyenv install 3.10.18`), выбрать её для проекта (`pyenv local` → `.python-version`) и создать виртуальное окружение этой версией. Альтернативы — пакеты deadsnakes или Docker-образ с нужной версией. Системный Python не заменяют.
</details>

<details><summary>Как pyenv переключает версию Python?</summary>

В начало `PATH` добавляется папка shims с исполняемыми файлами `python`, `pip` и др. Shim определяет версию по порядку: переменная `PYENV_VERSION`, файл `.python-version` в текущей папке и выше, глобальный `~/.pyenv/version` — и запускает соответствующий интерпретатор из `~/.pyenv/versions`.
</details>

<details><summary>Чем pyenv отличается от venv?</summary>

pyenv управляет **версиями интерпретатора** Python (3.10, 3.12). venv — изолированное окружение **пакетов** для проекта поверх конкретного интерпретатора. Обычно вместе: pyenv выбирает версию, venv на её основе держит зависимости проекта.
</details>

## Глубже
Что такое `PATH` и как программы находятся по имени — раздел «Процессы, сервисы, сеть». Версия Python в Docker-образе — курс «Docker».
