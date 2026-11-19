import { assertTestVault } from './paths.mjs';
import { plannerUI } from './planner-ui.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
let page, original;
const checks = [], errors = [];
try {
  page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await assertTestVault(page);
  if (await page.locator('.modal-container').count()) await page.keyboard.press('Escape');
  page.on('pageerror', e => errors.push(e.message));
  original = await page.evaluate(() => structuredClone(app.plugins.plugins['thejaz-planner'].controller.settings));
  const first = '## plan for 1 jan 19\n### morning\n- [x] 09:00 (10) : chp\n\nCHP = 10\nXDEL9 = 0\nSUM = 10\n';
  const second = '## plan for 2 jan 19\n### morning\n- [x] 09:00 (10) : xdel9\n- [x] 09:30 (20-10/30) : chp & xdel9\n\nCHP = 20\nXDEL9 = 20\nSUM = 40\n';
  const chpEmoji = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.settings.projectEmojis.CHP);
  const summary = '### Days (2019-01-01 - 2019-01-02)\n2019-01-01 = 10\n2019-01-02 = 40 🦥\n### Projects\n🌱 XDEL9 = 20\nCHP = 30\n### Bookmarks\nXDEL9 = keep this prose\n'.replace('CHP = 30', `${chpEmoji} CHP = 30`);
  await page.evaluate(async ({ first, second, summary }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false; c.settings.summaryPath = 'project-removal-summary.md'; await c.saveSettings();
    for (const [path, text] of [['2019-01-01.md', first], ['2019-01-02.md', second], [c.settings.summaryPath, summary]]) {
      const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
      c.ingest(path, text);
    }
    await c.addProjectCode('XDEL9');
    const v = await p.open(); v.mode = 'day'; v.captureOpen = false; v.draft = ''; await v.navigate('2019-01-01');
  }, { first, second, summary });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  const read = path => page.evaluate(path => app.vault.read(app.vault.getAbstractFileByPath(path)), path);
  await page.locator('.planner-project-chip:not(.planner-suggestion)').filter({ hasText: 'XDEL9' }).click();
  const preview = page.getByRole('button', { name: 'Preview changes', exact: true });
  const apply = page.getByRole('button', { name: 'Apply changes', exact: true });
  assert(await apply.isDisabled()); await preview.click();
  await page.waitForFunction(() => !document.querySelector('.modal button[type=submit]').disabled);
  assert((await page.locator('.planner-project-removal-preview').innerText()).includes('3 notes will change'));
  assert.equal(await read('2019-01-01.md'), first); assert.equal(await read('2019-01-02.md'), second);
  await page.screenshot({ path: 'artifacts/planner-project-removal-preview.png' });
  checks.push('Clicking a project chip opens management; preview lists every affected note and performs no writes');
  await apply.click(); await page.waitForFunction(() => !document.querySelector('.modal-container'));
  assert.equal(await read('2019-01-01.md'), first.replace('XDEL9 = 0\n', ''));
  assert.equal(await read('2019-01-02.md'), second.replace('XDEL9 = 20\n', '').replace('SUM = 40', 'SUM = 20'));
  assert.equal(await read('project-removal-summary.md'), summary.replace('🌱 XDEL9 = 20\n', '').replace('2019-01-02 = 40 🦥', '==2019-01-02 = 20 😣=='));
  assert.equal(await page.locator('.planner-project-chip:not(.planner-suggestion)').filter({ hasText: 'XDEL9' }).count(), 0);
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.settings.projectCodes.includes('XDEL9')), false);
  checks.push('Unlink removes all project definitions and its chip while preserving activity text and Bookmarks while subtracting project work from SUM');
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.undo(); });
  assert.equal(await read('2019-01-01.md'), first); assert.equal(await read('2019-01-02.md'), second); assert.equal(await read('project-removal-summary.md'), summary);
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.redo(); });
  assert.equal(await read('2019-01-02.md'), second.replace('XDEL9 = 20\n', '').replace('SUM = 40', 'SUM = 20'));
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.undo(); });
  checks.push('Grouped Undo/Redo restore/reapply all note definitions and Settings registration exactly');
  await page.evaluate(() => { app.workspace.getLeavesOfType('thejaz-planner')[0].view.manageProject('XDEL9'); });
  await page.getByRole('combobox', { name: 'Project removal action', exact: true }).selectOption('delete');
  await preview.click(); await page.waitForFunction(() => !document.querySelector('.modal button[type=submit]').disabled);
  await apply.click(); await page.waitForFunction(() => !document.querySelector('.modal-container'));
  assert.equal(await read('2019-01-01.md'), first.replace('XDEL9 = 0\n', ''));
  assert.equal(await read('2019-01-02.md'), second.replace('- [x] 09:00 (10) : xdel9\n', '').replace('(20-10/30) : chp & xdel9', '(20/30) : chp').replace('XDEL9 = 20\n', '').replace('SUM = 40', 'SUM = 20'));
  assert.equal(await read('project-removal-summary.md'), summary.replace('🌱 XDEL9 = 20\n', '').replace('2019-01-02 = 40 🦥', '==2019-01-02 = 20 😣=='));
  checks.push('Delete removes only the selected activities/split credits and definitions, adjusts known SUM/summary dates, and preserves other projects/prose');
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.undo(); });
  assert.equal(await read('2019-01-02.md'), second); assert.equal(await read('project-removal-summary.md'), summary);
  await page.evaluate(() => { app.workspace.getLeavesOfType('thejaz-planner')[0].view.manageProject('XDEL9'); });
  await preview.click(); await page.waitForFunction(() => !document.querySelector('.modal button[type=submit]').disabled);
  await page.evaluate(async () => {
    const f = app.vault.getAbstractFileByPath('2019-01-01.md'); await app.vault.modify(f, (await app.vault.read(f)) + 'Manual edit after preview.\n');
  });
  await apply.click();
  assert((await page.locator('.modal .planner-error').last().innerText()).includes('changed since the preview'));
  assert.equal(await read('2019-01-02.md'), second); assert.equal(await read('project-removal-summary.md'), summary);
  checks.push('A stale preview refuses the whole removal before writing any of the other records');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(async text => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    const raw = text.replace('20-10/30', '?/30');
    await app.vault.modify(app.vault.getAbstractFileByPath('2019-01-02.md'), raw); c.ingest('2019-01-02.md', raw);
    app.workspace.getLeavesOfType('thejaz-planner')[0].view.manageProject('XDEL9');
  }, second);
  await page.getByRole('combobox', { name: 'Project removal action', exact: true }).selectOption('delete');
  await preview.click(); await page.waitForFunction(() => !document.querySelector('.modal button[type=submit]').disabled);
  assert(await apply.isDisabled());
  assert((await page.locator('.planner-project-removal-preview').innerText()).includes('older format or unclear minutes'));
  assert.equal(await read('project-removal-summary.md'), summary);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  checks.push('Ambiguous split credit lists the exact record to resolve and disables bulk application');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/planner-project-removal.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (page && original) await page.evaluate(async settings => {
    const c = app.plugins.plugins['thejaz-planner'].controller; c.settings.autoUpdate = false;
    c.settings.summaryPath = settings.summaryPath;
    c.settings = settings; await c.saveSettings(); c.emit();
  }, original);
  await browser.close();
}
