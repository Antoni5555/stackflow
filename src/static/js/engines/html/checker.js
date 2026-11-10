// Правила проверки вёрстки (check.type: dom). Формат — docs/content-format.md.
// Регулярки ищутся в тексте (флаг m: ^ и $ — границы строк), как re.search(..., re.M).

import { failedSourceRule, search } from '../../source-rules.js';

// Правила без width проверяются на ширине ПК — у всех учеников одинаково,
// какой бы ни была ширина их экрана
const CHECK_WIDTH = 1024;

/** Правило по готовой странице: true — не пройдено. */
function failedDomRule(rule, doc) {
  let elements;
  try {
    elements = [...doc.querySelectorAll(rule.selector)];
  } catch (e) {
    console.error('Неверный селектор в задаче:', rule.selector);
    return true;
  }
  if (rule.exists === false) return elements.length > 0;
  if ('count' in rule && elements.length !== rule.count) return true;
  if ('min' in rule && elements.length < rule.min) return true;
  if (!elements.length) return true;

  const view = doc.defaultView;
  return elements.some((element) => {
    for (const [name, pattern] of Object.entries(rule.attr || {})) {
      const value = element.getAttribute(name);
      if (value === null || !search(pattern, value)) return true;
    }
    if ('text' in rule && !search(rule.text, element.textContent.trim())) return true;
    for (const [property, expected] of Object.entries(rule.style || {})) {
      const actual = view.getComputedStyle(element).getPropertyValue(property).trim();
      if (actual !== String(expected)) return true;
    }
    return false;
  });
}

/**
 * Первое непройденное правило задачи или null.
 * preview — HtmlPreview с уже отрисованными files; правило с width проверяется
 * на этой ширине предпросмотра, после проверки ширина возвращается.
 */
export function firstFailedRule(rules, files, preview) {
  const width = preview.iframe.style.width;
  try {
    return rules.find((rule) => {
      const source = failedSourceRule(rule, files, 'index.html');
      if (source !== null) return source;
      preview.setWidth(rule.width ?? CHECK_WIDTH);
      return failedDomRule(rule, preview.document);
    }) ?? null;
  } finally {
    preview.iframe.style.width = width;
  }
}
