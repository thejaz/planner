import { assertTestVault } from './paths.mjs';
import { plannerUI } from './planner-ui.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  assert(page);
  await assertTestVault(page);
  page.on('pageerror', e => errors.push(e.message));
  if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    // Its own day, so the helper does not depend on notes left by earlier helpers.
    const c = app.plugins.plugins['thejaz-planner'].controller, path = '2009-01-01.md';
    const text = '## plan for 1 jan 09\n### morning\n- [x] 08:00 (n/a) : awake\n- [x] 09:00 (60) : chp\n- [ ] 10:00 (60) : planned\n\n### afternoon\n- [ ] 12:00 (120) : lunch\n\n### evening\n\n---\nCHP = 60\nSUM = 60\n';
    const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    c.ingest(path, text);
    const v = await app.plugins.plugins['thejaz-planner'].open(); v.switchMode('day'); await v.navigate('2009-01-01'); v.focusEntry();
  });
  const initial = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.port.read('2009-01-01.md'));
  const rows = page.locator('.planner-row');
  assert(await rows.count() >= 4);
  await rows.nth(2).click();
  const visible = page.locator('.planner-row-actions:visible');
  assert.equal(await visible.count(), 1);
  assert.equal(await visible.evaluate(el => el.parentElement.dataset.index), '2');
  const bounds = await visible.evaluate(el => {
    const a = el.getBoundingClientRect(), r = el.parentElement.getBoundingClientRect();
    return { position: getComputedStyle(el).position, inside: a.left >= r.left && a.right <= r.right && a.top >= r.top && a.bottom <= r.bottom };
  });
  assert.equal(bounds.position, 'static'); assert(bounds.inside);
  checks.push('Exactly one action strip appears in normal layout inside the selected row');
  await rows.nth(1).hover();
  assert.equal(await visible.count(), 1);
  assert.equal(await visible.evaluate(el => el.parentElement.dataset.index), '2');
  checks.push('Hovering a neighboring row preserves the selected strip without creating a second toolbar');
  await rows.nth(2).focus(); await rows.nth(2).press('Shift+ArrowDown');
  assert(await page.locator('.planner-row.is-selected').count() >= 2);
  assert.equal(await visible.count(), 1);
  assert.equal(await visible.evaluate(el => el.parentElement.dataset.index), '3');
  checks.push('Extended selection still shows actions only for the current row');
  await rows.nth(3).focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement?.closest('.planner-row-actions')?.parentElement.dataset.index === '3'));
  await visible.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  checks.push('Keyboard Tab reaches the inline actions and Edit opens the compact editor');
  await visible.getByRole('button', { name: 'Add below', exact: true }).click();
  assert(await page.getByRole('textbox', { name: 'Quick entry', exact: true }).evaluate(el => el === document.activeElement));
  await page.locator('.planner-shell').evaluate(el => { el.style.maxWidth = '320px'; });
  assert(await visible.evaluate(el => [...el.querySelectorAll('button')].every(b => {
    const a = b.getBoundingClientRect(), r = el.parentElement.getBoundingClientRect();
    return a.left >= r.left && a.right <= r.right + 1 && a.bottom <= r.bottom + 1;
  })));
  await visible.scrollIntoViewIfNeeded(); await page.mouse.move(350, 50);
  await page.screenshot({ path: 'artifacts/planner-row-actions-narrow.png' });
  await page.locator('.planner-shell').evaluate(el => { el.style.maxWidth = ''; });
  await page.screenshot({ path: 'artifacts/planner-row-actions.png' });
  checks.push('Add below opens the correct inline editor; actions wrap entirely inside the row at 320px');
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.port.read('2009-01-01.md')), initial);
  assert.deepEqual(errors, []);
  await writeFile('artifacts/planner-row-actions.json', JSON.stringify({ checks, errors, bounds, noteWrites: 0 }, null, 2));
  console.log(JSON.stringify({ checks, errors, bounds }, null, 2));
} finally { await browser.close(); }
