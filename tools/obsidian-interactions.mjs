import { assertTestVault } from './paths.mjs';
import { plannerUI } from './planner-ui.mjs';
import { chooseCapture } from './capture-choice.mjs';
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
  await page.bringToFront();
  await page.evaluate(() => app.setting.close());
  if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
  const check = text => { checks.push(text); console.log(text); };
  const raw = () => page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.port.read('2002-02-01.md'));
  const command = id => page.evaluate(async id => {
    await app.plugins.plugins['thejaz-planner'].controller.mutation;
    app.commands.executeCommandById(`thejaz-planner:${id}`);
  }, id);
  const row = index => page.locator('.planner-row').nth(index);
  const waitRows = count => page.waitForFunction(async count => {
    const c = app.plugins.plugins['thejaz-planner'].controller; await c.mutation;
    const v = app.workspace.getLeavesOfType('thejaz-planner')[0]?.view;
    return c.days.get('2002-02-01.md')?.entries.length === count && v?.day?.path === '2002-02-01.md' && v.day.entries.length === count && v.day.text === await c.port.read('2002-02-01.md');
  }, count);
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.summaryPath = '⌚.md'; c.settings.autoUpdate = true; await c.saveSettings();
    const text = '## plan for 1 feb 02\n\n### morning\n\n- [x] 09:00 (n/a) : awake\n- [x] 09:30 (30) : chp\n- [ ] 10:00 (30) : mdr\n- [ ] 10:30 (30) : hay\n\n### afternoon\n\n### evening\n\n---\n\nCHP = 30\nMDR = 0\nHAY = 0\nSUM = 30\n\nAn unrelated, editable personal note.\n';
    const file = app.vault.getAbstractFileByPath('2002-02-01.md');
    if (file) await app.vault.modify(file, text); else await app.vault.create('2002-02-01.md', text);
    await c.index(); const v = await p.open(); v.switchMode('day'); await v.navigate('2002-02-01');
  });
  await waitRows(4);
  await row(1).locator('.planner-label').click();
  await row(1).focus();
  await command('duplicate'); await waitRows(5);
  assert((await raw()).includes('- [ ] 09:30 (30) : chp'));
  await row(2).focus();
  await command('delete');
  await page.locator('.modal').getByRole('button', { name: 'Delete row', exact: true }).focus();
  await page.locator('.modal').getByRole('button', { name: 'Delete row', exact: true }).press('Enter'); await waitRows(4);
  check('Duplicate creates an unchecked plan; keyboard deletion removes only its selected row');

  await row(2).focus(); await command('move-down');
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2002-02-01.md')?.entries[3]?.label === 'mdr');
  await page.waitForFunction(() => !app.workspace.getLeavesOfType('thejaz-planner')[0].view.moving);
  await row(3).focus(); await command('move-up');
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2002-02-01.md')?.entries[2]?.label === 'mdr');
  check('Move up and down preserve complete row text');
  await page.waitForFunction(() => !app.workspace.getLeavesOfType('thejaz-planner')[0].view.moving);

  await row(2).focus(); await row(2).press('Shift+ArrowDown'); await command('shift');
  await page.getByRole('spinbutton', { name: 'Minutes to shift' }).fill('15');
  await page.getByRole('spinbutton', { name: 'Minutes to shift' }).press('Enter');
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2002-02-01.md')?.entries[3]?.time === '10:45');
  assert((await raw()).includes('- [ ] 10:15 (30) : mdr'));
  assert((await raw()).includes('- [x] 09:30 (30) : chp'));
  check('Keyboard extended selection shifts only selected unchecked endpoints and preserves credit');

  await row(2).focus(); await row(2).press('Enter');
  const editInput = page.getByRole('textbox', { name: 'Edit activity input', exact: true });
  await editInput.fill('10:10 30 mdr'); await editInput.press('Enter');
  // Wait for the editor to finish saving and close, not only for the note to change.
  await page.locator('.planner-activity-editor').waitFor({ state: 'detached' });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2002-02-01.md')?.entries[2]?.time === '10:10', null, { timeout: 8000 })
    .catch(async error => {
      const state = await page.evaluate(() => ({ editor: document.querySelector('.planner-activity-editor textarea')?.value ?? null,
        error: document.querySelector('.planner-activity-editor .planner-error')?.textContent ?? null, modal: document.querySelector('.modal')?.innerText ?? null,
        text: app.plugins.plugins['thejaz-planner'].controller.days.get('2002-02-01.md')?.text, active: document.activeElement?.outerHTML.slice(0, 120) }));
      throw new Error(`${error.message}
${JSON.stringify(state, null, 1)}`);
    });
  assert((await raw()).includes('- [ ] 10:45 (30) : hay'));
  const saved = await raw();
  await row(2).focus(); await row(2).press('Enter');
  await editInput.fill('10:10 30 discard this', { timeout: 6000 }).catch(async error => {
    const state = await page.evaluate(() => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
      return { editor: !!document.querySelector('.planner-activity-editor'), hasEditor: !!v.activityEditor, selected: v.selected, active: document.activeElement?.outerHTML.slice(0, 100),
        modal: document.querySelector('.modal')?.innerText?.slice(0, 200) ?? null }; });
    throw new Error(`${error.message}
${JSON.stringify(state)}`);
  });
  await page.keyboard.press('Escape');
  assert.equal(await raw(), saved);
  check('Compact edit changes one endpoint, leaves later times fixed, and Escape discards draft edits');

  await row(2).focus();
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  await chooseCapture(page, 'Entry mode', 'log');
  const quick = page.getByRole('textbox', { name: 'Quick entry' });
  await quick.fill('10:20 15 chp\n10:30 25 mdr');
  assert((await page.locator('.planner-preview').innerText()).includes('- [x] 10:30 (25) : mdr'));
  assert((await page.locator('.planner-preview-area').innerText()).includes('Inserts after'));
  await quick.press('Enter'); await waitRows(6);
  assert((await raw()).includes('- [ ] 10:45 (30) : hay'));
  assert((await raw()).includes('SUM = 70'), await raw());
  check('Multiline insertion preserves the selected plan and remaining schedule');
  await command('compact');
  await page.waitForFunction(() => !app.plugins.plugins['thejaz-planner'].controller.days.get('2002-02-01.md')?.text.includes('HAY = 0'));
  const compact = await raw();
  assert(compact.includes('MDR = 25') && compact.includes('CHP = 45') && compact.includes('SUM = 70'));
  await command('compact');
  assert.equal(await raw(), compact);
  check('Compact footer retains project order and SUM, and is idempotent');

  await row(3).focus(); await row(3).press('Control+Shift+O');
  await page.waitForFunction(() => {
    const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
    // The view may be mid-refresh; wait until the selection resolves.
    return app.workspace.activeLeaf.view.editor?.getCursor().line === v.day?.entries[v.selected]?.line;
  });
  const source = await page.evaluate(() => {
    const leaf = app.workspace.activeLeaf, view = leaf.view;
    return { path: view.file?.path, line: view.editor.getCursor().line };
  });
  const selectedLine = await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.day.entries[3].line);
  assert.equal(source.path, '2002-02-01.md'); assert.equal(source.line, selectedLine);
  check('Source shortcut positions the native editor at the selected activity line');
  await page.evaluate(async () => {
    const leaf = app.workspace.activeLeaf;
    await leaf.setViewState({ type: 'markdown', state: { file: '2002-02-01.md', mode: 'source' }, active: true });
    const editor = leaf.view.editor;
    editor.setCursor({ line: 0, ch: 3 });
    const text = editor.getValue(), at = text.indexOf('(25) : mdr') + 1;
    editor.replaceRange('26', editor.offsetToPos(at), editor.offsetToPos(at + 2));
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2002-02-01.md')?.recordedSum === 71);
  assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.editor.getCursor().line), 0);
  check('Native editor changes update totals after settling without moving an unaffected cursor');

  const concurrency = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller, editor = app.workspace.activeLeaf.view.editor;
    const day = await c.getDay('2002-02-01'), at = day.text.indexOf('(26) : mdr') + 1;
    const change = { path: day.path, base: day.text, label: 'Concurrent edit verification', patches: [{ start: at, end: at + 2, before: '26', after: '27' }] };
    editor.replaceRange('\nKeep this concurrent note.\n', editor.offsetToPos(editor.getValue().length));
    await c.apply(change);
    const rebased = editor.getValue().includes('Keep this concurrent note.') && editor.getValue().includes('(27) : mdr');
    const current = await c.getDay('2002-02-01'), at2 = current.text.indexOf('(27) : mdr') + 1;
    editor.replaceRange('28', editor.offsetToPos(at2), editor.offsetToPos(at2 + 2));
    let blocked = false;
    try { await c.apply({ path: current.path, base: current.text, label: 'Conflict verification', patches: [{ start: at2, end: at2 + 2, before: '27', after: '29' }] }); } catch { blocked = true; }
    let undoBlocked = false;
    try { await c.undo(); } catch { undoBlocked = true; }
    return { rebased, blocked, undoBlocked, retained: editor.getValue().includes('(28) : mdr') };
  });
  assert.deepEqual(concurrency, { rebased: true, blocked: true, undoBlocked: true, retained: true });
  check('Open-editor writes rebase unrelated edits and reject conflicting edits and unsafe undo');

  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].open(); });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  const beforeRefresh = await raw();
  await page.evaluate(async () => {
    const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
    for (let i = 0; i < 10; i++) await v.refresh();
  });
  assert.equal(await raw(), beforeRefresh);
  check('Repeated native refreshes leave note bytes unchanged');
  const automaticToggle = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller, before = await c.getDay('2002-02-01');
    const value = Number(before.entries.find(e => e.label === 'mdr').duration);
    const at = before.text.indexOf(`(${value}) : mdr`) + 1;
    c.settings.autoUpdate = false;
    try {
      await c.apply({ path: before.path, base: before.text, label: 'Automation disabled', patches: [{ start: at, end: at + String(value).length, before: String(value), after: String(value + 1) }] });
      const after = await c.getDay('2002-02-01');
      return after.recordedSum === before.recordedSum && after.text.includes(`(${value + 1}) : mdr`);
    } finally {
      c.settings.autoUpdate = true;
      const day = await c.getDay('2002-02-01');
      await c.apply({ path: day.path, base: day.text, label: 'Explicit reconciliation', patches: [] }, true);
    }
  });
  assert(automaticToggle);
  check('Automatic updates setting pauses derived writes; explicit reconciliation remains available');

  const routine = await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    const path = c.routines().find(f => f.path.includes('today is'))?.path;
    if (!path) throw Error('Current routine missing');
    const before = await c.port.read(path);
    let date;
    for (let d = 1; d <= 28; d++) {
      const candidate = `2098-03-${String(d).padStart(2, '0')}`;
      if (!app.vault.getAbstractFileByPath(`${candidate}.md`)) { date = candidate; break; }
    }
    if (!date) throw Error('No test date');
    const v = await p.open(); await v.navigate(date);
    return { path, before, date };
  });
  await page.getByRole('button', { name: 'Create day', exact: true }).click();
  await page.locator('.modal').getByRole('combobox').selectOption(routine.path);
  await page.locator('.modal').getByRole('button', { name: 'Create day', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.locator('.planner-capture-toggle').waitFor();
  const routineResult = await page.evaluate(async ({ path, date }) => {
    const c = app.plugins.plugins['thejaz-planner'].controller, d = await c.getDay(date);
    const existing = await c.create(date, '');
    return { allUnchecked: d.entries.every(e => !e.checked), reset: d.footers.every(f => f.value === 0), noFence: !d.text.includes('```'),
      unchangedExisting: existing.text === d.text, remembered: c.settings.lastRoutine, template: await c.port.read(path) };
  }, routine);
  assert(routineResult.allUnchecked && routineResult.reset && routineResult.noFence && routineResult.unchangedExisting);
  assert.equal(routineResult.remembered, routine.path); assert.equal(routineResult.template, routine.before);
  check('Native routine selection resets checks/totals, unwraps fences, remembers choice, and preserves template and existing days');

  await page.evaluate(async () => {
    const v = await app.plugins.plugins['thejaz-planner'].open(); await v.navigate('2026-10-19');
    v.selected = 4; v.contentEl.scrollTop = 250; v.testExpectedDayScroll = v.contentEl.scrollTop;
    v.switchMode('review'); v.contentEl.scrollTop = 400; v.switchMode('day');
  });
  const position = await page.evaluate(() => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; return { selected: v.selected, scroll: v.contentEl.scrollTop }; });
  assert.equal(position.selected, 4); assert.equal(position.scroll, await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.testExpectedDayScroll));
  check('Day/Review switching preserves selection and separate scroll positions');
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  for (const preset of ['7days', '30days', '6months', '12months', 'period', 'all']) {
    await page.getByLabel('Review period', { exact: true }).selectOption(preset);
    assert((await page.locator('.planner-review-total').innerText()).includes('known days'));
    assert((await page.locator('.planner main').innerText()).includes('unknown days are excluded'));
  }
  await page.getByLabel('Review start date').fill('1901-01-01'); await page.getByLabel('Review start date').dispatchEvent('change');
  await page.getByLabel('Review end date').fill('1901-01-02'); await page.getByLabel('Review end date').dispatchEvent('change');
  assert((await page.locator('.planner-review-total').innerText()).includes('0/2 known days'));
  assert.deepEqual(await page.locator('.planner-review-table tbody tr td:nth-child(2)').allTextContents(), ['?', '?']);
  check('All review presets render, label denominators, and preserve missing days as unknown');

  await page.evaluate(async () => {
    const v = await app.plugins.plugins['thejaz-planner'].open(); v.switchMode('day'); await v.navigate('2026-10-19');
  });
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  await quick.fill('11:20 20 chp');
  await quick.evaluate(el => { el.focus(); el.setSelectionRange(2, 5); });
  await page.evaluate(async () => { await app.workspace.getLeavesOfType('thejaz-planner')[0].view.refresh(); });
  assert.deepEqual(await quick.evaluate(el => ({ active: el === document.activeElement, start: el.selectionStart, end: el.selectionEnd, value: el.value })),
    { active: true, start: 2, end: 5, value: '11:20 20 chp' });
  await quick.fill(''); await quick.press('Escape');
  check('Background refresh retains quick-entry text, focus, and selection');
  await row(0).focus(); await row(0).press('?');
  assert(await page.getByText('Planner help', { exact: true }).isVisible());
  await page.keyboard.press('Escape');
  check('Keyboard help opens and cancels using only keys');
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile('artifacts/obsidian-interactions.json', JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await writeFile('artifacts/obsidian-interactions-failure.json', JSON.stringify({ checks, errors, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
