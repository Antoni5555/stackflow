"""Проверка контента курсов Python: эталоны задач и оформление уроков.

Запуск: python3 content/_tools/check_tasks.py [путь] [--quick]   (по умолчанию — content/backend)
Правила — docs/content-format.md, разделы 4–5.

Проверка идёт параллельно при SEEDS разных PYTHONHASHSEED: хеш строк в Python случаен
в каждом запуске, и пример, зависящий от него (порядок множества строк, совпадение ячеек
словаря), даёт разный вывод. Такие ошибки помечаются как нестабильные. --quick — один запуск.
"""
import concurrent.futures
import contextlib
import json
import linecache
import os
import subprocess
import tempfile
import difflib
import io
import re
import signal
import sys
import traceback
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
TIMEOUT = 2
H2_ORDER = ["Теория", "Наглядно", "На практике", "Частые ошибки", "Итог",
            "Вопросы на собеседовании", "Глубже", "Связанные темы"]
H2_REQUIRED = H2_ORDER[:6]
PSEUDO_GRAPHICS = re.compile(r"[─│┌┐└┘├┤►◄▼▲]")


# Задачи Python выполняет тот же runner.py, что и тренажёр на сайте («Разработка»):
# если эталон прошёл здесь, он пройдёт и у ученика.
sys.path.insert(0, str(ROOT.parent / "src" / "static" / "js" / "engines" / "python"))
import runner  # noqa: E402


def _alarm(signum, frame):
    raise TimeoutError(runner.TIMEOUT_MESSAGE)


signal.signal(signal.SIGALRM, _alarm)


@contextlib.contextmanager
def sandbox():
    """Каждая задача и урок — в своей пустой временной папке: файлы из примеров
    не попадают в репозиторий и не переходят из задачи в задачу."""
    old = os.getcwd()
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)
        try:
            yield tmp
        finally:
            os.chdir(old)


@contextlib.contextmanager
def guard():
    """Тайм-аут выполнения, как в тренажёре: зависшая программа — TimeoutError."""
    signal.alarm(TIMEOUT)
    try:
        yield
    finally:
        signal.alarm(0)


def execute(code, inputs="", override=None):
    return runner.execute(code, inputs, override, guard=guard)


def run_tests(code, task):
    """Сообщения fail непройденных тестов (print из функций ученика не мешает выводу проверки)."""
    with contextlib.redirect_stdout(io.StringIO()):
        _, _, failed = runner.run_tests(code, task, guard=guard)
    return failed


def check_quiz(task):
    problems, options, answer, kind = [], task.get("options") or [], task.get("answer"), task.get("kind")
    if kind not in ("single", "multiple", "order"):
        return [f"kind должен быть single, multiple или order, а не {kind!r}"]
    if len(options) < 2:
        problems.append("вариантов ответа меньше двух")
    if not isinstance(answer, list) or not all(isinstance(i, int) for i in answer):
        return problems + ["answer — список индексов (целых чисел)"]
    if any(i < 0 or i >= len(options) for i in answer):
        problems.append(f"индекс в answer вне options (вариантов {len(options)}, индексы с нуля)")
    if len(set(answer)) != len(answer):
        problems.append("индексы в answer повторяются")
    if kind == "single" and len(answer) != 1:
        problems.append("для single в answer ровно один индекс")
    if kind == "multiple" and not answer:
        problems.append("для multiple в answer хотя бы один индекс")
    if kind == "order" and sorted(answer) != list(range(len(options))):
        problems.append("для order в answer должны быть все индексы options")
    return problems


def failed_rules(files, rules):
    """Сообщения fail для правил, которые files не проходят (как на сайте: поиск по файлу, флаг m)."""
    failed = []
    for rule in rules:
        name = rule.get("file") or next(iter(files))
        text = files.get(name, "")
        if "must_match" in rule and not re.search(rule["must_match"], text, flags=re.M):
            failed.append(rule["fail"])
        if "must_not_match" in rule and re.search(rule["must_not_match"], text, flags=re.M):
            failed.append(rule["fail"])
    return failed


COMMENT = {".sql": "-- ", ".js": "// "}  # остальные файлы (nginx, Python, YAML, Dockerfile, bash) — "# "


def comment_out_changes(files, solution):
    """Эталон, в котором строки, отличающиеся от исходных файлов, закомментированы."""
    result, changed = {}, False
    for name, text in solution.items():
        marker = COMMENT.get(Path(name).suffix, "# ")
        old, new = files.get(name, "").splitlines(), text.splitlines()
        lines = list(new)
        for tag, _, _, j1, j2 in difflib.SequenceMatcher(None, old, new).get_opcodes():
            if tag in ("replace", "insert"):
                for j in range(j1, j2):
                    if lines[j].strip():
                        indent = len(lines[j]) - len(lines[j].lstrip())
                        lines[j] = lines[j][:indent] + marker + lines[j][indent:]
                        changed = True
        result[name] = "\n".join(lines) + "\n"
    return result, changed


