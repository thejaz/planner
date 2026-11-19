import { assertTestVault } from './paths.mjs';
// Native checks for the consistency/usability fixes after 0.2.49: palette actions
// resolve an open activity edit first, confirmations keep failures inline, Shift
// plans validates input, dialog footers share one order, and the extracted
// capture options menu keeps its keyboard behavior.
import { plannerUI } from './planner-ui.mjs';
import { chooseCapture } from './capture-choice.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], path = '2005-03-01.md';
const text = '## plan for 1 mar 05\n### morning\n- [x] 09:00 (n/a) : start\n- [x] 09:30 (30) : chp\n- [ ] 10:00 (30) : mdr\n### afternoon\n### evening\n\nCHP = 30\nSUM = 30\nKeep annotation.\n';
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await assertTestVault(page);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(async ({ path, text }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false;
    const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    await c.index(); const v = await p.open(); v.switchMode('day'); await v.navigate('2005-03-01');
  }, { path, text });
  const raw = () => page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.port.read(path), path);
  const settled = () => page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    do { while (c.timers.size) await new Promise(r => setTimeout(r, 50)); await c.mutation; } while (c.timers.size);
  });
  const row = i => page.locator(`.planner-row[data-index="${i}"]`);
  const editor = page.locator('.planner-activity-editor');
  const input = editor.getByRole('textbox', { name: 'Edit activity input', exact: true });
  const modal = page.locator('.modal');
  const footer = async () => modal.locator('.planner-dialog-buttons button').allInnerTexts();
  await settled();

  // A palette command while editing asks Save/Discard/Stay; Stay keeps the draft and the row.
  await row(2).locator('.planner-label').click();
  await row(2).getByRole('button', { name: 'Edit', exact: true }).click();
  await editor.waitFor();
  await input.fill('10:00 45 mdr');
  await page.evaluate(() => app.commands.executeCommandById('thejaz-planner:delete'));
  await modal.getByRole('button', { name: 'Stay', exact: true }).click();
  await modal.waitFor({ state: 'detached' });
  assert.equal(await input.inputValue(), '10:00 45 mdr');
  assert.equal(await raw(), text);
  checks.push('A palette Delete while editing asks Save/Discard/Stay; Stay keeps the draft and changes nothing');

  // Discard closes the editor, then the delete confirmation for the same row opens.
  await page.evaluate(() => app.commands.executeCommandById('thejaz-planner:delete'));
  await modal.getByRole('button', { name: 'Discard', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
  await modal.getByRole('button', { name: 'Delete row', exact: true }).waitFor();
  assert.deepEqual((await footer()).map(t => t.toLowerCase()), ['cancel', 'delete row']);
  checks.push('Discard closes the editor before the delete confirmation; the confirmation shows Cancel then Delete row');

  // A failed confirmation stays open with the error inline and the note unchanged.
  await page.evaluate(() => {
    const c = app.plugins.plugins['thejaz-planner'].controller, apply = c.apply;
    c.apply = async () => { c.apply = apply; throw new Error('Injected delete failure'); };
  });
  await modal.getByRole('button', { name: 'Delete row', exact: true }).click();
  await modal.locator('.planner-error', { hasText: 'Injected delete failure' }).waitFor();
  assert.equal(await modal.count(), 1);
  assert(await modal.getByRole('button', { name: 'Delete row', exact: true }).isEnabled());
  assert.equal(await raw(), text);
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await modal.waitFor({ state: 'detached' });
  checks.push('A failed delete keeps its dialog open with the error inline and the button usable; the note is unchanged');

  // Shift plans rejects non-whole numbers inline, has Cancel, and applies valid input.
  await row(2).locator('.planner-label').click();
  await page.evaluate(() => app.commands.executeCommandById('thejaz-planner:shift'));
  const minutes = modal.getByRole('spinbutton', { name: 'Minutes to shift', exact: true });
  await minutes.waitFor();
  assert.deepEqual((await footer()).map(t => t.toLowerCase()), ['cancel', 'shift']);
  await minutes.fill('1.5'); await minutes.press('Enter');
  await modal.locator('.planner-error', { hasText: 'whole number' }).waitFor();
  assert.equal(await raw(), text);
  await minutes.fill('15'); await minutes.press('Enter');
  await modal.waitFor({ state: 'detached' });
  await settled();
  assert((await raw()).includes('- [ ] 10:15 (30) : mdr'));
  checks.push('Shift plans shows an inline error for 1.5, offers Cancel, and applies 15 minutes');

  // Create day uses the same footer and submits with Enter.
  await page.evaluate(async () => { const v = await app.plugins.plugins['thejaz-planner'].open(); await v.navigate('2005-03-02'); });
  if (await page.evaluate(() => !app.vault.getAbstractFileByPath('2005-03-02.md'))) {
    await page.getByRole('button', { name: 'Create day', exact: true }).click();
    await modal.waitFor();
    assert.equal(await modal.locator('.modal-title').innerText(), 'Create day | 2005-03-02');
    assert.deepEqual((await footer()).map(t => t.toLowerCase()), ['cancel', 'create day']);
    await page.keyboard.press('Enter');
    await modal.waitFor({ state: 'detached' });
    await page.waitForFunction(() => !!app.vault.getAbstractFileByPath('2005-03-02.md'));
  }
  await settled();
  checks.push('Create day titles its date, shows Cancel then Create day, and Enter creates the note');

  // The extracted options menu: keyboard choice, Escape returns focus to its button.
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  await chooseCapture(page, 'Entry mode', 'log');
  const mode = page.getByRole('button', { name: 'Entry mode', exact: true });
  await mode.focus(); await mode.press('ArrowDown');
  await page.getByRole('menu', { name: 'Entry mode', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('menu', { name: 'Entry mode', exact: true }).waitFor({ state: 'detached' });
  assert(await mode.evaluate(el => el === document.activeElement));
  assert.equal(await mode.getAttribute('data-value'), 'log');
  checks.push('Capture options menu selects by keyboard and Escape closes it with focus back on its button');

  assert.deepEqual(errors, []);
  await writeFile('artifacts/obsidian-ui-consistency.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await writeFile('artifacts/obsidian-ui-consistency-failure.json', JSON.stringify({ checks, errors, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
