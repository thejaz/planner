import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
let page, original;
const checks = [], errors = [];
try {
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page);
  page.on('pageerror', e => errors.push(e.message));
  original = await page.evaluate(() => structuredClone(app.plugins.plugins['thejaz-planner'].controller.settings));
  const today = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.now().date);
  // Rolling presets are inclusive and end today: N days back, or N months back plus one day.
  const day = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const months = n => { const d = new Date(`${today}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - n); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  assert(today > '2026-10-10', 'The synthetic summary period must end before today');
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false; c.settings.summaryPath = 'review-ranges-summary.md';
    const text = '### Days (2026-10-01 - 2026-10-10)\n2026-10-01 = 0\n### Projects\nCHP = 0\n';
    const f = app.vault.getAbstractFileByPath(c.settings.summaryPath);
    if (f) await app.vault.modify(f, text); else await app.vault.create(c.settings.summaryPath, text);
    c.ingest(c.settings.summaryPath, text);
    const v = await p.open(); await v.navigate('2016-01-01'); v.switchMode('review');
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  const select = page.getByRole('combobox', { name: 'Review period', exact: true });
  assert.equal(await select.inputValue(), 'period');
  assert.deepEqual(await select.locator('option').allTextContents(), ['Past 7 days', 'Past 30 days', 'Past 6 months', 'Past 12 months', 'This summary period', 'All data']);
  const start = page.getByRole('textbox', { name: 'Review start date', exact: true });
  const end = page.getByRole('textbox', { name: 'Review end date', exact: true });
  assert.equal(await start.inputValue(), '2026-10-01'); assert.equal(await end.inputValue(), today);
  checks.push('Review opens on This summary period with exactly the six requested presets; a historical selected day and summary end do not exclude today');
  const earliest = await page.evaluate(() => {
    const c = app.plugins.plugins['thejaz-planner'].controller, dates = [c.now().date];
    for (const d of c.days.values()) if (d.date) dates.push(d.date);
    for (const s of c.summaries.values()) for (const r of s.rows) dates.push(r.date);
    return dates.sort()[0];
  });
  for (const [preset, expected] of [['7days', day(-6)], ['30days', day(-29)], ['6months', months(6)], ['12months', months(12)], ['period', '2026-10-01'], ['all', earliest]]) {
    await select.selectOption(preset);
    assert.equal(await start.inputValue(), expected); assert.equal(await end.inputValue(), today);
    const count = (Date.parse(today) - Date.parse(expected)) / 86400000 + 1;
    assert((await page.locator('.planner-review-total').innerText()).includes(`/${count} known days`));
    assert.equal(await page.locator('.planner-review-table tbody tr td').first().textContent(), today);
  }
  checks.push('Every rolling preset has the exact inclusive boundaries/day denominator and today is the newest row; All data includes indexed archive records');
  await select.selectOption('7days');
  await start.fill(day(-1)); await start.dispatchEvent('change');
  assert.equal(await select.inputValue(), 'custom'); assert.equal(await end.inputValue(), today);
  assert((await page.locator('.planner-review-total').innerText()).includes('/2 known days'));
  // Clearing or an incomplete date restores the previous one; an inverted range is still explained.
  await start.fill(''); await start.dispatchEvent('change');
  assert.equal(await start.inputValue(), day(-1)); assert.equal(await page.locator('.planner main .planner-error').count(), 0);
  await start.fill(day(1)); await start.dispatchEvent('change');
  assert(await end.isVisible()); assert((await page.locator('.planner main .planner-error').innerText()).includes('valid date range'));
  await start.fill(day(-1)); await start.dispatchEvent('change');
  assert((await page.locator('.planner-review-total').innerText()).includes('/2 known days'));
  checks.push('Manual date editing remains available with inclusive custom dates; clearing a date restores it and an inverted range is explained');
  await select.selectOption('period');
  await page.mouse.move(30, 30);
  await page.screenshot({ path: 'artifacts/planner-review-ranges.png' });
  await page.evaluate(() => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.settings.summaryPath = 'missing-summary-for-range-test.md'; c.emit();
  });
  assert((await page.locator('.planner main .planner-error').innerText()).includes('Set a summary note'));
  await select.selectOption('7days'); assert.equal(await end.inputValue(), today);
  checks.push('Missing summary configuration has a clear inline explanation, and other presets still work');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/planner-review-ranges.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (page && original) await page.evaluate(async settings => {
    const c = app.plugins.plugins['thejaz-planner'].controller; c.settings = settings; await c.saveSettings(); c.emit();
  }, original);
  await browser.close();
}