def check_fix(task):
    problems = []
    files, solution = task.get("files") or {}, task.get("solution") or {}
    rules = (task.get("check") or {}).get("rules") or []
    if task.get("check", {}).get("type") != "rules":
        problems.append("check.type для fix — rules")
    if not files or not rules:
        return problems + ["нужны files и check.rules"]
    for rule in rules:
        kinds = [k for k in ("must_match", "must_not_match") if k in rule]
        if len(kinds) != 1:
            problems.append(f"в правиле должно быть ровно одно из must_match / must_not_match: {rule}")
            continue
        if "fail" not in rule:
            problems.append(f"у правила нет fail: {rule}")
        if "file" not in rule and len(files) > 1:
            problems.append(f"файлов несколько — у правила нужен file: {rule}")
        if rule.get("file", next(iter(files))) not in files:
            problems.append(f"файла {rule['file']!r} нет в files")
        try:
            re.compile(rule[kinds[0]])
        except re.error as e:
            problems.append(f"шаблон не компилируется: {rule[kinds[0]]!r}: {e}")
        if "(?P<" in rule[kinds[0]] or re.search(r"\\[AZ]|\(\?[aiLmsux]+\)", rule[kinds[0]]):
            problems.append(f"шаблон несовместим с JavaScript: {rule[kinds[0]]!r}")
    if problems:
        return problems
    if set(solution) != set(files):
        return problems + ["в solution должны быть те же файлы, что в files"]
    if fails := failed_rules(solution, rules):
        problems.append(f"эталон не проходит правила: {fails}")
    if not failed_rules(files, rules):
        problems.append("исходные файлы проходят все правила — задача ничего не проверяет")
    commented, changed = comment_out_changes(files, solution)
    if changed and not failed_rules(commented, rules):
        problems.append("закомментированный эталон проходит правила — начните шаблоны директив с ^\\s*")
    return problems


DOM_CHECKS = {"count", "min", "exists", "attr", "text", "style"}


def check_dom(task):
    """Вёрстка (exercise с check.type: dom). Стили и селекторы считает только браузер —
    здесь форма правил и правила по тексту файлов; эталон целиком — на /dev/html-check/."""
    problems = []
    files, solution = task.get("files") or {}, task.get("solution") or {}
    rules = task["check"].get("rules") or []
    if "index.html" not in files or not rules:
        return ["нужны files с index.html и check.rules"]
    if set(solution) != set(files):
        problems.append("в solution должны быть те же файлы, что в files")
    source_rules = []
    for n, rule in enumerate(rules, 1):
        if not rule.get("fail"):
            problems.append(f"правило {n}: нет fail")
        if "selector" in rule:
            if unknown := set(rule) - DOM_CHECKS - {"selector", "fail", "width"}:
                problems.append(f"правило {n}: неизвестные поля {sorted(unknown)}")
            if not set(rule) & DOM_CHECKS:
                problems.append(f"правило {n}: нечего проверять — нужен count, min, exists, attr, text или style")
            if rule.get("count") == 0:
                problems.append(f"правило {n}: «элементов нет» — exists: false, а не count: 0")
            if "exists" in rule and rule["exists"] is not False:
                problems.append(f"правило {n}: exists бывает только false (наличие проверяется и так)")
            for prop, value in (rule.get("style") or {}).items():
                value = str(value)
                if value.startswith("#") or value in ("bold", "normal", "bolder") or re.fullmatch(r"\d+(\.\d+)?(rem|em|%)", value):
                    problems.append(f"правило {n}: {prop}: {value!r} — браузер отдаёт rgb(…), px и 700/400")
            patterns = list((rule.get("attr") or {}).values()) + ([rule["text"]] if "text" in rule else [])
        else:
            kinds = [k for k in ("must_match", "must_not_match") if k in rule]
            if len(kinds) != 1:
                problems.append(f"правило {n}: нужен selector или ровно одно из must_match / must_not_match")
                continue
            if rule.get("file", "index.html") not in files:
                problems.append(f"правило {n}: файла {rule['file']!r} нет в files")
            patterns = [rule[kinds[0]]]
            source_rules.append({**rule, "file": rule.get("file", "index.html")})
        for pattern in patterns:
            try:
                re.compile(pattern)
            except re.error as e:
                problems.append(f"правило {n}: шаблон не компилируется: {pattern!r}: {e}")
            if "(?P<" in pattern or re.search(r"\\[AZ]|\(\?[aiLmsux]+\)", pattern):
                problems.append(f"правило {n}: шаблон несовместим с JavaScript: {pattern!r}")
    if not problems and (fails := failed_rules(solution, source_rules)):
        problems.append(f"эталон не проходит правила по тексту: {fails}")
    return problems


