import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], date = '2006-01-01', dayPath = `${date}.md`;
const templateA = 'THEJAZ/Template A.md', templateB = 'THEJAZ/Template B.md', invalid = 'THEJAZ/Template invalid.md';
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
  // 0.3.2: with no routine notes, the ordinary day is offered as a new routine note; nothing is written until applied.
  const offered = await page.getByLabel('Plan template', { exact: true }).locator('option').allTextContents();
  assert.deepEqual(offered, ['🌞 ordinary day (new routine note)']);
  assert(await page.getByRole('button', { name: 'Preview replacement', exact: true }).isEnabled());
  await page.keyboard.press('Escape');
  assert.equal(await raw(dayPath), concurrent);
  // Applying the offer writes the routine note (creating the missing folder), then replaces the plan from it.
  const applied = await page.evaluate(async date => {
    const c = app.plugins.plugins['thejaz-planner'].controller, path = `${c.settings.routinesFolder}/🌞 ordinary day.md`;
    const before = await c.port.read(`${date}.md`);
    const plan = await c.previewPlanReplacement(date, 'offer:ordinary-day');
    const missingBefore = await c.port.read(path) === null;
    await c.applyPlanReplacement(plan);
    const note = await c.port.read(path), day = await c.port.read(`${date}.md`);
    await c.undo(); await c.undo();
    const restored = await c.port.read(`${date}.md`) === before, removed = await c.port.read(path) === null;
    const folder = app.vault.getAbstractFileByPath(c.settings.routinesFolder); if (folder) await app.vault.delete(folder, true);
    return { missingBefore, note, day, restored, removed };
  }, date);
  assert(applied.missingBefore && applied.note?.startsWith('```') && applied.day.includes('hike (gwezakwer)'), JSON.stringify(applied));
  assert(applied.restored && applied.removed, JSON.stringify(applied));
  checks.push('Replacing the plan from the offer writes the ordinary day note into a new routines folder first; Undo restores the day and removes the note');
  // A folder that differs only in letter case is used, and the note there counts as a routine; no folder set, no offer.
  const edge = await page.evaluate(async date => {
    const c = app.plugins.plugins['thejaz-planner'].controller, before = await c.port.read(`${date}.md`);
    await app.vault.createFolder('Case Check');
    c.settings.routinesFolder = 'case check';
    await c.applyPlanReplacement(await c.previewPlanReplacement(date, 'offer:ordinary-day'));
    const written = await c.port.read('Case Check/🌞 ordinary day.md') !== null;
    const listed = c.routineChoices().map(choice => choice.path);
    await c.undo(); await c.undo();
    const restored = await c.port.read(`${date}.md`) === before;
    await app.vault.delete(app.vault.getAbstractFileByPath('Case Check'), true);
    c.settings.routinesFolder = '';
    const unset = c.routineChoices();
    return { written, listed, restored, unset };
  }, date);
  assert(edge.written && edge.restored, JSON.stringify(edge));
  assert.deepEqual(edge.listed, ['Case Check/🌞 ordinary day.md']);
  assert.deepEqual(edge.unset, []);
  checks.push('A routines folder differing only in letter case receives the note and lists it as a routine; with no folder set nothing is offered');
  await page.evaluate(folder => { app.plugins.plugins['thejaz-planner'].controller.settings.routinesFolder = folder; }, originalFolder);
  checks.push('With no routine notes, Replace plan offers only the ordinary day as a new routine note, and closing it leaves the day unchanged');
  assert.deepEqual(errors, []);
  const report = { version: '0.2.24', checks, errors };
  await writeFile('artifacts/plan-template.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
