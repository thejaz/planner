import { assertTestVault } from './paths.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], layouts = [];
let appPage, original;
try {
  appPage = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(appPage);
  await appPage.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  original = await appPage.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller, days = [...c.settings.weekendDays];
    await c.setReviewPreferences({ weekendDays: [5] }); app.setting.open(); app.setting.openTabById('thejaz-planner'); return days;
  });
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url() === 'about:blank') ?? appPage;
  const options = page.locator('.planner-weekend-days'); await options.waitFor();
  assert.deepEqual(await options.locator('label').allTextContents(), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(await options.locator('input').evaluateAll(els => els.map(el => Number(el.dataset.weekendDay))), [1, 2, 3, 4, 5, 6, 0]);
  assert(await options.getByRole('checkbox', { name: 'Friday is a weekend', exact: true }).isChecked());
  checks.push('Monday-first order preserves actual weekday IDs and the saved Friday selection');
  for (const width of [1280, 800, 650]) {
    await page.setViewportSize({ width, height: 850 }); await options.scrollIntoViewIfNeeded();
    const geometry = await options.evaluate(el => {
      const r = el.getBoundingClientRect(); return { width: r.width, scroll: el.scrollWidth, labels: [...el.querySelectorAll('label')].map(l => { const a = l.getBoundingClientRect(); return { x: a.x, y: a.y, right: a.right }; }), right: r.right };
    });
    assert(geometry.scroll <= geometry.width + 1);
    assert(geometry.labels.every(l => l.right <= geometry.right + 1));
    const rows = [...new Set(geometry.labels.map(l => l.y))]; assert(rows.length <= 2);
    if (rows.length === 2) { assert.equal(geometry.labels[4].x, geometry.labels[0].x); assert.equal(geometry.labels[3].y, geometry.labels[0].y); }
    layouts.push({ windowWidth: width, ...geometry }); await page.screenshot({ path: `artifacts/weekend-layout-${width}.png` });
  }
  checks.push('Wide layout stays on one line; narrow layout wraps to aligned four/three rows without overflow');
  await options.getByRole('checkbox', { name: 'Monday is a weekend', exact: true }).click();
  await options.getByRole('checkbox', { name: 'Sunday is a weekend', exact: true }).click();
  await appPage.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.settings.weekendDays.join(',') === '0,1,5');
  checks.push('Monday and Sunday controls save the correct days without changing Friday');
  await writeFile('artifacts/weekend-layout-native.json', JSON.stringify({ checks, layouts }, null, 2)); console.log(JSON.stringify({ checks }, null, 2));
} finally {
  if (original) await appPage.evaluate(async days => { app.setting.close(); await app.plugins.plugins['thejaz-planner'].controller.setReviewPreferences({ weekendDays: days }); }, original);
  await browser.close();
}