# Команды симулятора Linux/Git и их флаги (docs/content-format.md, «exercise с проверкой состояния»).
# None — флаги не поддерживаются; набор — разрешённые флаги.
LINUX_COMMANDS = {
    "pwd": None, "cd": None, "ls": {"-l", "-a"}, "cat": None, "echo": None, "mkdir": {"-p"},
    "touch": None, "rm": {"-r"}, "cp": {"-r"}, "mv": None, "ln": {"-s"}, "head": {"-n"}, "tail": {"-n"},
    "wc": {"-l"}, "grep": {"-i", "-n", "-r", "-c", "-v"}, "sort": {"-n", "-r"}, "uniq": {"-c"},
    "cut": {"-d", "-f"}, "find": {"-name", "-type", "-size", "-mtime"}, "tar": {"-c", "-x", "-z", "-f"},
    "chmod": None, "chown": {"-R"},
    "whoami": None, "id": None, "chgrp": {"-R"}, "which": None, "df": {"-h"}, "du": {"-s", "-h"},
    "gzip": None, "gunzip": None,
}
GIT_COMMANDS = {
    "init": None, "config": {"--global", "--list"}, "status": None, "add": {"-A"}, "rm": {"--cached", "-r"},
    "commit": {"-m", "--amend", "--no-edit"}, "log": {"--oneline", "--graph", "--all", "-n", "-S", "--grep"},
    "diff": {"--staged"}, "restore": {"--staged"}, "branch": {"-d", "-D", "-a"}, "switch": {"-c"},
    "checkout": None, "merge": {"--abort", "--no-ff"}, "reset": {"--soft", "--mixed", "--hard"}, "revert": None,
    "cherry-pick": None, "tag": None, "stash": None, "reflog": None, "blame": None,
    "rebase": {"--continue", "--abort"}, "remote": {"-v"}, "push": {"-u"}, "clone": None, "fetch": None,
    "pull": {"--no-rebase", "--rebase"},
}
GIT_SUBCOMMANDS = {"stash": {"push", "list", "pop", "apply", "drop"}, "remote": {"add"}}
PIP_COMMANDS = {"install": {"-r"}, "freeze": None, "uninstall": {"-y"}, "list": None}
STATE_RULES = {  # ключ, по которому узнаём правило → какие ещё ключи обязательны
    "exists": {"path"}, "contains": {"path"}, "mode": {"path"}, "owner": {"path"}, "link_to": {"path"},
    "output_matches": set(),
    "head": set(), "commit_in": set(), "commit_count": set(), "clean": set(), "merged": set(),
    "pushed": set(), "config": set(), "stash_count": set(), "pip_package": set(),
}
GIT_SUBJECTS = ("branch", "tag", "tracked", "staged")  # «есть», с exists: false — «нет»


