// Проверка эталонов задач на вёрстку для pytest (tests/test_html_tasks.py).
// stdin: JSON {tasks: [{name, files, solution, rules}]} → stdout: {name: [проблемы]}.
// Стили считает только браузер, поэтому задачи идут в Chromium без окна (Playwright)
// через тот же код, что на сайте: engines/html/checker.js и preview.js.

import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const STATIC = fileURLToPath(new URL('../../src/static/', import.meta.url));
// Адрес выдуманный: запросы к нему отвечает route ниже, сети нет
const ORIGIN = 'http://html-check.test';
const PAGE = '<!doctype html><meta charset="utf-8">'
  + '<iframe sandbox="allow-same-origin" style="border:0;width:100%;height:600px"></iframe>';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css' };

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  const { tasks } = JSON.parse(input);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route(`${ORIGIN}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith('/static/')) {
        await route.fulfill({ contentType: 'text/html', body: PAGE });
        return;
      }
      // картинки из условий задач (<img src="...">) — 404, как на сайте, если файла нет
      const file = normalize(join(STATIC, path.slice('/static/'.length)));
      const body = file.startsWith(STATIC) ? await readFile(file).catch(() => null) : null;
      if (body === null) {
        await route.fulfill({ status: 404 });
        return;
      }
      await route.fulfill({ contentType: TYPES[extname(file)] ?? 'text/plain', body });
    });
    await page.goto(`${ORIGIN}/`);
    const result = await page.evaluate(async (list) => {
      const { verifyHtmlTask } = await import('/static/js/engines/html/checker.js');
      const { HtmlPreview } = await import('/static/js/engines/html/preview.js');
      const preview = new HtmlPreview(document.querySelector('iframe'));
      const found = {};
      for (const task of list) found[task.name] = await verifyHtmlTask(task, preview);
      return found;
    }, tasks);
    process.stdout.write(JSON.stringify(result));
  } finally {
    await browser.close();
  }
});
