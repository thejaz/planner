// Synthetic native check (0.2.135): daily note prefix/suffix, combine, fill, correction through
// a mistyped time, records, the day-records table and the time zone list. With --screenshots it
// also captures the README images from synthetic notes only.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertTestVault } from './paths.mjs';
import { plannerUI } from './planner-ui.mjs';

const screenshots = process.argv.includes('--screenshots') || process.env.PLANNER_SCREENSHOTS === '1';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
const D = { combine: '2005-07-01', fill: '2005-07-02', correct: '2005-07-03', prefixed: '2005-07-04', show: '2005-07-08', tagged: '2005-07-09', over: '2005-07-10' };
let page;
const note = (title, rows, footer = 'SUM = 0') => `## plan for ${title}\n\n### morning\n${rows}\n\n### afternoon\n\n### evening\n\n---\n\n${footer}\n`;
try {
  page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await assertTestVault(page); page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.evaluate(async ({ D, notes }) => {
    const c = app.plugins.plugins['thejaz-planner'].controller; await c.whenIdle();
    c.__featureSettings = structuredClone(c.settings);
    c.__featureSplits = [app.workspace.leftSplit.collapsed, app.workspace.rightSplit.collapsed];
    Object.assign(c.settings, { autoUpdate: true });
    for (const code of ['STD', 'PRJ', 'GYM']) if (!c.settings.projectCodes.includes(code)) c.settings.projectCodes.push(code);
    Object.assign(c.settings.projectEmojis, { STD: '📚', PRJ: '🧭', GYM: '🏋️' });
    await c.saveSettings();
    const put = async (path, text) => { const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text); };
    for (const [path, text] of Object.entries(notes)) await put(path, text);
    for (const path of [`plan ${D.prefixed}.md`]) { const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.delete(f); }
    await c.index(); await c.whenIdle();
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
  }, { D, notes: {
    [`${D.combine}.md`]: note('1 jul 05', '- [x] 08:00 (n/a) : awake\n- [x] 08:18 (18) : setup\n- [x] 08:24 (6) : nve\n- [x] 08:26 (2) : org\n- [x] 08:28 (2) : nve\n- [x] 08:29 (1) : org\n- [x] 08:32 (3) : nve\n- [ ] ...'),
    [`${D.fill}.md`]: note('2 jul 05', '- [ ] 08:50 (n/a) : awake\n- [ ] 09:00 (10) : setup\n- [ ] 10:00 (5) : break'),
    [`${D.correct}.md`]: note('3 jul 05', '- [x] 06:17 (n/a) : awake\n- [ ] 06:25 (8) : chores\n- [ ] 06:35 (10) : iwbs\n- [ ] 05:23 (20) : breakfast\n- [ ] 05:26 (3) : setup\n- [ ] 06:26 (60) : prj\n- [ ] 05:35 (12) : preps\n- [ ] ...'),
    // A journal note sharing the date name: with a prefix, the planner leaves it alone.
    [`${D.prefixed}.md`]: 'Journal entry for this date.\n',
    '2005-07-05.md': note('5 jul 05', '- [x] 07:00 (n/a) : awake\n- [x] 10:00 (180) : std\n- [x] 11:00 (60) : prj', 'STD = 180\nPRJ = 60\nSUM = 240'),
    '2005-07-06.md': note('6 jul 05', '- [x] 07:00 (n/a) : awake\n- [x] 11:00 (240) : std\n- [x] 12:00 (60) : gym', 'STD = 240\nGYM = 60\nSUM = 300'),
    '2005-07-07.md': '## recorded totals\n\nSTD = 120\nPRJ = 90\nSUM = 210\n',
    [`${D.over}.md`]: note('10 jul 05', '- [x] 09:00 (n/a) : awake\n- [x] 10:00 (70/60) : prj\n- [x] 11:00 (90/60) : prj', 'PRJ = 160\nSUM = 160'),
    [`${D.tagged}.md`]: note('9 jul 05', '- [ ] 09:00 (n/a) : awake\n- [ ] 09:10 (10) : bhcna boasd asd & tea\n- [ ] 09:40 (30) : prj'),
    [`${D.show}.md`]: note('8 jul 05', '- [x] 06:30 (n/a) : awake\n- [x] 06:50 (20) : breakfast & news\n- [x] 09:20 (150) : std (chapter 4)\n- [x] 09:35 (15) : break\n- [x] 11:40 (100-25/125) : prj & email\n- [x] 12:30 (50) : lunch\n- [x] 14:30 (120/120) : std\n- [ ] 15:30 (60) : gym\n- [ ] 16:00 (30) : pottery\n- [ ] 17:30 (90) : prj',
      'STD = 270\nPRJ = 100\nSUM = 370')
  } });
  const raw = path => page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.port.read(path), path);
  const settled = () => page.evaluate(async () => { const c = app.plugins.plugins['thejaz-planner'].controller; await c.mutation; await c.whenIdle(); });
  const open = date => page.evaluate(async date => { const v = await app.plugins.plugins['thejaz-planner'].open(); v.switchMode('day'); v.draft = ''; await v.navigate(date); }, date);
  const row = n => page.locator(`.planner-row[data-index="${n}"]`);

  // Combine: repeated nve/org rows become one row with one amount per activity.
  await open(D.combine);
  await row(2).click(); await row(6).click({ modifiers: ['Shift'] });
  const combine = page.locator('.planner-row.is-current [data-planner-row-action="combine"]');
  assert.equal(await combine.innerText().then(t => t.replace(/\s+/g, ' ').trim().toLowerCase()), 'combine 5 selected m');
  await combine.click();
  const dialog = page.locator('.modal'); await dialog.waitFor();
  assert((await dialog.innerText()).includes('+ - [x] 08:32 (11-3) : nve & org'));
  await dialog.getByRole('button', { name: 'Combine', exact: true }).click(); await settled();
  assert((await raw(`${D.combine}.md`)).includes('- [x] 08:18 (18) : setup\n- [x] 08:32 (11-3) : nve & org\n- [ ] ...'), await raw(`${D.combine}.md`));
  await row(1).click();
  assert.equal(await page.locator('.planner-row.is-current [data-planner-row-action="combine"]').isVisible(), false);
  checks.push('Combine: five repeated rows preview and save as 08:32 (11-3) : nve & org; hidden for a single row');

  // Fill: the gap between setup (09:00) and break (starts 09:55).
  await open(D.fill);
  assert.deepEqual(await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.day.entries.map(e => e.label)), ['awake', 'setup', 'break']);
  // Select setup without clicking over another row's action strip, then open Add below.
  await page.evaluate(() => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.selected = 1; v.clearRowSelection(); v.paintSelection(); v.updatePreview(); v.focusEntry(); });
  const input = page.getByRole('textbox', { name: 'Quick entry', exact: true });
  await input.fill('fill : task');
  assert((await page.locator('.planner-preview').innerText()).includes('- [ ] 09:55 (55) : task'));
  await input.press('Enter'); await settled();
  assert((await raw(`${D.fill}.md`)).includes('- [ ] 09:00 (10) : setup\n- [ ] 09:55 (55) : task\n- [ ] 10:00 (5) : break'));
  checks.push('fill : task between 09:00 (10) and 10:00 (5) previews and saves 09:55 (55) : task');

  // Correct is available for a mistyped earlier time and continues through rows that would run backwards.
  await open(D.correct);
  await row(3).click();
  const correct = page.locator('.planner-row.is-current [data-planner-row-action="correct"]');
  assert.equal(await correct.isDisabled(), false);
  await correct.click();
  const fix = page.locator('.modal'); await fix.waitFor();
  assert((await fix.innerText()).includes('Also corrects the next 3 activities'), await fix.innerText());
  await fix.getByRole('button', { name: /^(apply|correct)/i }).first().click(); await settled();
  assert((await raw(`${D.correct}.md`)).includes('- [ ] 06:55 (20) : breakfast\n- [ ] 06:58 (3) : setup\n- [ ] 07:58 (60) : prj\n- [ ] 08:10 (12) : preps\n- [ ] ...'));
  checks.push('Correct is enabled after a mistyped time; rebuilding continues through the three rows that ran backwards');

  // Daily note prefix: a new day is created beside the journal note, which is left alone.
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.updateSettings({ dailyName: { kind: 'prefix', text: 'plan ' } }));
  await page.evaluate(async date => { const c = app.plugins.plugins['thejaz-planner'].controller; await c.index(); await c.create(date, ''); }, D.prefixed);
  assert.equal(await raw(`${D.prefixed}.md`), 'Journal entry for this date.\n');
  assert((await raw(`plan ${D.prefixed}.md`)).startsWith('## plan for 4 jul 05'));
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.days.has('2005-07-05.md')), true);
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.updateSettings({ dailyName: { kind: 'date', text: '' } }));
  checks.push('With prefix "plan ", Create day writes plan 2005-07-04.md, leaves the journal 2005-07-04.md untouched and keeps plain-named plans');

  // A planner edit that lifts a day above every earlier day marks its summary row; Undo restores it.
  const summary = 'thejaz-summary-feature.md', summaryText = () => raw(summary);
  await page.evaluate(async summary => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    await app.vault.create(summary, ['### Days', '2005-07-05 = 240 ❄️ ☁️', '2005-07-06 = 300', '2005-07-07 = 210', '2005-07-08 = 370', '',
      '### Projects', 'STD = 810', 'PRJ = 250', 'GYM = 60', '', 'Days (2005-07-05 - 2005-07-08)', ''].join('\n'));
    await c.index(); await c.whenIdle();
  }, summary);
  await open(D.show);
  const before = await summaryText();
  await page.evaluate(async () => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.selected = 7; await v.toggle(); });
  let marked = '';
  for (let tries = 0; tries < 40 && !marked.includes('==new record=='); tries++) { await settled(); await page.waitForTimeout(250); marked = await summaryText(); }
  assert(/^2005-07-08 = 430 .*==new record==$/m.test(marked), marked);
  const otherDays = text => text.split('\n').filter(line => /^2005-07-0[567] = /.test(line));
  assert.deepEqual(otherDays(marked), otherDays(before));
  const attention = await page.evaluate(() => [...app.plugins.plugins['thejaz-planner'].controller.issues.values()].filter(issue => /2005-07-08|thejaz-summary-feature/.test(issue)));
  assert.deepEqual(attention, []);
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.undo()); await settled();
  assert.equal(await summaryText(), before);
  checks.push('Completing a plan that lifts the day above every earlier day adds ==new record== to its summary row, with no attention entry; Undo restores it');

  // Records and the day-records table in Report.
  await open(D.show);
  // Undo and the scheduled reindex can repaint the record chips after navigation resolves.
  await page.locator('.planner-project-chip.is-record').filter({ hasText: 'STD' }).first().waitFor();
  const recordMark = await page.locator('.planner-project-chip.is-record').allInnerTexts();
  assert(recordMark.some(text => /STD/.test(text)), JSON.stringify(recordMark));
  if (screenshots) {
    await mkdir('docs/images', { recursive: true });
    await page.evaluate(() => document.querySelectorAll('.planner-row.is-current, .planner-row.is-selected').forEach(r => r.classList.remove('is-current', 'is-selected')));
    await page.locator('.planner-shell').screenshot({ path: 'artifacts/readme-activity.png' });
  }
  await page.evaluate(async date => {
    const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
    v.preset = 'custom'; v.rangeStart = '2005-07-01'; v.rangeEnd = '2005-07-10'; v.recordsOpen = true; v.switchMode('review');
  }, D.show);
  const records = page.locator('.planner-records');
  await records.waitFor();
  const cards = await records.locator('.planner-record').allInnerTexts();
  assert(cards.some(text => text.includes('STD') && text.includes('4h 30m') && text.includes(D.show)), JSON.stringify(cards));
  const table = page.locator('.planner-records-table');
  assert.deepEqual(await table.locator('th').allInnerTexts().then(list => list.map(t => t.toLowerCase())), ['date', 'credit', 'projects', 'source']);
  const sourceText = await table.locator('tbody tr').filter({ hasText: D.show }).first().locator('.planner-record-source').innerText();
  assert(/daily note/i.test(sourceText) && sourceText.includes(D.show), sourceText);
  assert.equal(await table.locator('details').count(), 0);
  assert.equal(await page.getByText('Evidence', { exact: true }).count(), 0);
  checks.push('Report shows Records (best day per project) and a day-records table whose Source is always visible');

  // Repeated warnings read once with their lines; Ignore hides them, Settings can restore them.
  const overRow = table.locator('tbody tr').filter({ hasText: D.over }).first();
  const overChecks = overRow.locator('.planner-record-checks .planner-check');
  assert.equal(await overChecks.count(), 1, await overRow.innerText());
  assert.deepEqual(await overChecks.first().locator('.planner-check-line').allTextContents(), ['5', '6']);
  await overChecks.first().locator('.planner-check-ignore').click();
  await page.waitForFunction(date => ![...document.querySelectorAll('.planner-records-table tbody tr')].find(tr => tr.textContent.includes(date))?.querySelector('.planner-record-checks .planner-check'), D.over);
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.settings.ignoredChecks.length), 2);
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.restoreIgnoredChecks());
  await page.waitForFunction(date => !![...document.querySelectorAll('.planner-records-table tbody tr')].find(tr => tr.textContent.includes(date))?.querySelector('.planner-record-checks .planner-check'), D.over);
  checks.push('Two over-credit warnings read once with lines 5 and 6; Ignore hides them, and Restore all brings them back');

  // Each day's recorded markers sit beside its credit; contexts on a soft badge.
  const markerBadges = table.locator('tbody tr').filter({ hasText: '2005-07-05' }).first().locator('.planner-record-marker');
  assert.equal(await markerBadges.count(), 2, await table.locator('tbody tr').filter({ hasText: '2005-07-05' }).first().innerText());
  assert.equal(await markerBadges.evaluateAll(list => list.filter(el => el.classList.contains('is-context')).length), 1);
  assert(await markerBadges.evaluateAll(list => list.every(el => el.getAttribute('aria-labelledby') || el.title)));
  checks.push('Day records shows the summary markers for 2005-07-05 beside its credit, the context marker on a badge, each named');
  if (screenshots) await page.locator('.planner-shell').screenshot({ path: 'artifacts/readme-report.png' });

  // The new tag follows each whole activity part, description included; projects get none.
  await open(D.tagged);
  // Nothing is new while indexing runs; wait for the redraw that follows it.
  await page.waitForFunction(() => document.querySelectorAll('.planner-row[data-index="1"] .planner-new-activity').length === 2, null, { timeout: 10000 }).catch(() => {});
  const tagged = await page.locator('.planner-row[data-index="1"] .planner-new-activity').allTextContents();
  assert.deepEqual(tagged, ['bhcna boasd asd', 'tea']);
  assert.equal(await page.locator('.planner-row[data-index="2"] .planner-new-activity').count(), 0);
  checks.push('The new tag follows the whole part, bhcna boasd asd, and each & part on its own; project rows get none');

  // 0.3.2: the ordinary day is offered in Create day; choosing it writes a real routine note, then the day from it.
  await page.evaluate(async () => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.switchMode('day'); await v.navigate('2005-07-11'); v.newDay(); });
  const routineDialog = page.locator('.modal'); await routineDialog.waitFor();
  const offered = await routineDialog.locator('select option').allTextContents();
  assert(offered.includes('🌞 ordinary day (new routine note)') && (await routineDialog.locator('p').first().innerText()).includes('adds it to your routines folder') && offered.includes('📄 blank day'), JSON.stringify(offered));
  await routineDialog.locator('select').selectOption({ label: '🌞 ordinary day (new routine note)' });
  await routineDialog.getByRole('button', { name: /^create day$/i }).click(); await routineDialog.waitFor({ state: 'detached' });
  const ordinary = await raw('2005-07-11.md');
  assert(ordinary.startsWith('## plan for 11 jul 05') && ordinary.includes('- [ ] 05:03 (18) : iwbs (wash & meditate)') && ordinary.includes('- [ ] 06:30 (55) : hike (gwezakwer)'), ordinary);
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2005-07-11.md')?.diagnostics.length), 0);
  const routine = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller, path = `${c.settings.routinesFolder}/🌞 ordinary day.md`;
    // One Undo removes the day and the new routine note together; Redo brings both back.
    await c.undo();
    const undone = await c.port.read('2005-07-11.md') === null && await c.port.read(path) === null;
    await c.redo();
    if (!undone || await c.port.read('2005-07-11.md') === null || await c.port.read(path) === null) throw new Error('Create day from the offer is not one undoable step');
    const text = await c.port.read(path);
    // An edit to the note takes effect: the next day made from it carries the change.
    await app.vault.modify(app.vault.getAbstractFileByPath(path), text.replace(': breakfast', ': brunch'));
    const choices = c.routineChoices();
    await c.create('2005-07-12', path);
    const edited = await c.port.read('2005-07-12.md');
    await app.vault.delete(app.vault.getAbstractFileByPath(path));
    return { path, text, choices, edited, offeredAgain: c.routineChoices().some(choice => choice.path.startsWith('offer:')) };
  });
  assert(routine.text?.startsWith('```\n## plan for D mon YY') && routine.text.includes('hike (gwezakwer)'), JSON.stringify(routine.text));
  assert.deepEqual(routine.choices.filter(choice => choice.name === '🌞 ordinary day').map(choice => choice.path), [routine.path]);
  assert(routine.edited.includes(': brunch') && !routine.edited.includes(': breakfast'), routine.edited);
  assert(routine.offeredAgain);
  checks.push('Choosing 🌞 ordinary day writes it as a fenced routine note that replaces the offer; edits to the note take effect, and deleting it brings the offer back');

  // Time zone is a list.
  const zone = await page.evaluate(async () => {
    app.setting.open(); app.setting.openTabById('thejaz-planner');
    await new Promise(resolve => setTimeout(resolve, 500));
    const tab = app.setting.pluginTabs.find(t => t.id === 'thejaz-planner'), select = tab.containerEl.querySelector('select.planner-time-zone');
    const result = { options: select?.options.length ?? 0, value: select?.value, saved: app.plugins.plugins['thejaz-planner'].controller.settings.timezone,
      radios: [...tab.containerEl.querySelectorAll('.planner-daily-name input[type=radio]')].map(r => r.value), steps: [] };
    // Daily note name: one choice of date only, prefix or suffix; the text field only for the last two.
    const c = app.plugins.plugins['thejaz-planner'].controller, affix = tab.containerEl.querySelector('input.planner-daily-affix');
    const example = () => tab.containerEl.querySelector('.planner-daily-example').textContent, hidden = () => getComputedStyle(affix).display === 'none';
    const pick = kind => { const r = tab.containerEl.querySelector(`.planner-daily-name input[value=${kind}]`); r.checked = true; r.dispatchEvent(new Event('change')); };
    const wait = () => new Promise(resolve => setTimeout(resolve, 300));
    result.steps.push({ hidden: hidden(), example: example() });
    pick('suffix'); await wait(); result.steps.push({ hidden: hidden(), example: example(), saved: c.settings.dailyName });
    // Typing alone saves nothing (0.3.0): half-typed text never becomes a name.
    affix.value = ' lo'; affix.dispatchEvent(new Event('input')); await wait(); result.typedOnly = c.settings.dailyName;
    affix.value = ' log'; affix.dispatchEvent(new Event('input')); affix.dispatchEvent(new Event('change')); await wait(); result.steps.push({ example: example(), saved: c.settings.dailyName });
    affix.value = ' log1'; affix.dispatchEvent(new Event('input')); affix.dispatchEvent(new Event('change')); await wait(); result.steps.push({ error: tab.containerEl.querySelector('.planner-daily-example').classList.contains('planner-error'), saved: c.settings.dailyName });
    pick('date'); await wait(); result.steps.push({ hidden: hidden(), saved: c.settings.dailyName });
    app.setting.close(); return result;
  });
  assert(zone.options > 100 && zone.value === zone.saved, JSON.stringify(zone));
  assert.deepEqual(zone.radios, ['date', 'prefix', 'suffix']);
  const [start, chosen, typed, invalid, back] = zone.steps;
  assert.equal(zone.typedOnly.kind, 'date', JSON.stringify(zone.typedOnly));
  assert(start.hidden && /^New days: \d{4}-\d{2}-\d{2}\.md$/.test(start.example), JSON.stringify(start));
  assert(!chosen.hidden && chosen.example === 'Type the suffix to use.' && chosen.saved.kind === 'date', JSON.stringify(chosen));
  assert(/^New days: \d{4}-\d{2}-\d{2} log\.md$/.test(typed.example) && typed.saved.kind === 'suffix' && typed.saved.text === ' log', JSON.stringify(typed));
  assert(invalid.error && invalid.saved.text === ' log', JSON.stringify(invalid));
  assert(back.hidden && back.saved.kind === 'date', JSON.stringify(back));
  checks.push('Time zone is a list; Daily note name is one choice of date only, prefix or suffix, with the field shown only when needed, a live example, invalid text refused');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/new-features.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  console.error(error); console.log(JSON.stringify({ checks, errors }, null, 2)); process.exitCode = 1;
} finally {
  await page?.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    if (c.__featureSettings) { c.settings = c.__featureSettings; delete c.__featureSettings; await c.saveSettings(); }
    const [left, right] = c.__featureSplits ?? [true, true]; delete c.__featureSplits;
    if (!left) app.workspace.leftSplit.expand(); if (!right) app.workspace.rightSplit.expand();
    for (const f of app.vault.getMarkdownFiles().filter(f => /^(?:plan )?2005-07-(?:0\d|1[012])\.md$|^thejaz-summary-feature\.md$/.test(f.path))) await app.vault.delete(f);
  }).catch(() => {});
  await browser.close();
}