def check_command(line):
    """Проблемы одной строки solution: неизвестные команды и флаги."""
    problems = []
    line_wo_strings = re.sub(r"\"[^\"]*\"|'[^']*'", "STR", line)   # текст в кавычках — не флаги
    for part in re.split(r"\|\|?|&&", line_wo_strings):
        part = re.split(r"\d?>>?", part)[0]       # перенаправление (>, >>, 2>, 2>&1): дальше — цель
        tokens = part.split()
        while tokens and (tokens[0] == "sudo" or re.fullmatch(r"[A-Za-z_]\w*=\S*", tokens[0])):
            tokens = tokens[1:]                  # sudo и присваивание NAME=x перед командой
        if not tokens or tokens[0].startswith("./"):
            continue                             # ./script.sh — свой скрипт
        if tokens[0] == "nano":
            problems.append(f"nano в solution не выполнить — пишем файл через echo > / >>: {line!r}")
            continue
        if "--help" in tokens:
            continue                             # --help есть у всех команд
        if tokens[0] == "git":
            if len(tokens) < 2 or tokens[1] not in GIT_COMMANDS:
                problems.append(f"команды git {tokens[1] if len(tokens) > 1 else ''!s} нет в симуляторе: {line!r}")
                continue
            allowed, flags = GIT_COMMANDS[tokens[1]], tokens[2:]
            sub = next((t for t in flags if not t.startswith("-")), None)
            if tokens[1] in GIT_SUBCOMMANDS and sub and sub not in GIT_SUBCOMMANDS[tokens[1]]:
                problems.append(f"git {tokens[1]} {sub} нет в симуляторе: {line!r}")
            if tokens[1] == "commit" and "-m" not in flags and "--no-edit" not in flags:
                problems.append(f"редактора в симуляторе нет — commit с -m или --amend --no-edit: {line!r}")
            if tokens[1] == "rebase" and "-i" in flags:
                problems.append(f"rebase -i симулятор не поддерживает: {line!r}")
                continue
        elif tokens[0] == "pip":
            if len(tokens) < 2 or tokens[1] not in PIP_COMMANDS:
                problems.append(f"команды pip {tokens[1] if len(tokens) > 1 else ''!s} нет в симуляторе: {line!r}")
                continue
            allowed, flags = PIP_COMMANDS[tokens[1]], tokens[2:]
        elif tokens[0] == "python3":
            if tokens[1:3] != ["-m", "venv"] or len(tokens) != 4:
                problems.append(f"Python в симуляторе не выполняется — только python3 -m venv <папка>: {line!r}")
            continue
        elif tokens[0] in ("source", "deactivate"):
            continue
        elif tokens[0] == "apt":
            if tokens[1:2] != ["install"]:
                problems.append(f"из apt в симуляторе только sudo apt install: {line!r}")
            continue
        elif tokens[0] in LINUX_COMMANDS:
            allowed, flags = LINUX_COMMANDS[tokens[0]], tokens[1:]
        else:
            problems.append(f"команды {tokens[0]!r} нет в симуляторе: {line!r}")
            continue
        for flag in (t for t in flags if t.startswith("-") and not re.fullmatch(r"[-+]?\d+[KMG]?", t)):
            flag = flag.split("=")[0]           # --grep=текст
            letters = [flag] if flag.startswith("--") or len(flag) == 2 else [f"-{c}" for c in flag[1:]]
            if flag in (allowed or set()):
                continue
            if any(flag.startswith(v) and v in (allowed or set()) for v in ("-n", "-d", "-f", "-S", "-m")):
                continue                        # значение слитно с флагом: -n20, -d, -f1, -Sdiscount
            if any(f not in (allowed or set()) for f in letters):
                problems.append(f"флаг {flag} у {' '.join(tokens[:2]) if tokens[0] in ('git', 'pip') else tokens[0]} не поддерживается симулятором: {line!r}")
    return problems


