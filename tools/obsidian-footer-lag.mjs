import { assertTestVault } from './paths.mjs';
// Native check for 0.2.53: after an update is blocked by a time error, totals catch
// up once the times are fixed, because the footer is still the planner's own last
// write. A footer the user edits stays preserved.
import { plannerUI } from './planner-ui.mjs';
import { chooseCapture } from './capture-choice.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], path = '2002-06-01.md';
const text = '## plan for 1 jun 02\n### morning\n- [x] 10:00 (n/a) : start\n- [ ] 10:15 (15) : chp\n- [ ] 10:20 (5) : bath\n### afternoon\n### evening\n\n---\nCHP = 0\nSUM = 0\n';
let original;
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await assertTestVault(page);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  page.on('pageerror', e => errors.push(e.message));
  original = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.settings.autoUpdate);
  await page.evaluate(async ({ path, text }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    await c.updateSettings({ autoUpdate: true, roundTimes: false, roundCredits: false });
    const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    c.ingest(path, text);
    do { while (c.timers.size) await new Promise(r => setTimeout(r, 50)); await c.mutation; } while (c.timers.size);
    const v = await p.open(); v.switchMode('day'); await v.navigate('2002-06-01');
  }, { path, text });
  const raw = () => page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.port.read(path), path);
  const settled = () => page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    do { while (c.timers.size) await new Promise(r => setTimeout(r, 50)); await c.mutation; } while (c.timers.size);
  });
  const footer = async () => { const t = await raw(); return [/CHP = (\d+)/.exec(t)?.[1], /SUM = (\d+)/.exec(t)?.[1]].join('/'); };
  const row = i => page.locator(`.planner-row[data-index="${i}"]`);

  // The planner writes the footer when chp is completed.
  await row(1).locator('.planner-label').click(); await row(1).press('Space'); await settled();
  assert.equal(await footer(), '15/15');

  // A logged row inserted before a later end time blocks automatic totals.
  await row(1).getByRole('button', { name: 'Add below', exact: true }).click();
  await chooseCapture(page, 'Entry mode', 'log');
  const quick = page.getByRole('textbox', { name: 'Quick entry', exact: true });
  await quick.fill('10:30 10 chp'); await quick.press('Enter'); await settled();
  assert((await raw()).includes('- [x] 10:30 (10) : chp'));
  assert.equal(await footer(), '15/15');
  checks.push('A completed row that puts a later end time out of order is saved, but its totals wait while the times conflict');

  // Fixing the time lets the totals follow the activities again.
  await row(3).locator('.planner-label').click(); await row(3).press('e');
  const edit = page.getByRole('textbox', { name: 'Edit activity input', exact: true });
  await edit.fill('10:40 10 bath'); await edit.press('Enter');
  await page.locator('.planner-activity-editor').waitFor({ state: 'detached' }); await settled();
  assert.equal(await footer(), '25/25');
  assert(!(await page.locator('.planner-total-line').innerText()).includes('recorded values'));
  checks.push('After the time is fixed, the footer is still the planner\u2019s own last write, so totals catch up to 25 without a manual reconcile');

  // A footer the user edits by hand is still preserved.
  await page.evaluate(async path => { const f = app.vault.getAbstractFileByPath(path); await app.vault.process(f, t => t.replace('CHP = 25', 'CHP = 30')); }, path);
  await settled(); await page.waitForTimeout(600); await settled();
  await row(0).locator('.planner-label').click(); await page.getByRole('button', { name: 'Add below', exact: true }).first().click();
  await quick.fill('10:05 5 chp'); await quick.press('Enter'); await settled();
  assert(/CHP = 30/.test(await raw()), await raw());
  checks.push('A total edited by hand stays as recorded when activities change later');

  assert.deepEqual(errors, []);
  await writeFile('artifacts/obsidian-footer-lag.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await writeFile('artifacts/obsidian-footer-lag-failure.json', JSON.stringify({ checks, errors, error: String(error) }, null, 2));
  throw error;
} finally {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  if (page && original !== undefined) await page.evaluate(value => app.plugins.plugins['thejaz-planner'].controller.updateSettings({ autoUpdate: value }), original).catch(() => {});
  await browser.close();
}
