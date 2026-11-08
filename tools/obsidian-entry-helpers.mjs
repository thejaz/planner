import { assertTestVault } from './paths.mjs';
// Native checks for 0.2.52: segmented Activity/Report control, shortcuts that keep
// working after redraws and clicks on empty space, the shared shortcut table,
// configurable activity helpers, semicolon fields and one-fraction percent credit.
import { plannerUI } from './planner-ui.mjs';
import { chooseCapture } from './capture-choice.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], path = '2003-03-01.md';
const text = '## plan for 1 mar 03\n### morning\n- [x] 10:00 (n/a) : start\n- [ ] 11:00 (60) : walk\n### afternoon\n### evening\n\nSUM = 0\n';
let original;
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await assertTestVault(page);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  page.on('pageerror', e => errors.push(e.message));
  original = await page.evaluate(() => structuredClone(app.plugins.plugins['thejaz-planner'].controller.settings));
  await page.evaluate(async ({ path, text }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    await c.updateSettings({ autoUpdate: false, roundTimes: false, roundCredits: false });
    const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    c.ingest(path, text);
    do { while (c.timers.size) await new Promise(r => setTimeout(r, 50)); await c.mutation; } while (c.timers.size);
    const v = await p.open(); v.switchMode('day'); await v.navigate('2003-03-01');
  }, { path, text });
  const raw = () => page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.port.read(path), path);
  const mode = () => page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.mode);
  const settled = () => page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    do { while (c.timers.size) await new Promise(r => setTimeout(r, 50)); await c.mutation; } while (c.timers.size);
  });
  const row = i => page.locator(`.planner-row[data-index="${i}"]`);
  const modal = page.locator('.modal');
  const activity = page.getByRole('button', { name: 'Activity', exact: true });
  const report = page.getByRole('button', { name: 'Report', exact: true });

  // Segmented control in the header's bordered style, sized to its content.
  const look = await page.locator('.planner-view-toggle').evaluate(el => {
    const style = getComputedStyle(el), active = el.querySelector('.is-active'), idle = el.querySelector('.planner-view-option:not(.is-active)');
    return { width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, border: style.borderTopWidth, radius: style.borderTopLeftRadius,
      activeBg: getComputedStyle(active).backgroundColor, idleBg: getComputedStyle(idle).backgroundColor };
  });
  assert(look.width < 260, JSON.stringify(look)); assert.equal(look.height, 32); assert.equal(look.border, '1px'); assert.equal(look.radius, '7px');
  assert.notEqual(look.activeBg, look.idleBg);
  checks.push('Activity/Report is a compact 32px segmented control with a 1px border and 7px radius, the current view tinted');

  // V keeps working after the view redraws, after clicking empty space, and from other controls.
  await report.click(); assert.equal(await mode(), 'review');
  await page.keyboard.press('v'); assert.equal(await mode(), 'day');
  await page.keyboard.press('v'); assert.equal(await mode(), 'review');
  await page.locator('.planner-review-filters').click({ position: { x: 2, y: 2 } }).catch(() => page.locator('.planner').click({ position: { x: 5, y: 5 } }));
  await page.locator('.planner').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('v'); assert.equal(await mode(), 'day');
  await page.getByRole('button', { name: 'Today', exact: true }).focus(); await page.keyboard.press('v'); assert.equal(await mode(), 'review');
  await page.keyboard.press('?'); await modal.getByText('Planner help', { exact: true }).waitFor(); await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'detached' });
  await page.keyboard.press('v'); assert.equal(await mode(), 'day');
  checks.push('V switches views right after clicking an option, after clicking empty space, from header buttons and after Help, in both views');

  // One shortcut table: E from another control edits; Enter on a row button still clicks it; typing is never intercepted.
  await row(1).locator('.planner-label').click();
  await page.getByRole('button', { name: 'Today', exact: true }).focus();
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.navigate('2003-03-01'));
  await row(1).locator('.planner-label').click();
  await page.getByRole('button', { name: 'Keyboard help', exact: true }).focus(); await page.keyboard.press('e');
  await page.locator('.planner-activity-editor').waitFor();
  const editInput = page.getByRole('textbox', { name: 'Edit activity input', exact: true });
  await editInput.press('End'); await editInput.press('v'); assert((await editInput.inputValue()).endsWith('v'));
  await editInput.press('Escape'); await page.locator('.planner-activity-editor').waitFor({ state: 'detached' });
  await row(1).locator('.planner-label').click();
  await row(1).getByRole('button', { name: 'Add below', exact: true }).focus(); await page.keyboard.press('Enter');
  const quick = page.getByRole('textbox', { name: 'Quick entry', exact: true });
  await page.waitForFunction(() => document.activeElement?.matches('textarea[data-planner-key="quick-entry"]'));
  assert.equal(await page.locator('.planner-activity-editor').count(), 0);
  await quick.fill(''); await quick.press('Escape');
  checks.push('E edits the selected activity from another control, typing V in a field types it, and Enter on a row button still activates that button');

  // Activity helpers: the configured list plus project codes; day labels are no longer copied.
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.updateSettings({ activityHelpers: ['nap', 'walk'] }));
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  let chips = await page.locator('.planner-capture .planner-suggestion').allInnerTexts();
  assert.deepEqual(chips.slice(0, 2).map(t => t.toLowerCase()), ['nap', 'walk']);
  assert(!chips.map(t => t.toLowerCase()).includes('start'), chips.join(','));
  await quick.fill('10:30 na');
  chips = await page.locator('.planner-capture .planner-suggestion').allInnerTexts();
  assert.deepEqual(chips.map(t => t.toLowerCase()), ['nap']);
  await page.locator('.planner-capture .planner-suggestion').first().click();
  assert.equal(await quick.inputValue(), '10:30 nap');
  await quick.fill(''); await quick.press('Escape');
  await page.evaluate(() => { app.setting.open(); app.setting.openTabById('thejaz-planner'); });
  const settingsPage = browser.contexts().flatMap(c => c.pages()).find(p => p.url() === 'about:blank') ?? page;
  const helpers = settingsPage.getByRole('textbox', { name: 'Activity helpers', exact: true });
  assert.equal(await helpers.inputValue(), 'nap, walk');
  await settingsPage.locator('.setting-item').filter({ has: settingsPage.locator('.setting-item-name', { hasText: /^Activity helpers$/ }) }).locator('button').click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.settings.activityHelpers.join() === 'break,free,buffer,setup,awake,lunch,dinner,breakfast,procrastination');
  assert.equal(await helpers.inputValue(), 'break, free, buffer, setup, awake, lunch, dinner, breakfast, procrastination');
  await helpers.fill('Break, gym ,, Lunch'); await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.settings.activityHelpers.join() === 'break,gym,lunch');
  await page.evaluate(() => app.setting.close());
  checks.push('Activity helpers come from Settings (lowercase, comma-separated, Restore defaults) plus project codes; typing filters them and a click keeps the time');

  // Semicolon fields and one-fraction percent credit.
  await row(0).locator('.planner-label').click(); await row(0).getByRole('button', { name: 'Add below', exact: true }).click();
  await chooseCapture(page, 'Entry mode', 'plan');
  await quick.fill('11:00 .1-.1/ walk');
  assert((await page.locator('.planner-preview-area').innerText()).includes('one fraction, such as .25/'));
  await quick.fill('10:40 .5-.5/; chp & mdr');
  assert((await page.locator('.planner-preview').innerText()).includes('10:40 (20-20/40) : chp & mdr'));
  await quick.fill('.1/20 walk');
  assert((await page.locator('.planner-preview').innerText()).includes('10:20 (2/20) : walk'));
  await quick.fill('10:40; 30; read chapter 2'); await quick.press('Enter'); await settled();
  assert((await raw()).includes('- [ ] 10:40 (30) : read chapter 2'));
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await settled();
  assert.equal(await raw(), text);
  checks.push('One activity takes one fraction, a combined entry one per activity (chp & mdr; .5-.5/ is 20-20/40), .1/20 credits 2 of 20 minutes, and semicolons keep a trailing number in the label');

  // Redo also answers to Ctrl+Y.
  await row(1).locator('.planner-label').click(); await row(1).press('Space'); await settled();
  assert((await raw()).includes('- [x] 11:00 (60) : walk'));
  await row(0).focus(); await page.keyboard.press('Control+z'); await settled(); assert.equal(await raw(), text);
  await row(0).focus(); await page.keyboard.press('Control+y'); await settled();
  assert((await raw()).includes('- [x] 11:00 (60) : walk'));
  await page.keyboard.press('Control+z'); await settled(); assert.equal(await raw(), text);
  checks.push('Space toggles; Ctrl+Z undoes and Ctrl+Y redoes from the activity list');

  assert.deepEqual(errors, []);
  await writeFile('artifacts/obsidian-entry-helpers.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await writeFile('artifacts/obsidian-entry-helpers-failure.json', JSON.stringify({ checks, errors, error: String(error) }, null, 2));
  throw error;
} finally {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  if (page && original) await page.evaluate(async state => {
    await app.plugins.plugins['thejaz-planner'].controller.updateSettings({ autoUpdate: state.autoUpdate, activityHelpers: state.activityHelpers });
  }, original).catch(() => {});
  await browser.close();
}