def check_state(task):
    problems = []
    setup, rules = task.get("setup") or {}, (task.get("check") or {}).get("expect") or []
    unknown = set(setup) - {"cwd", "files", "dirs", "repo", "commits", "head", "remote", "venv", "gitconfig"}
    if unknown:
        problems.append(f"неизвестные ключи setup: {sorted(unknown)}")
    if "cwd" in setup and not str(setup["cwd"]).startswith("/"):
        problems.append("setup.cwd — абсолютный путь")
    dirs = setup.get("dirs") or []
    dir_items = []                      # (путь, настройки) — элемент: путь или {путь: {owner, mode}}
    for item in (dirs.items() if isinstance(dirs, dict) else dirs):
        if isinstance(item, tuple):
            dir_items.append(item)
        elif isinstance(item, dict) and len(item) == 1:
            dir_items.append(next(iter(item.items())))
        elif isinstance(item, str):
            dir_items.append((item, {}))
        else:
            problems.append(f"папка в setup.dirs — путь или {{путь: {{owner, mode}}}}: {item!r}")
    for path, value in dir_items:
        if not isinstance(value, dict) or set(value) - {"owner", "mode"}:
            problems.append(f"папка {path}: настройки — словарь с owner/mode")
        elif "mode" in value and not (isinstance(value["mode"], str) and re.fullmatch(r"[0-7]{3}", value["mode"])):
            problems.append(f"mode папки {path} — три цифры строкой")
    for path in list((setup.get("files") or {})) + [p for p, _ in dir_items]:
        if not str(path).startswith("/"):
            problems.append(f"путь в setup не абсолютный: {path!r}")
    file_keys = {"content", "size", "owner", "mode", "mtime"}
    for path, value in (setup.get("files") or {}).items():
        if isinstance(value, dict):
            if set(value) - file_keys:
                problems.append(f"у файла {path} неизвестные ключи: {sorted(set(value) - file_keys)}")
            if "content" in value and "size" in value:
                problems.append(f"у файла {path} либо content, либо size")
            if "size" in value and not re.fullmatch(r"\d+[KMG]?", str(value["size"])):
                problems.append(f"размер файла {path} — число с K, M или G: {value['size']!r}")
            if "mode" in value and not (isinstance(value["mode"], str) and re.fullmatch(r"[0-7]{3}", value["mode"])):
                problems.append(f"mode файла {path} — три цифры строкой")
        elif not isinstance(value, str):
            problems.append(f"файл {path}: текст или словарь content/size, owner, mode")
    remote = setup.get("remote")
    if remote is not None and (not isinstance(remote, dict) or set(remote) - {"url", "commits", "pushed"}):
        problems.append("setup.remote — словарь с url, commits, pushed")
    for commit in (setup.get("commits") or []) + ((remote or {}).get("commits") or [] if isinstance(remote, dict) else []):
        if not isinstance(commit, dict) or "message" not in commit:
            problems.append(f"у коммита в setup нужен message: {commit!r}")
        elif set(commit) - {"message", "branch", "from", "files"}:
            problems.append(f"у коммита неизвестные ключи: {sorted(set(commit) - {'message', 'branch', 'from', 'files'})}")
        else:
            for path, text in (commit.get("files") or {}).items():
                if str(path).startswith("/"):
                    problems.append(f"путь в коммите — от корня репозитория, не абсолютный: {path!r}")
                if text is not None and not isinstance(text, str):
                    problems.append(f"файл {path} в коммите: текст или null (удалён)")
    gitconfig = setup.get("gitconfig", {})
    if gitconfig is not None and not isinstance(gitconfig, dict):
        problems.append("setup.gitconfig — словарь {user.name: …, user.email: …} или null")
    venv = setup.get("venv")
    if venv is not None and (not isinstance(venv, dict) or set(venv) - {"path", "packages"}):
        problems.append("setup.venv — словарь с path и packages")
    if not rules:
        problems.append("нет правил check.expect")
    for rule in rules:
        kinds = [k for k in STATE_RULES if k in rule] + [k for k in GIT_SUBJECTS if k in rule]
        if "exists" in kinds and set(kinds) & set(GIT_SUBJECTS):
            kinds.remove("exists")
            if not isinstance(rule["exists"], bool):
                problems.append(f"exists — true или false: {rule}")
        if len(kinds) != 1:
            problems.append(f"в правиле должен быть ровно один вид проверки: {rule}")
            continue
        kind = kinds[0]
        if "fail" not in rule:
            problems.append(f"у правила нет fail: {rule}")
        if kind == "exists" and "path" not in rule:
            problems.append(f"exists проверяет path, branch, tag, tracked или staged: {rule}")
        if kind in ("tracked", "staged") and str(rule[kind]).startswith("/"):
            problems.append(f"{kind} — путь от корня репозитория: {rule}")
        if kind == "commit_count" and not {"branch", "count"} <= set(rule["commit_count"] or {}):
            problems.append(f"commit_count требует branch и count: {rule}")
        if kind == "config" and not {"key", "value"} <= set(rule["config"] or {}):
            problems.append(f"config требует key и value: {rule}")
        if kind == "pip_package" and "name" not in (rule["pip_package"] or {}):
            problems.append(f"pip_package требует name: {rule}")
        if kind in ("contains", "mode") and "path" not in rule:
            problems.append(f"{kind} требует path: {rule}")
        if kind == "mode" and not (isinstance(rule["mode"], str) and re.fullmatch(r"[0-7]{3}", rule["mode"])):
            problems.append(f"mode — три восьмеричные цифры строкой, например '644': {rule}")
        if kind == "commit_in" and not {"branch", "message"} <= set(rule["commit_in"] or {}):
            problems.append(f"commit_in требует branch и message: {rule}")
        if kind == "merged" and not {"from", "into"} <= set(rule["merged"] or {}):
            problems.append(f"merged требует from и into: {rule}")
        for pattern in (rule.get("contains"), rule.get("output_matches"), (rule.get("commit_in") or {}).get("message"),
                        (rule.get("config") or {}).get("value")):
            if pattern is None:
                continue
            try:
                re.compile(pattern)
            except re.error as e:
                problems.append(f"шаблон не компилируется: {pattern!r}: {e}")
    lines = [l.strip() for l in (task.get("solution") or "").splitlines() if l.strip()]
    if not lines:
        problems.append("нет solution — команды по одной на строку")
    for line in lines:
        problems += check_command(line)
    return problems


def course_engine(path):
    """engine курса, в папке которого лежит файл (по ближайшему _course.yaml)."""
    for folder in path.parents:
        if (folder / "_course.yaml").exists():
            return (yaml.safe_load((folder / "_course.yaml").read_text()) or {}).get("engine")
    return None


