import { assertTestVault } from './paths.mjs';
// Native checks for 0.2.51: E/F2 editing, focusing the activity list, the
// Activity/Report toggle and V, the compact editor's explanation, sectioned Help,
// the settings shortcut, the row Shift action with duration modes, 5-minute
// rounding settings and percent credit.
import { plannerUI } from './planner-ui.mjs';
import { chooseCapture } from './capture-choice.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], path = '2004-04-01.md';
const text = '## plan for 1 apr 04\n### morning\n- [x] 10:00 (n/a) : start\n- [ ] 11:00 (60) : chp\n- [ ] 11:30 (30) : mdr\n- [x] 12:00 (30) : done\n### afternoon\n### evening\n\nSUM = 0\n';
let original;
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await assertTestVault(page);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  page.on('pageerror', e => errors.push(e.message));
  original = await page.evaluate(() => structuredClone(app.plugins.plugins['thejaz-planner'].controller.settings));
  const load = () => page.evaluate(async ({ path, text }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    await c.updateSettings({ autoUpdate: false, roundTimes: false, roundCredits: false });
    const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    c.ingest(path, text);
    do { while (c.timers.size) await new Promise(r => setTimeout(r, 50)); await c.mutation; } while (c.timers.size);
    const v = await p.open(); v.switchMode('day'); await v.navigate('2004-04-01');
  }, { path, text });
  await load();
  const raw = () => page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.port.read(path), path);
  const settled = () => page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    do { while (c.timers.size) await new Promise(r => setTimeout(r, 50)); await c.mutation; } while (c.timers.size);
  });
  const row = i => page.locator(`.planner-row[data-index="${i}"]`);
  const editor = page.locator('.planner-activity-editor');
  const editInput = editor.getByRole('textbox', { name: 'Edit activity input', exact: true });
  const modal = page.locator('.modal');
  const activity = page.getByRole('button', { name: 'Activity', exact: true });
  const report = page.getByRole('button', { name: 'Report', exact: true });

  // 1. E and F2 open the compact editor on the selected activity.
  await row(1).locator('.planner-label').click(); await row(1).focus(); await row(1).press('e');
  await editor.waitFor(); assert.equal(await editInput.inputValue(), '11:00 60 chp');
  await editInput.press('Escape'); await editor.waitFor({ state: 'detached' });
  await row(1).focus(); await row(1).press('F2'); await editor.waitFor();
  await editInput.press('Escape'); await editor.waitFor({ state: 'detached' });
  checks.push('E and F2 open the compact editor for the selected activity; Escape closes it');

  // 2. Arrow keys from another planner control, or the command, focus the activity list.
  await page.getByRole('button', { name: 'Today', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  assert(await page.evaluate(() => document.activeElement?.classList.contains('planner-row')));
  await page.evaluate(async () => { const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(app.vault.getAbstractFileByPath('2004-04-01.md')); });
  await page.evaluate(() => app.commands.executeCommandById('thejaz-planner:focus-activities'));
  await page.waitForFunction(() => document.activeElement?.classList.contains('planner-row'));
  checks.push('Down from a planner control and the Focus activities command move focus to the activity list');

  // 3/4. Activity/Report segmented control: the current view uses the accent text; V toggles, but not while typing.
  assert.equal(await activity.getAttribute('aria-pressed'), 'true');
  const colours = await page.evaluate(() => {
    const active = document.querySelector('.planner-view-option.is-active'), probe = document.body.createDiv();
    probe.style.color = 'var(--text-accent)'; const accent = getComputedStyle(probe).color; probe.remove();
    return { active: getComputedStyle(active).color, accent };
  });
  assert.equal(colours.active, colours.accent);
  // The synthetic vault may have no summary for Report totals; check the mode itself.
  await report.click(); await page.waitForFunction(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.mode === 'review');
  assert.equal(await report.getAttribute('aria-pressed'), 'true');
  await report.focus(); await page.keyboard.press('v');
  await page.waitForFunction(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.mode === 'day');
  assert.equal(await activity.getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  const quick = page.getByRole('textbox', { name: 'Quick entry', exact: true });
  await quick.fill(''); await quick.press('v');
  assert.equal(await quick.inputValue(), 'v');
  assert.equal(await activity.getAttribute('aria-pressed'), 'true');
  await quick.fill(''); await quick.press('Escape');
  await page.evaluate(() => app.commands.executeCommandById('thejaz-planner:toggle-view'));
  await page.waitForFunction(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.mode === 'review');
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.switchMode('day'));
  checks.push('The Activity/Report control marks the current view in the accent colour; V and the command toggle it, but V types normally in a field');

  // 5. The compact editor explains percent credit, elapsed time and completion.
  await row(1).locator('.planner-label').click(); await row(1).focus(); await row(1).press('e'); await editor.waitFor();
  await editInput.fill('10:47 .25/ chp');
  const explanation = await editor.locator('.planner-edit-preview').innerText();
  for (const part of ['Ends 10:47: 47m after 10:00 (start).', 'Percent credit .25/ saved as 12/47.', 'Potential project credit: ', 'Planned: project credit is not counted until completed.'])
    assert(explanation.includes(part), `${part} missing from ${explanation}`);
  await editInput.press('Escape'); // Escape discards directly; no Save/Discard prompt.
  await editor.waitFor({ state: 'detached' });
  assert.equal(await raw(), text);
  checks.push('The compact editor explains end time, elapsed minutes, percent conversion, per-project credit and completion');

  // 6. Help is sectioned with key caps.
  await row(0).focus(); await row(0).press('?');
  await modal.getByText('Planner help', { exact: true }).waitFor();
  assert.deepEqual(await modal.locator('.planner-help-section h3').allInnerTexts(), ['Hot-day streak', 'Move around', 'Selected activity', 'Quick entry', 'Undo']);
  assert(await modal.locator('kbd', { hasText: /^E$/ }).count());
  assert(await modal.locator('kbd', { hasText: '.1/20' }).count());
  await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });
  checks.push('Help shows four titled sections with key caps, including E and percent syntax');

  // 7. Comma and the command open Planner settings.
  await row(0).focus(); await row(0).press(',');
  const settingsPage = () => browser.contexts().flatMap(c => c.pages()).find(p => p.url() === 'about:blank') ?? page;
  await settingsPage().locator('.vertical-tab-content').getByRole('heading', { name: 'Daily setup', exact: true }).waitFor();
  const rounding = settingsPage().locator('.vertical-tab-content .setting-item-name', { hasText: /^Round (entered times|credited minutes)$/ });
  assert.equal(await rounding.count(), 2);
  await page.evaluate(() => app.setting.close());
  await page.evaluate(() => app.commands.executeCommandById('thejaz-planner:open-settings'));
  await settingsPage().locator('.vertical-tab-content').getByRole('heading', { name: 'Daily setup', exact: true }).waitFor();
  await page.evaluate(() => app.setting.close());
  checks.push('Comma and the Open settings command open Planner settings, which offer both rounding options');

  // 8. Row Shift: enabled only for plans; durations can keep credit and record elapsed time.
  await row(1).locator('.planner-label').click();
  const shift = row(1).getByRole('button', { name: 'Shift', exact: true });
  assert(await shift.isEnabled());
  await row(3).locator('.planner-label').click();
  assert(await row(3).getByRole('button', { name: 'Shift', exact: true }).isDisabled());
  await row(1).locator('.planner-label').click(); await shift.click();
  await modal.getByRole('spinbutton', { name: 'Minutes to shift', exact: true }).fill('15');
  await modal.getByRole('combobox', { name: 'Durations', exact: true }).selectOption('elapsed');
  assert((await modal.locator('.planner-input-hint').innerText()).includes('30/45'));
  await modal.getByRole('button', { name: 'Shift', exact: true }).click();
  await modal.waitFor({ state: 'detached' }); await settled();
  const shifted = await raw();
  assert(shifted.includes('- [ ] 11:15 (60/75) : chp') && shifted.includes('- [ ] 11:30 (30/15) : mdr') && shifted.includes('- [x] 12:00 (30) : done'));
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await settled();
  assert.equal(await raw(), text);
  checks.push('Row Shift is disabled for completed rows; "Keep credit; record elapsed" shifts 15 minutes, records 60/75 and 30/15, and Undo restores the note');

  // 9/10. Rounding settings and percent credit in quick entry.
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.updateSettings({ roundTimes: true, roundCredits: true }));
  await row(0).locator('.planner-label').click();
  await row(0).getByRole('button', { name: 'Add below', exact: true }).click();
  await chooseCapture(page, 'Entry mode', 'plan');
  await quick.fill('10:47 .25/ chp');
  assert((await page.locator('.planner-preview').innerText()).includes('10:45 (10/45) : chp'));
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.updateSettings({ roundTimes: false, roundCredits: false }));
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  await quick.fill('10:47 .25/ chp');
  assert((await page.locator('.planner-preview').innerText()).includes('10:47 (12/47) : chp'));
  await quick.press('Enter'); await settled();
  assert((await raw()).includes('- [ ] 10:47 (12/47) : chp\n- [ ] 11:00 (60) : chp'));
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await settled();
  assert.equal(await raw(), text);
  checks.push('Rounding settings turn 10:47 .25/ into 10:45 (10/45); without them it saves 12/47 as ordinary minutes, and Undo restores the note');

  // 11. Rounded credit from the end time keeps the elapsed time it was taken from.
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.updateSettings({ roundCredits: true }));
  // The settings change redraws the view; type only into the redrawn entry.
  await settled(); await page.waitForTimeout(300);
  // Insert below the 10:00 start, so the elapsed time is 47 minutes.
  await row(0).locator('.planner-label').click();
  await row(0).getByRole('button', { name: 'Add below', exact: true }).click();
  await chooseCapture(page, 'Entry mode', 'plan');
  await quick.fill('10:47 chp');
  try { await page.locator('.planner-preview').filter({ hasText: '10:47 (45/47) : chp' }).waitFor({ timeout: 5000 }); }
  catch { throw Error(`Preview: ${await page.locator('.planner-preview').allInnerTexts()}`); }
  await quick.press('Enter'); await settled();
  assert((await raw()).includes('- [ ] 10:47 (45/47) : chp\n- [ ] 11:00 (60) : chp'));
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await settled();
  assert.equal(await raw(), text);
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.updateSettings({ roundCredits: false }));
  checks.push('With only credit rounding on, 10:47 chp saves 10:47 (45/47), keeping the elapsed 47 minutes, and Undo restores the note');

  assert.deepEqual(errors, []);
  await writeFile('artifacts/obsidian-shortcuts-shift.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await writeFile('artifacts/obsidian-shortcuts-shift-failure.json', JSON.stringify({ checks, errors, error: String(error) }, null, 2));
  throw error;
} finally {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  if (page && original) await page.evaluate(async state => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    await c.updateSettings({ autoUpdate: state.autoUpdate, roundTimes: false, roundCredits: false });
  }, original).catch(() => {});
  await browser.close();
}
