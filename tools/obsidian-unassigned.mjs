import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { plannerUI } from './planner-ui.mjs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await page.waitForFunction(() => typeof app !== 'undefined' && app.vault);
  await assertTestVault(page);
  const trust = page.getByRole('button', { name: 'Trust author and enable plugins', exact: true });
  if (await trust.count()) await trust.click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  await page.evaluate(() => app.setting.close());
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false; c.settings.showMarkerCounts = false; c.settings.projectGroups = [];
    for (const [path, text] of [
      ['2012-01-01.md', '## plan for 1 jan 12\n### morning\n- [x] 09:00 (60) : chp\nCHP = 60\nSUM = 60\n'],
      ['2012-01-02.md', '## plan for 2 jan 12\n### morning\n- [x] 09:00 (30) : mdr\nMDR = 30\nSUM = 30\n']
    ]) {
      const file = app.vault.getAbstractFileByPath(path);
      if (file) await app.vault.modify(file, text); else await app.vault.create(path, text);
    }
    await c.index(); const v = await p.open(); v.preset = 'custom'; v.rangeStart = '2012-01-01'; v.rangeEnd = '2012-01-02'; v.switchMode('review');
  });
  const snapshot = () => page.evaluate(async () => Object.fromEntries(await Promise.all(app.vault.getMarkdownFiles().map(async f => [f.path, await app.vault.read(f)]))));
  const before = await snapshot();
  const groups = () => page.locator('.planner-group-totals').innerText();
  assert.equal(await groups(), 'Unassigned\n1h 30m\n(100%)');
  checks.push('With no custom groups, Review automatically groups all recorded project credit under unassigned');
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.setReviewPreferences({ projectGroups: [{ name: 'business', projects: ['CHP'] }] }); });
  await page.waitForFunction(() => document.querySelector('.planner-group-totals')?.innerText.includes('business'));
  assert((await groups()).includes('business\n1h 00m')); assert((await groups()).includes('Unassigned\n0h 30m'));
  await page.getByRole('combobox', { name: 'Project filter', exact: true }).selectOption('MDR');
  assert.equal(await groups(), 'Unassigned\n0h 30m\n(100%)');
  await page.getByRole('textbox', { name: 'Review end date', exact: true }).fill('2012-01-01');
  assert.equal(await groups(), 'Unassigned\n0h 00m\n—');
  checks.push('Mixed grouping, unassigned project filters and zero-credit date ranges produce correct totals without double counting');
  await page.getByRole('combobox', { name: 'Project filter', exact: true }).selectOption('');
  await page.getByRole('textbox', { name: 'Review end date', exact: true }).fill('2012-01-02');
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.setReviewPreferences({ projectGroups: [] }); });
  await page.waitForFunction(() => document.querySelectorAll('.planner-group-total').length === 1);
  assert.equal(await groups(), 'Unassigned\n1h 30m\n(100%)'); assert.deepEqual(await snapshot(), before);
  checks.push('Removing assignments automatically returns credit to unassigned and leaves every synthetic Markdown file unchanged');
  assert.deepEqual(errors, []);
  const version = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].manifest.version);
  const report = { version, checks, errors };
  await writeFile('artifacts/unassigned.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
