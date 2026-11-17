// Полоса вкладок шире экрана (телефон) прокручивается вбок — выбранная вкладка
// должна быть видна целиком, а не обрезана краем. Только по горизонтали:
// страница при этом не прыгает.

/** Прокрутить полосу вкладок так, чтобы tab был виден. */
export function revealTab(tab) {
  const strip = tab?.closest('.tabs');
  if (!strip || strip.scrollWidth <= strip.clientWidth) return;
  const left = tab.offsetLeft - strip.offsetLeft;
  const right = left + tab.offsetWidth;
  if (left < strip.scrollLeft) strip.scrollLeft = left - 8;
  else if (right > strip.scrollLeft + strip.clientWidth) {
    strip.scrollLeft = right - strip.clientWidth + 8;
  }
}

/** Все полосы на странице — к своей выбранной вкладке (её отмечает сервер). */
export function revealActiveTabs(root = document) {
  for (const tab of root.querySelectorAll('.tabs .tab--active')) revealTab(tab);
}
