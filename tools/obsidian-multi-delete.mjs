import { assertTestVault } from './paths.mjs';
import { plannerUI } from './planner-ui.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], date = '2007-01-01', dayPath = `${date}.md`, summaryPath = 'Planner selection verification.md';
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  assert(page);
  await page.waitForFunction(() => typeof app !== 'undefined' && app.vault);
  await assertTestVault(page);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  page.on('pageerror', e => errors.push(e.message));
  if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
  await page.evaluate(async ({ dayPath, summaryPath }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false; c.settings.summaryPath = summaryPath;
    const store = async (path, text) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (file) await app.vault.modify(file, text); else await app.vault.create(path, text);
    };
    await store(dayPath, '## plan for 1 jan 07\n\n### morning\n\n- [x] 09:00 (n/a) : awake\n- [x] 09:30 (30) : chp\nMy annotation stays.\n- [x] 10:00 (30) : mdr\n- [ ] 10:30 (30) : chp\n\n### afternoon\n\n- [ ] 14:00 (60) : hay\n- [ ] 14:30 (30) : meal\n\n### evening\n\n---\n\nCHP = 30\nMDR = 30\nHAY = 0\nSUM = 60\n\n[^1]: My personal reference.\n');
    await store(summaryPath, '### Days\n2007-01-01 = 60 🦥\n### Projects\nCHP = 30\nMDR = 30\nHAY = 0\n### Results\nDays (2007-01-01 - 2007-01-01): 1d\n');
    await c.index(); await c.openSource(dayPath);
    const v = await p.open(); v.switchMode('day'); await v.navigate('2007-01-01');
  }, { dayPath, summaryPath });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller; await c.mutation; c.settings.autoUpdate = true;
  });
  const row = index => page.locator(`.planner-row[data-index="${index}"]`);
  const click = (index, modifiers = []) => row(index).locator('.planner-label').click({ modifiers });
  const selected = () => page.locator('.planner-row.is-selected').evaluateAll(rows => rows.map(r => Number(r.dataset.index)));
  const raw = path => page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.port.read(path), path);
  const settled = () => page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  const waitRows = count => page.waitForFunction(({ dayPath, count }) => app.plugins.plugins['thejaz-planner'].controller.days.get(dayPath)?.entries.length === count, { dayPath, count });
  const original = await raw(dayPath), summaryBefore = await raw(summaryPath);
  await click(1); await click(4, ['Shift']); assert.deepEqual(await selected(), [1, 2, 3, 4]);
  assert(await page.getByRole('button', { name: 'Delete 4 selected', exact: true }).isVisible());
  await click(2, ['Shift']); assert.deepEqual(await selected(), [1, 2]);
  await click(0, ['Shift']); assert.deepEqual(await selected(), [0, 1]);
  await click(4); await click(1, ['Shift']); assert.deepEqual(await selected(), [1, 2, 3, 4]);
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), '');
  checks.push('Shift-click selects both endpoints and every intervening activity across sections, reverses and shrinks from a fixed anchor without selecting browser text');

  await click(2); await row(2).press('Shift+ArrowDown'); await page.keyboard.press('Shift+ArrowDown');
  assert.deepEqual(await selected(), [2, 3, 4]);
  await page.keyboard.press('Shift+ArrowUp'); assert.deepEqual(await selected(), [2, 3]);
  await page.keyboard.press('Shift+ArrowUp'); assert.deepEqual(await selected(), [2]);
  await page.keyboard.press('Shift+ArrowUp'); assert.deepEqual(await selected(), [1, 2]);
  await page.keyboard.press('Shift+ArrowDown'); assert.deepEqual(await selected(), [2]);
  await page.keyboard.press('ArrowDown'); assert.deepEqual(await selected(), [3]);
  checks.push('Shift-arrows extend, shrink and cross the anchor; an ordinary arrow returns to a single row');

  await click(1); await click(4, ['Shift']); await page.keyboard.press('Delete');
  assert.equal(await page.locator('.modal-title').innerText(), 'Delete 4 activities');
  const deletionPreview = await page.locator('.modal .planner-preview').innerText();
  assert(deletionPreview.includes('09:30 (30) : chp') && deletionPreview.includes('14:00 (60) : hay'));
  assert(!deletionPreview.includes('awake') && !deletionPreview.includes('meal'));
  await page.keyboard.press('Escape');
  assert.equal(await raw(dayPath), original); assert.equal(await raw(summaryPath), summaryBefore);
  checks.push('Delete previews exactly the selected rows; Escape cancels without changing the day or summary');

  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  const quick = page.getByRole('textbox', { name: 'Quick entry', exact: true });
  await quick.fill('abc'); await quick.press('Home'); await quick.press('Delete');
  assert.equal(await quick.inputValue(), 'bc'); await quick.press('End'); await quick.press('Backspace');
  assert.equal(await quick.inputValue(), 'b'); assert.equal(await page.locator('.modal').count(), 0);
  assert.equal(await raw(dayPath), original); await quick.fill(''); await quick.press('Escape');
  checks.push('Delete and Backspace inside a text field retain ordinary text editing behavior');

  await click(1); await click(4, ['Shift']); await page.keyboard.press('Delete');
  await page.locator('.modal').getByRole('button', { name: 'Delete rows', exact: true }).click();
  await waitRows(2); await settled();
  const deleted = await raw(dayPath), summaryAfter = await raw(summaryPath);
  assert(deleted.includes('awake') && deleted.includes('meal') && deleted.includes('My annotation stays.') && deleted.includes('[^1]: My personal reference.'));
  assert(deleted.includes('### morning') && deleted.includes('### afternoon') && deleted.includes('### evening'));
  assert(deleted.includes('SUM = 0') && summaryAfter.includes('2007-01-01 = 0'), `${deleted}
---
${summaryAfter}`);
  assert.deepEqual(await selected(), [1]);
  await row(1).press('Control+z'); await waitRows(6); await settled();
  assert.equal(await raw(dayPath), original); assert.equal(await raw(summaryPath), summaryBefore);
  await row(1).press('Control+Shift+z'); await waitRows(2); await settled();
  assert.equal(await raw(dayPath), deleted); assert.equal(await raw(summaryPath), summaryAfter);
  checks.push('One grouped deletion updates actual totals and summary; keyboard Undo/Redo restore the exact note and summary with focus on a surviving activity');

  await click(0); await click(1, ['Shift']);
  await page.getByRole('button', { name: 'Delete 2 selected', exact: true }).click();
  await page.locator('.modal').getByRole('button', { name: 'Delete rows', exact: true }).click();
  await waitRows(0); await settled();
  assert.equal(await page.locator('.planner-row').count(), 0);
  assert((await raw(dayPath)).includes('My annotation stays.'));
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await waitRows(2); await settled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await waitRows(6); await settled();
  assert.equal(await raw(dayPath), original); assert.equal(await raw(summaryPath), summaryBefore);
  checks.push('Deleting every activity preserves headings and prose, remains keyboard-usable and is undoable');

  await click(1); await click(4, ['Control']); assert.deepEqual(await selected(), [1, 4]);
  await page.evaluate(() => { app.commands.executeCommandById('thejaz-planner:delete'); });
  await page.locator('.modal').getByRole('button', { name: 'Delete rows', exact: true }).click();
  await waitRows(4); await settled();
  const disjoint = await raw(dayPath);
  assert(disjoint.includes('- [x] 10:00 (30) : mdr') && disjoint.includes('- [ ] 10:30 (30) : chp') && disjoint.includes('SUM = 30'));
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await waitRows(6); await settled();
  assert.equal(await raw(dayPath), original); assert.equal(await raw(summaryPath), summaryBefore);
  checks.push('Command-palette deletion handles disjoint Ctrl-click selections without deleting intervening activities');

  await click(1); await click(4, ['Shift']); await page.keyboard.press('Backspace');
  await page.evaluate(async dayPath => {
    const c = app.plugins.plugins['thejaz-planner'].controller; c.settings.autoUpdate = false;
    const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === dayPath).view;
    view.editor.setValue(view.editor.getValue().replace('10:00 (30) : mdr', '10:00 (31) : mdr')); await view.save();
  }, dayPath);
  const concurrent = await raw(dayPath);
  await page.locator('.modal').getByRole('button', { name: 'Delete rows', exact: true }).click();
  // A failed confirmation keeps its dialog open and shows the conflict inline.
  await page.locator('.modal .planner-error', { hasText: 'changed elsewhere' }).waitFor();
  await page.locator('.modal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await settled(); assert.equal(await raw(dayPath), concurrent); await waitRows(6);
  checks.push('A selected row edited after confirmation was opened blocks the entire deletion; no partial rows are removed');

  await click(1); await click(4, ['Shift']); assert.deepEqual(await selected(), [1, 2, 3, 4]);
  await page.evaluate(async dayPath => {
    const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === dayPath).view;
    view.editor.setValue(view.editor.getValue().replace('- [x] 09:30', '- [ ] 09:15 (15) : buffer\n- [x] 09:30')); await view.save();
  }, dayPath);
  await waitRows(7); await page.waitForFunction(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.selection.size === 0);
  assert.equal((await selected()).length, 1);
  checks.push('Manual activity changes clear stale index ranges so new or shifted rows are not silently included');
  await page.screenshot({ path: 'artifacts/multi-delete-selection.png' });
  assert.deepEqual(errors, []);
  const version = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].manifest.version);
  const report = { version, checks, errors };
  await writeFile('artifacts/multi-delete.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