def select_columns(sql):
    """Элементы списка SELECT основного запроса (последней инструкции): первый SELECT вне скобок."""
    sql = re.sub(r"--[^\n]*", "", sql)
    sql = re.sub(r"'(?:[^']|'')*'", "''", sql)              # строки не мешают разбору
    statement = [part for part in sql.split(";") if part.strip()][-1]
    depth, start, items, current = 0, None, [], ""
    for match in re.finditer(r"\(|\)|,|\bselect\b|\bfrom\b|\b(?:union|intersect|except)\b|[^(),\w]+|\w+", statement, re.I):
        token = match.group()
        if token == "(":
            depth += 1
        elif token == ")":
            depth -= 1
        if depth == 0 and start is None:
            if token.lower() == "select":
                start = True
            continue
        if start is None:
            continue
        if depth == 0 and re.fullmatch(r"from|union|intersect|except", token, re.I):
            break
        if depth == 0 and token == ",":
            items.append(current.strip())
            current = ""
        else:
            current += token
    items.append(current.strip())
    items[0] = re.sub(r"^distinct(\s+on\s*\(.*?\))?\s*", "", items[0], flags=re.I)
    return [i for i in items if i]


def check_sql(task):
    """Форма SQL-задачи. Сам эталон в PGlite прогоняет тест сайта."""
    problems = []
    check = task.get("check") or {}
    if check.get("type") not in ("result", "state", "schema"):
        return [f"check.type у SQL-задачи — result, state или schema: {check.get('type')!r}"]
    if not (task.get("solution") or "").strip():
        problems.append("нет solution")
    elif re.search(r"\bnow\(\)|current_date|current_timestamp", task["solution"], re.I):
        problems.append("в solution now()/current_date — ответ зависит от дня запуска; даты — строкой")
    if "setup" in task and not isinstance(task["setup"], str):
        problems.append("setup — SQL строкой (setup: |)")
    if "starter_code" in task and not isinstance(task["starter_code"], str):
        problems.append("starter_code — SQL строкой (starter_code: |)")
    if check["type"] == "result" and (task.get("solution") or "").strip():
        for item in select_columns(task["solution"]):
            if re.fullmatch(r"(\w+\.)?(\w+|\*)", item):
                continue                       # простая колонка: имя — её собственное
            alias = re.search(r"\bas\s+(\w+|\"[^\"]+\")$", item, re.I)
            if not alias:
                problems.append(f"выражению в SELECT нужно имя через AS — иначе ученик не угадает колонку: {item!r}")
            elif alias.group(1).strip('"') not in task.get("statement", ""):
                problems.append(f"имя колонки {alias.group(1)!r} не названо в условии")
    changes = {"state": r"\b(insert|update|delete|truncate|merge)\b", "schema": r"\b(create|alter|drop)\b"}
    if check["type"] in changes and not re.search(changes[check["type"]], task.get("solution") or "", re.I):
        problems.append(f"эталон {check['type']} ничего не меняет в базе — нужен "
                        + ("INSERT/UPDATE/DELETE" if check["type"] == "state" else "CREATE/ALTER/DROP"))
    if check["type"] == "result":
        if not isinstance(check.get("order_matters"), bool):
            problems.append("у result нужен order_matters: true/false")
        if unknown := set(check) - {"type", "order_matters"}:
            problems.append(f"неизвестные ключи check: {sorted(unknown)}")
    else:
        tables = check.get("tables")
        if not tables or not isinstance(tables, (list, dict)):
            problems.append(f"у {check['type']} нужен tables: [таблица, …] или {{таблица: [колонки]}}")
        elif isinstance(tables, dict) and (check["type"] == "schema" or
                                           not all(isinstance(v, list) and v for v in tables.values())):
            problems.append("tables словарём — только у state, значения — списки колонок")
        if unknown := set(check) - {"type", "tables"}:
            problems.append(f"неизвестные ключи check: {sorted(unknown)}")
    return problems


def check_task(path):
    with sandbox():
        return _check_task(path)


def _check_task(path):
    try:
        task = yaml.safe_load(path.read_text())
    except yaml.YAMLError as e:
        return [f"YAML не читается: {e}"]
    problems = []

    def walk(value):
        if isinstance(value, dict):
            for v in value.values():
                yield from walk(v)
        elif isinstance(value, list):
            for v in value:
                yield from walk(v)
        elif isinstance(value, str):
            yield value

    for value in walk({k: v for k, v in task.items() if k not in ("starter_code", "solution", "code", "inputs")}):
        if '\\"' in value and "assert" not in value:
            problems.append(f"буквальный \\\" в тексте (нужны кавычки в YAML): {value[:60]!r}")
    for key in ("title", "type", "difficulty", "pitfall", "statement", "explanation"):
        if key not in task:
            problems.append(f"нет поля {key}")
    if task["type"] == "exercise" and course_engine(path) == "sql":
        problems += check_sql(task)
    elif task["type"] == "exercise" and (task.get("check") or {}).get("type") == "state":
        problems += check_state(task)
    elif task["type"] == "exercise" and (task.get("check") or {}).get("type") == "dom":
        problems += check_dom(task)
    elif task["type"] == "exercise":
        if fails := run_tests(task["solution"], task):
            problems.append(f"эталон не проходит: {fails}")
        if not run_tests(task["starter_code"], task):
            problems.append("заготовка проходит все тесты — задача ничего не проверяет")
    elif task["type"] == "quiz":
        problems += check_quiz(task)
    elif task["type"] == "fix":
        problems += check_fix(task)
    elif task["type"] == "predict":
        with guard():
            result = runner.check_predict(task["code"], task["answer"])
        if not result["correct"]:
            problems.append(f"ответ не совпадает с выводом (как сравнивает сайт):\n{result['actual']!r}\n{task['answer']!r}")
    return problems


