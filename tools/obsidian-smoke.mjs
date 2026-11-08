import { assertTestVault } from './paths.mjs';
import { chooseCapture } from './capture-choice.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  if (!page) throw Error('Isolated Obsidian page not found');
  await page.bringToFront();
  page.on('pageerror', e => errors.push(e.message));
  await assertTestVault(page);
  // Unique future date keeps this test out of the user's copied accounting period.
  const date = await page.evaluate(() => {
    for (let day = 1; day <= 28; day++) {
      const date = `2099-01-${String(day).padStart(2, '0')}`;
      if (!app.vault.getAbstractFileByPath(`${date}.md`)) return date;
    }
    throw Error('No free synthetic smoke-test date');
  });
  await page.evaluate(async date => {
    const p = app.plugins.plugins['thejaz-planner'];
    // A fresh synthetic vault has no default summary; Review needs ⌚.md for its period.
    // A discovered summary owns the 2099 smoke dates, so their summary updates
    // complete instead of leaving pending checks for later helpers.
    const owner = '2099-01-01--2099-01-31-thejaz-summary.md';
    if (!app.vault.getAbstractFileByPath(owner)) await app.vault.create(owner, '### Days\n' +
      Array.from({ length: 31 }, (_, i) => `01-${String(i + 1).padStart(2, '0')} : 000`).join('\n') +
      '\n### Projects\nCHP = 0\nMDR = 0\n### Results\nDays (2099-01-01 - 2099-01-31): 31d\n');
    await p.controller.updateSettings({ summaryPath: '⌚.md', autoUpdate: true }); await p.controller.index();
    p.controller.settings.lastRoutine = '';
    const v = await p.open(); v.switchMode('day'); await v.navigate(date);
  }, date);
  if (await page.getByRole('button', { name: 'Create day', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Create day', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Create day', exact: true }).click();
  }
  await page.locator('.planner-capture-toggle').waitFor();
  // Wait for debounced file updates and the whole operation (summary update and
  // final re-render), not only the parsed day; a re-render replaces the composer.
  const settled = () => page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    do { while (c.timers.size) await new Promise(r => setTimeout(r, 50)); await c.mutation; } while (c.timers.size);
  });
  await settled();
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  const raw = () => page.evaluate(date => app.plugins.plugins['thejaz-planner'].controller.port.read(`${date}.md`), date);
  const before = await raw();
  assert(before.includes('SUM = 0'));
  checks.push('Create minimal day through native dialog');
  const quick = page.getByRole('textbox', { name: 'Quick entry' });
  // Quick entry starts in Plan mode; logging must choose Log explicitly.
  await chooseCapture(page, 'Entry mode', 'log');
  // n/a keeps the first row an explicit anchor instead of the configured default start.
  await quick.fill('09:00 n/a awake');
  assert((await page.locator('.planner-preview').innerText()).includes('- [x] 09:00 (n/a) : awake'));
  await quick.press('Enter');
  await page.waitForFunction(date => app.plugins.plugins['thejaz-planner'].controller.days.get(`${date}.md`)?.entries.length === 1, date);
  await settled();
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  if (await page.getByRole('button', { name: 'Entry mode', exact: true }).getAttribute('data-value') !== 'log') await chooseCapture(page, 'Entry mode', 'log');
  await quick.fill('09:35 chp');
  assert((await page.locator('.planner-preview').innerText()).includes('(35) : chp'));
  await quick.press('Enter');
  await page.waitForFunction(date => app.plugins.plugins['thejaz-planner'].controller.days.get(`${date}.md`)?.recordedSum === 35, date);
  await settled();
  checks.push('Keyboard quick logging, preview, automatic credit and footer');
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  await chooseCapture(page, 'Entry mode', 'plan');
  await quick.fill('10:00 mdr');
  await quick.press('Enter');
  await page.waitForFunction(date => app.plugins.plugins['thejaz-planner'].controller.days.get(`${date}.md`)?.entries.length === 3, date);
  await settled();
  assert((await raw()).includes('- [ ] 10:00 (25) : mdr'));
  assert((await raw()).includes('SUM = 35'));
  checks.push('Planned minutes excluded from actual totals');
  const row = page.locator('.planner-row').nth(2);
  await row.focus();
  await row.press('Space');
  await page.waitForFunction(date => app.plugins.plugins['thejaz-planner'].controller.days.get(`${date}.md`)?.recordedSum === 60, date);
  await settled();
  checks.push('Space confirms completion and updates credit');
  await page.locator('.planner-row').nth(2).focus();
  await page.locator('.planner-row').nth(2).press('Enter');
  // 0.2.49 replaced the three-field editor with one compact input: time, activity, minutes.
  const compact = page.getByRole('textbox', { name: 'Edit activity input', exact: true });
  await compact.fill('10:00 25 mdr (draft)');
  await compact.press('Enter');
  await page.waitForFunction(date => app.plugins.plugins['thejaz-planner'].controller.days.get(`${date}.md`)?.text.includes('mdr (draft)'), date);
  await settled();
  checks.push('Enter edits with keyboard submission');
  await page.locator('.planner-row').nth(2).focus();
  await page.locator('.planner-row').nth(2).press('Control+z');
  await page.waitForFunction(date => app.plugins.plugins['thejaz-planner'].controller.days.get(`${date}.md`)?.text.includes('mdr (draft)') === false, date);
  await settled();
  checks.push('Keyboard undo restores source');
  await page.locator('.planner-row').nth(1).focus();
  await page.locator('.planner-row').nth(1).press('Control+Shift+O');
  assert.equal(await page.evaluate(() => app.workspace.getActiveFile()?.path), `${date}.md`);
  assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner').length), 1);
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].open(); });
  assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.selected), 1);
  checks.push('Source navigation preserves planner selection and tab');
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  // The view keeps its project filter between runs; start from all projects.
  await page.getByLabel('Project filter', { exact: true }).selectOption('');
  await page.getByLabel('Review start date').fill(date);
  await page.getByLabel('Review start date').dispatchEvent('change');
  await page.getByLabel('Review end date').fill(date);
  await page.getByLabel('Review end date').dispatchEvent('change');
  assert((await page.locator('.planner-review-total').innerText()).includes('1h 00m'));
  await page.getByLabel('Project filter', { exact: true }).selectOption('CHP');
  assert((await page.locator('.planner-review-total').innerText()).includes('0h 35m'));
  checks.push('Review custom range and project filtering');
  await page.screenshot({ path: 'artifacts/obsidian-review.png' });
  await page.evaluate(async () => {
    const view = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
    view.mode = 'day'; await view.navigate('2026-10-19');
  });
  await page.mouse.move(2, 2);
  await page.screenshot({ path: 'artifacts/obsidian-day.png' });
  const metrics = await page.evaluate(() => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    return { days: c.days.size, summaries: c.summaries.size, ...c.performance };
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile('artifacts/obsidian-smoke.json', JSON.stringify({ checks, errors, metrics }, null, 2));
  console.log(JSON.stringify({ passed: checks, errors, metrics }, null, 2));
} catch (error) {
  await writeFile('artifacts/obsidian-smoke-failure.json', JSON.stringify({ checks, errors, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
