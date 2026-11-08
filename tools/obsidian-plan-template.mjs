import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], date = '2006-01-01', dayPath = `${date}.md`;
const templateA = '_Codes/Template A.md', templateB = '_Codes/Template B.md', invalid = '_Codes/Template invalid.md';
const summaryPath = 'Planner template verification.md';
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await page.waitForFunction(() => typeof app !== 'undefined' && app.vault);
  await assertTestVault(page);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async ({ dayPath, templateA, templateB, invalid, summaryPath }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false; c.settings.summaryPath = summaryPath; c.settings.lastRoutine = '';
    const store = async (path, text) => { const file = app.vault.getAbstractFileByPath(path); if (file) await app.vault.modify(file, text); else await app.vault.create(path, text); };
    await store(dayPath, '## plan for 1 jan 06\n\nMy personal introduction.\n\n### morning\n\n- [x] 09:00 (n/a) : awake\n- [x] 09:30 (30) : chp\nA handwritten annotation.\n- [ ] 10:00 (30) : mdr\n\n### afternoon\n\n### evening\n\n---\n\nCHP = 30\nMDR = 0\nSUM = 30\n\n[^1]: Keep my reference.\n');
    await store(templateA, '```\n## plan for ?? ??? 26\n### morning\n- [x] 08:00 (n/a) : awake\n- [x] 09:30 (60/90) : mdr\n### afternoon\n- [ ] 14:00 (30) : chp\n### evening\n- [ ] ?\nMDR = 999\nSUM = 999\n```');
    await store(templateB, '## plan for ?? ??? 26\n### morning\n- [ ] 10:00 (30) : mdr (second template)\n### afternoon\n### evening\nMDR = 0\nSUM = 0\n');
    await store(invalid, '### morning\n- [ ] 25:00 (30) : chp\n');
    await store(summaryPath, '### Days\n2006-01-01 = 30 🦥\n### Projects\nCHP = 30\nMDR = 0\n### Results\nDays (2006-01-01 - 2006-01-01): 1d\n');
    await c.index(); await c.saveSettings();
    await c.openSource(dayPath);
    const v = await p.open(); v.switchMode('day'); await v.navigate('2006-01-01');
  }, { dayPath, templateA, templateB, invalid, summaryPath });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  const raw = path => page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.port.read(path), path);
  const before = await raw(dayPath), summaryBefore = await raw(summaryPath), routineBefore = await raw(templateA);
  const open = async (path = templateA) => {
    await page.getByRole('button', { name: 'Replace plan from template', exact: true }).click();
    await page.getByLabel('Plan template', { exact: true }).selectOption(path);
  };
  const preview = () => page.getByRole('button', { name: 'Preview replacement', exact: true }).click();
  const apply = () => page.getByRole('button', { name: 'Replace plan', exact: true });
  await open(); assert(await apply().isDisabled()); await preview();
  const text = await page.locator('.planner-template-preview pre').innerText();
  assert(text.includes('- [ ] 09:30 (60/90) : mdr') && text.includes('SUM = 0'));
  assert(text.includes('My personal introduction.') && text.includes('A handwritten annotation.') && text.includes('[^1]: Keep my reference.'));
  assert(!text.includes('```') && !text.includes('[x]'));
  assert.equal(await raw(dayPath), before); assert.equal(await raw(summaryPath), summaryBefore);
  await page.keyboard.press('Escape'); assert.equal(await raw(dayPath), before);
  checks.push('Visible day action, exact plain-Markdown preview and keyboard cancellation make no note changes');

  await page.evaluate(() => { app.commands.executeCommandById('thejaz-planner:replace-plan'); });
  await page.getByLabel('Plan template', { exact: true }).selectOption(templateA);
  await preview(); await apply().click(); await page.locator('.modal').waitFor({ state: 'hidden' });
  await page.waitForFunction(({ dayPath, summaryPath }) => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    return c.days.get(dayPath)?.recordedSum === 0 && c.summaries.get(summaryPath)?.text.includes('2006-01-01 = 0');
  }, { dayPath, summaryPath });
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  assert.equal(await raw(dayPath), text); assert.equal(await raw(templateA), routineBefore);
  const summaryAfter = await raw(summaryPath);
  assert(summaryAfter.includes('CHP = 0'));
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.settings.lastRoutine), templateA);
  checks.push('Command and dialog replace an existing open-editor note, preserve prose/template, reset totals and update the summary even with automatic updates off');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(dayPath => app.plugins.plugins['thejaz-planner'].controller.days.get(dayPath)?.recordedSum === 30, dayPath);
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  assert.equal(await raw(dayPath), before); assert.equal(await raw(summaryPath), summaryBefore);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.waitForFunction(dayPath => app.plugins.plugins['thejaz-planner'].controller.days.get(dayPath)?.recordedSum === 0, dayPath);
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  assert.equal(await raw(dayPath), text); assert.equal(await raw(summaryPath), summaryAfter);
  checks.push('Native Undo and Redo restore the exact daily note and summary together');

  await open(templateB); await preview();
  await page.evaluate(async path => {
    const file = app.vault.getAbstractFileByPath(path);
    await app.vault.modify(file, (await app.vault.read(file)).replace('second template', 'updated template'));
  }, templateB);
  await apply().click();
  assert((await page.locator('.modal [role=alert]').innerText()).includes('template changed'));
  assert(await apply().isDisabled()); assert.equal(await raw(dayPath), text);
  checks.push('A changed template requires a fresh preview without changing the day');

  await preview();
  await page.evaluate(async dayPath => {
    const leaf = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === dayPath);
    const view = leaf.view;
    view.editor.setValue(view.editor.getValue().replace('A handwritten annotation.', 'Edited while previewing.'));
    await view.save();
  }, dayPath);
  const concurrent = await raw(dayPath);
  await apply().click();
  assert((await page.locator('.modal [role=alert]').innerText()).includes('changed elsewhere'));
  assert.equal(await raw(dayPath), concurrent);
  checks.push('Concurrent manual editing stops replacement and preserves the new text');

  await page.getByLabel('Plan template', { exact: true }).selectOption(invalid); await preview();
  assert((await page.locator('.modal [role=alert]').innerText()).includes('not a valid time'));
  assert(await apply().isDisabled()); assert.equal(await raw(dayPath), concurrent);
  checks.push('Invalid template times produce an inline error before any write');
  await page.getByLabel('Plan template', { exact: true }).selectOption(templateB); await preview();
  await page.screenshot({ path: 'artifacts/plan-template-preview.png' });
  await page.evaluate(async path => { await app.vault.trash(app.vault.getAbstractFileByPath(path), true); }, templateB);
  await apply().click();
  assert((await page.locator('.modal [role=alert]').innerText()).includes('template changed'));
  assert.equal(await raw(dayPath), concurrent); await page.keyboard.press('Escape');
  checks.push('A removed template is detected before replacement');

  const issues = await page.evaluate(async ({ date, templateA }) => {
    const c = app.plugins.plugins['thejaz-planner'].controller, original = await c.port.read(`${date}.md`);
    await c.create(date, templateA);
    let missing = '';
    try { await c.previewPlanReplacement('2097-01-01', templateA); } catch (e) { missing = e.message; }
    return { createPreserves: original === await c.port.read(`${date}.md`), missing };
  }, { date, templateA });
  assert(issues.createPreserves && issues.missing.includes('does not exist'));
  checks.push('Existing Create day remains non-destructive; replacement requires an existing day');
  const originalFolder = await page.evaluate(() => {
    const c = app.plugins.plugins['thejaz-planner'].controller, folder = c.settings.routinesFolder;
    c.settings.routinesFolder = '_No templates for this check'; return folder;
  });
  await page.getByRole('button', { name: 'Replace plan from template', exact: true }).click();
  assert(await page.getByLabel('Plan template', { exact: true }).isDisabled());
  assert(await page.getByRole('button', { name: 'Preview replacement', exact: true }).isDisabled());
  assert((await page.locator('.modal [role=alert]').innerText()).includes('No plan templates found'));
  await page.keyboard.press('Escape');
  await page.evaluate(folder => { app.plugins.plugins['thejaz-planner'].controller.settings.routinesFolder = folder; }, originalFolder);
  assert.equal(await raw(dayPath), concurrent);
  checks.push('An empty templates folder explains how to add templates and cannot overwrite the day');
  assert.deepEqual(errors, []);
  const report = { version: '0.2.24', checks, errors };
  await writeFile('artifacts/plan-template.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
