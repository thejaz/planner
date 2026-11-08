import { assertTestVault } from './paths.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], layouts = [], errors = [];
let appPage, settingsPage, original;
try {
  appPage = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(appPage);
  await appPage.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  original = await appPage.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller, groups = structuredClone(c.settings.projectGroups);
    await c.setReviewPreferences({ projectGroups: ['Business', 'Philosophy', 'Hobbies', 'MISC', 'Novels', 'Art', 'Maths'].map(name => ({ name, projects: [] })) });
    app.setting.open(); app.setting.openTabById('thejaz-planner'); return groups;
  });
  for (const candidate of browser.contexts().flatMap(c => c.pages())) if (await candidate.locator('.planner-settings').count()) settingsPage = candidate;
  assert(settingsPage); settingsPage.on('pageerror', e => errors.push(e.message));
  const groups = settingsPage.locator('.planner-review-settings');
  await groups.locator('summary').click();
  const list = settingsPage.locator('.planner-group-list');
  assert.equal(await list.locator('.setting-item').count(), 7);
  for (const width of [1280, 800, 650]) {
    await settingsPage.setViewportSize({ width, height: 1050 });
    await groups.scrollIntoViewIfNeeded();
    const geometry = await list.locator('.setting-item').evaluateAll(rows => rows.map(row => {
      const r = row.getBoundingClientRect(), input = row.querySelector('input').getBoundingClientRect();
      const buttons = [...row.querySelectorAll('button')].map(b => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, height: r.height }; });
      return { height: r.height, width: r.width, scrollWidth: row.scrollWidth, inputRight: input.right, buttons };
    }));
    for (const row of geometry) {
      assert(row.height <= 44, JSON.stringify({ width, row }));
      assert(row.scrollWidth <= row.width + 1);
      assert.equal(row.buttons.length, 2); assert(Math.abs(row.buttons[0].y - row.buttons[1].y) < 1);
      assert(row.inputRight <= row.buttons[0].x);
    }
    layouts.push({ windowWidth: width, rows: geometry });
    await settingsPage.screenshot({ path: `artifacts/group-spacing-${width}.png` });
  }
  checks.push('Seven group rows stay under 44px tall, with one full-width name field and both buttons aligned on one line at 1280/800/650px');
  const first = list.locator('.setting-item').first();
  await first.locator('input').fill('Business renamed'); await first.getByRole('button', { name: 'rename', exact: true }).click();
  await appPage.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.settings.projectGroups[0]?.name === 'Business renamed');
  await list.locator('.setting-item').first().getByRole('button', { name: 'remove', exact: true }).click();
  await appPage.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.settings.projectGroups.length === 6);
  checks.push('Rename and remove still work; group fields retain their accessible names');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/group-spacing-native.json', JSON.stringify({ checks, layouts, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (original) await appPage.evaluate(async groups => { app.setting.close(); await app.plugins.plugins['thejaz-planner'].controller.setReviewPreferences({ projectGroups: groups }); }, original);
  await browser.close();
}
