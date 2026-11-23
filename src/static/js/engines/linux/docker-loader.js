// Учебный Docker (engines/docker) — тяжёлый модуль, нужен только курсу Docker. Грузится
// по требованию: перед первой строкой со словом docker или перед задачей с docker в
// setup и правилах. Страницы, где docker не нужен, его не скачивают.

let loading = null;
let loaded = false;

/** Нужен ли Docker, чтобы выполнить эту строку терминала. */
export const lineNeedsDocker = (line) => !loaded && /(^|[\s;&|(`$])docker(\s|$)/.test(line);

/** Нужен ли Docker задаче: docker в setup или в правилах проверки. */
export function taskNeedsDocker(setup = {}, rules = []) {
  return Boolean(setup?.docker) || (rules ?? []).some((rule) => rule && 'docker' in rule);
}

/** Загрузить модуль Docker (один раз). */
export function loadDocker() {
  loading ??= import('../docker/index.js').then((module) => {
    loaded = true;
    return module;
  });
  return loading;
}