def fenced_blocks(text):
    """Блоки кода урока: (язык, код, строка перед блоком)."""
    blocks, lines, i = [], text.splitlines(), 0
    while i < len(lines):
        if lines[i].startswith("```"):
            lang = lines[i][3:].strip()
            prev = next((l for l in reversed(lines[:i]) if l.strip()), "")
            j = i + 1
            while not lines[j].startswith("```"):
                j += 1
            blocks.append((lang, "\n".join(lines[i + 1:j]), prev))
            i = j
        i += 1
    return blocks


FILE_CAPTION = re.compile(r"Файл `([\w./-]+)`")


def check_lesson_code(text):
    """Выполнить блоки ```python по порядку, как одну программу ученика, и сверить
    с блоками «Результат:». Правила — как у runner.py: пустая рабочая папка,
    __name__ == "__main__", вывод = stdout + stderr, сброшенный logging.
    Блок с подписью «Файл `имя`:» не выполняется, а записывается в этот файл."""
    with runner.workdir():
        runner.reset_logging()
        return _check_lesson_code(text)


def _check_lesson_code(text):
    problems, ns = [], {"__name__": "__main__"}
    blocks = fenced_blocks(text)
    buf = io.StringIO()   # один поток на весь урок: обработчики logging из ранних блоков пишут сюда же
    for k, (lang, code, caption) in enumerate(blocks):
        if (m := FILE_CAPTION.search(caption)) and lang in ("python", "text", "csv", "json", "ini", ""):
            Path(m.group(1)).parent.mkdir(parents=True, exist_ok=True)
            Path(m.group(1)).write_text(code + "\n", encoding="utf-8")
            continue
        if lang != "python":
            continue
        expected = None
        if k + 1 < len(blocks) and blocks[k + 1][0] == "" and blocks[k + 1][2].startswith("Результат"):
            expected = blocks[k + 1][1]
        start = buf.tell()
        error = None
        signal.alarm(TIMEOUT)
        try:
            # текст блока — в linecache: traceback показывает строки кода, как в терминале
            linecache.cache["main.py"] = (len(code), None, code.splitlines(True), "main.py")
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                exec(compile(code, "main.py", "exec"), ns)
        except BaseException as e:  # noqa: BLE001
            error = traceback.format_exception(e)[-1].rstrip("\n")
        finally:
            signal.alarm(0)
        actual = buf.getvalue()[start:].rstrip("\n")
        first = code.splitlines()[0][:50]
        if expected is None:
            if error:
                problems.append(f"пример «{first}» упал без блока «Результат:»: {error}")
            continue
        exp_lines = expected.splitlines() or [""]
        markers = [n for n, l in enumerate(exp_lines) if l.startswith("Traceback") or l.startswith('  File "')]
        looks_like_error = bool(re.fullmatch(r"[\w.]+(Error|Exception|Iteration|Exit|Interrupt)(: .*)?", exp_lines[-1]))
        if error is not None and (markers or looks_like_error):
            exp_out = "\n".join(exp_lines[:markers[0]] if markers else exp_lines[:-1])
            if error != exp_lines[-1]:
                problems.append(f"пример «{first}»: ожидалась ошибка {exp_lines[-1]!r}, получено {error!r}")
            if actual != exp_out:
                problems.append(f"пример «{first}»: вывод до ошибки {actual!r} ≠ {exp_out!r}")
        else:
            if error:
                problems.append(f"пример «{first}» упал: {error}")
            elif actual != expected.rstrip("\n"):
                problems.append(f"пример «{first}»: вывод {actual!r} ≠ ожидаемому {expected!r}")
    return problems


def check_lesson(path):
    with sandbox():
        return _check_lesson(path)


