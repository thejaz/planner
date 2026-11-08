import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
// Typing a date never jumps mid-entry; Enter/blur applies it, Escape restores, the picker applies at once.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [];
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await assertTestVault(page);
  await page.bringToFront();
  if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
  const viewDate = () => page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.date);
  await page.evaluate(async () => { const v = await app.plugins.plugins['thejaz-planner'].open(); v.switchMode('day'); await v.navigate('2026-10-19'); });
  const field = page.locator('.planner-date-navigation input[type=date]');
  // The field follows the system date format (day/month order varies), so tests use dates whose day equals
  // their month and only locate the year: a probe digit shows whether the year is typed first or last.
  const toFirstPart = async () => { await field.focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); };
  await toFirstPart(); await page.keyboard.type('7');
  const yearFirst = (await field.inputValue()).startsWith('0007');
  await page.keyboard.press('Escape');
  const order = yearFirst ? ['year', 'pair', 'pair'] : ['pair', 'pair', 'year'];
  const typeDate = async (date, stopAfterYearDigits) => {
    const [year, pair] = date.split('-');
    await toFirstPart();
    for (const part of order) {
      const digits = part === 'year' ? (stopAfterYearDigits ? year.slice(0, stopAfterYearDigits) : year) : pair;
      await page.keyboard.type(digits, { delay: 20 });
      if (part === 'year' && stopAfterYearDigits) return;
    }
  };

  await typeDate('2007-01-01', 1);
  assert.equal(await viewDate(), '2026-10-19', 'A partial year must not navigate');
  await page.keyboard.type('007', { delay: 20 });
  assert.equal(await viewDate(), '2026-10-19', 'A complete typed date waits for Enter');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.date === '2007-01-01');
  assert.equal(await field.inputValue(), '2007-01-01');
  checks.push('Typing a date digit by digit never jumps; Enter applies the complete date');

  await typeDate('2003-03-03', 2);
  await page.keyboard.press('Escape');
  assert.equal(await viewDate(), '2007-01-01'); assert.equal(await field.inputValue(), '2007-01-01');
  checks.push('Escape abandons typed text and restores the shown date');

  await typeDate('2003-03-03', 1);
  await page.locator('.planner-shell h1, .planner-shell h2').first().click();
  await page.waitForTimeout(200);
  assert.equal(await viewDate(), '2007-01-01'); assert.equal(await field.inputValue(), '2007-01-01');
  checks.push('Leaving the field with an incomplete year (0002-style) restores the date instead of jumping to it');

  await typeDate('2004-05-05');
  await page.locator('.planner-shell h1, .planner-shell h2').first().click();
  await page.waitForFunction(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.date === '2004-05-05');
  checks.push('Leaving the field after a complete typed date applies it');

  // A calendar pick sets the value without typing and applies at once.
  await field.evaluate(el => { el.value = '2005-06-07'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.date === '2005-06-07');
  assert.equal(await field.getAttribute('min'), '1000-01-01');
  checks.push('A date picked from the calendar applies immediately; the picker offers four-digit years only');

  // A background redraw while typing must not reset the field.
  await typeDate('2001-02-02', 2);
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.emit());
  await page.waitForTimeout(150);
  await page.keyboard.type('01', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.date === '2001-02-02');
  checks.push('Background updates wait while a date is being typed');

  await page.evaluate(async () => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.preset = 'custom'; v.rangeStart = '2026-10-01'; v.rangeEnd = '2026-10-19'; v.switchMode('review'); });
  const start = page.locator('.planner-shell input[type=date]').first();
  await start.focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.type('2', { delay: 20 });
  assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.rangeStart), '2026-10-01', 'Review range waits for Enter too');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.rangeStart), '2026-10-01');
  assert.equal(await start.inputValue(), '2026-10-01');
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.switchMode('day'));
  checks.push('Review start/end dates use the same typing behaviour');
  await writeFile('artifacts/date-typing-native.json', JSON.stringify({ yearFirst, checks }, null, 2));
  console.log(JSON.stringify({ yearFirst, checks }, null, 2));
} finally { await browser.close(); }
