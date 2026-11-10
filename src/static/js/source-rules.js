// Правила по тексту файла: must_match — шаблон обязан найтись, must_not_match — не должен.
// Флаг m: ^ и $ — границы строк, как re.search(..., re.M) в Python. Задачи fix и html.

export const search = (pattern, text) => new RegExp(pattern, 'm').test(text);

/** true — правило не пройдено, false — пройдено, null — это не правило по тексту. */
export function failedSourceRule(rule, files, defaultFile) {
  if (!('must_match' in rule) && !('must_not_match' in rule)) return null;
  const text = files[rule.file || defaultFile] ?? '';
  return 'must_match' in rule ? !search(rule.must_match, text) : search(rule.must_not_match, text);
}