def _check_lesson(path):
    text = path.read_text()
    problems = []
    h2 = re.findall(r"^## (.+)$", text, flags=re.M)
    if [h for h in h2 if h not in H2_ORDER]:
        problems.append(f"лишние заголовки H2: {[h for h in h2 if h not in H2_ORDER]}")
    if [h for h in h2 if h in H2_ORDER] != sorted([h for h in h2 if h in H2_ORDER], key=H2_ORDER.index):
        problems.append(f"порядок H2 нарушен: {h2}")
    if missing := [h for h in H2_REQUIRED if h not in h2]:
        problems.append(f"нет обязательных блоков: {missing}")
    if PSEUDO_GRAPHICS.search(text):
        problems.append("псевдографика в тексте — нужен SVG")

    lines = text.splitlines()
    in_code = False
    for i, line in enumerate(lines):
        if line.startswith("```"):
            if not in_code:
                prev = next((l for l in reversed(lines[:i]) if l.strip()), "")
                if not (prev.rstrip().endswith(":") or prev.startswith("Результат")):
                    problems.append(f"строка {i + 1}: блок кода без пояснения перед ним")
            in_code = not in_code
            continue
        if in_code:
            continue
        prev = next((l for l in reversed(lines[:i]) if l.strip()), "")
        if line.startswith("|---") or (line.startswith("|") and i + 1 < len(lines) and lines[i + 1].startswith("|---")):
            if line.startswith("|") and not prev.startswith("|") and not prev.startswith("**Таблица"):
                problems.append(f"строка {i + 1}: таблица без подписи «**Таблица N.**»")
        if line.startswith("![") and not prev.startswith("**Рисунок"):
            problems.append(f"строка {i + 1}: рисунок без подписи «**Рисунок N.**»")
        if line.startswith("![") and (m := re.search(r"\]\((.+?)\)", line)):
            if not (path.parent / m.group(1)).exists():
                problems.append(f"строка {i + 1}: нет файла {m.group(1)}")
    problems += check_lesson_code(text)
    return problems


def check_practice(path):
    with sandbox():
        return _check_practice(path)


def _check_practice(path):
    """Задачник темы: список {title, text, answer, hint?}. Код условия и ответа
    выполняется как одна программа: ответ может опираться на данные из условия."""
    try:
        items = yaml.safe_load(path.read_text())
    except yaml.YAMLError as e:
        return [f"YAML не читается: {e}"]
    if not isinstance(items, list) or not items:
        return ["задачник — непустой список задач"]
    problems = []
    for n, item in enumerate(items, 1):
        if not isinstance(item, dict):
            problems.append(f"задача {n}: нужен словарь title/text/answer")
            continue
        if missing := [k for k in ("title", "text", "answer") if not item.get(k)]:
            problems.append(f"задача {n}: нет полей {missing}")
            continue
        if extra := set(item) - {"title", "text", "answer", "hint"}:
            problems.append(f"задача {n}: лишние поля {sorted(extra)}")
        for problem in check_lesson_code(item["text"] + "\n\n" + item["answer"]):
            problems.append(f"задача {n} «{item['title']}»: {problem}")
    return problems


SEEDS = 16


def collect(base):
    """{файл: [проблемы]} для одного запуска интерпретатора."""
    results = {}
    for path in sorted(base.rglob("*")):
        if path.name == "_practice.yaml":
            results[str(path.relative_to(base) if path.is_relative_to(base) else path)] = check_practice(path)
            continue
        if path.name.startswith("_") or path.parent.name == "img":
            continue
        if path.suffix == ".yaml":
            problems = check_task(path)
        elif path.suffix == ".md":
            problems = check_lesson(path)
        else:
            continue
        results[str(path.relative_to(base) if path.is_relative_to(base) else path)] = problems
    return results


def run_seed(base, seed):
    env = {**os.environ, "PYTHONHASHSEED": str(seed)}
    proc = subprocess.run([sys.executable, __file__, str(base), "--json"],
                          capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr)
    return json.loads(proc.stdout)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    base = Path(args[0]).resolve() if args else ROOT / "backend"
    if "--json" in sys.argv:
        print(json.dumps(collect(base), ensure_ascii=False))
        return
    if "--quick" in sys.argv:
        runs = [collect(base)]
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=os.cpu_count()) as pool:
            runs = list(pool.map(lambda seed: run_seed(base, seed), range(SEEDS)))
    bad = 0
    for name in runs[0]:
        counts = {}
        for run in runs:
            for problem in run.get(name, []):
                counts[problem] = counts.get(problem, 0) + 1
        if not counts:
            continue
        bad += 1
        print(f"✗ {name}")
        for problem, n in counts.items():
            note = "" if n == len(runs) else f"  [нестабильно: в {n} из {len(runs)} запусков — зависит от хеша строк?]"
            print(f"    {problem}{note}")
    print(f"\nПроверено файлов: {len(runs[0])}, с ошибками: {bad}, запусков: {len(runs)}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
