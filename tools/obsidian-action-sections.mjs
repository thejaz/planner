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
  original = await page.evaluate(() => ({ auto: app.plugins.plugins['thejaz-planner'].controller.settings.autoUpdate, body: document.body.className }));
  const text = '## plan for 1 jan 18\n### morning\n- [x] 09:00 (10) : chp\n\n---\nCHP = 20\nSUM = 20\n';
  await page.evaluate(async text => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller; c.settings.autoUpdate = false;
    const path = '2018-01-01.md', f = app.vault.getAbstractFileByPath(path);
    if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    c.ingest(path, text); const v = await p.open(); v.mode = 'day'; v.captureOpen = false; v.draft = ''; await v.navigate('2018-01-01');
  }, text);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  const actions = page.locator('.planner-day-action-section');
  assert.deepEqual(await actions.locator('button').allTextContents(), ['Undo', 'Redo', 'Open source', 'Replace plan from template', 'Compact footer', 'Set day context']);
  assert.equal(await actions.locator('.planner-action-icon svg').count(), 6);
  assert(await actions.locator('.planner-action-icon').evaluateAll(es => es.every(e => e.getAttribute('aria-hidden') === 'true')));
  const structure = await actions.evaluate(el => ({
    actions: getComputedStyle(el).borderTopWidth,
    history: getComputedStyle(el.querySelector('.planner-history-actions')).borderRightWidth,
    checks: getComputedStyle(document.querySelector('.planner-diagnostics')).borderTopWidth,
    attention: getComputedStyle(document.querySelector('.planner-notices')).borderTopWidth
  }));
  assert.deepEqual(structure, { actions: '1px', history: '1px', checks: '1px', attention: '1px' });
  checks.push('Six labeled action icons render; Undo/Redo come first with a divider, and actions/note checks/attention each have their own horizontal separator');
  await page.locator('.planner-row input[type=checkbox]').first().click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2018-01-01.md').text.includes('[ ]'));
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  const changed = text.replace('[x]', '[ ]');
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('2018-01-01.md'))), changed);
  const undo = actions.getByRole('button', { name: 'Undo', exact: true }), redo = actions.getByRole('button', { name: 'Redo', exact: true });
  assert(await redo.isDisabled()); await undo.click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2018-01-01.md').text.includes('[x]'));
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  assert(await redo.isEnabled()); await redo.click();
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('2018-01-01.md'))), changed);
  assert(await redo.isDisabled());
  checks.push('Footer Undo and Redo restore exact source bytes and update enabled/disabled states');
  await page.locator('.planner-row').first().focus(); await page.keyboard.press('Control+z');
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('2018-01-01.md'))), text);
  await page.locator('.planner-row').first().focus(); await page.keyboard.press('Control+Shift+z');
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('2018-01-01.md'))), changed);
  checks.push('Ctrl+Z and Ctrl+Shift+Z perform Undo/Redo outside text fields');
  for (const theme of ['theme-light', 'theme-dark']) {
    await page.evaluate(theme => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(theme); }, theme);
    await page.locator('.planner-totals').screenshot({ path: `artifacts/planner-actions-${theme}.png` });
  }
  await page.locator('.planner-shell').evaluate(el => { el.style.width = '300px'; el.style.maxWidth = '100%'; });
  assert(await actions.evaluate(el => [...el.querySelectorAll('button')].every(button => button.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1)));
  await page.locator('.planner-totals').screenshot({ path: 'artifacts/planner-actions-narrow.png' });
  checks.push('Action groups wrap within a 300px column; light/dark screenshots captured');
  await page.locator('.planner-shell').evaluate(el => { el.style.removeProperty('width'); el.style.removeProperty('max-width'); });
  await undo.click(); await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  await page.locator('.planner-row input[type=checkbox]').first().click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2018-01-01.md').text.includes('[ ]'));
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  assert(await redo.isDisabled());
  checks.push('A fresh edit after Undo clears the old redo branch');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/planner-action-sections.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (page && original) await page.evaluate(async state => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.settings.autoUpdate = state.auto; await c.saveSettings(); document.body.className = state.body;
  }, original);
  await browser.close();
}
