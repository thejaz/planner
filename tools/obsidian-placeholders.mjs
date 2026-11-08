import { assertTestVault } from './paths.mjs';
import { plannerUI } from './planner-ui.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { chooseCapture } from './capture-choice.mjs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], path = '2009-01-01.md', summary = 'Placeholder verification.md';
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  assert(page); await page.waitForFunction(() => typeof app !== 'undefined' && app.vault);
  await assertTestVault(page);
  const trust = page.getByRole('button', { name: 'Trust author and enable plugins', exact: true });
  if (await trust.count()) await trust.click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  await page.evaluate(() => app.setting.close());
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async ({ path, summary }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false; c.settings.summaryPath = summary;
    const store = async (path, text) => {
      if (path === summary) text = text.replace(/^([A-Z]+) =/gm, (row, code) => c.settings.projectEmojis[code] ? `${c.settings.projectEmojis[code]} ${row}` : row);
      const f = app.vault.getAbstractFileByPath(path);
      if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    };
    await store(path, '## plan for 1 jan 09\n### morning\n- [x] 09:00 (n/a) : awake\n- [x] 10:00 (60) : chp\n### afternoon\n---\nCHP = 60\nSUM = 60\nKeep this annotation.\n');
    await store(summary, '### Days\n2009-01-01 = 60 🦥\n### Projects\nCHP = 60\n### Results\nDays (2009-01-01 - 2009-01-01): 1d\n');
    await c.index(); const v = await p.open(); v.switchMode('day'); await v.navigate('2009-01-01');
  }, { path, summary });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  await page.evaluate(async () => { const c = app.plugins.plugins['thejaz-planner'].controller; await c.mutation; c.settings.autoUpdate = true; });
  const row = i => page.locator(`.planner-row[data-index="${i}"]`);
  const raw = file => page.evaluate(file => app.plugins.plugins['thejaz-planner'].controller.port.read(file), file);
  const count = n => page.waitForFunction(({ path, n }) => app.plugins.plugins['thejaz-planner'].controller.days.get(path)?.entries.length === n, { path, n });
  const settled = () => page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  const compose = async (after, text, mode) => {
    await row(after).locator('.planner-label').click();
    await row(after).getByRole('button', { name: 'Add below', exact: true }).click();
    await chooseCapture(page, 'Entry mode', mode);
    const input = page.getByRole('textbox', { name: 'Quick entry', exact: true });
    await input.fill(text); return input;
  };
  const baselineSummary = await raw(summary);
  const quick = await compose(1, '?\n12:55 >', 'log');
  // Since 0.2.120 a bare ? is a gap: nothing about it is known.
  assert((await page.locator('.planner-preview').innerText()).includes('- [ ] ...'));
  assert((await page.locator('.planner-preview').innerText()).includes('- [ ] 12:55 (n/a) : >'));
  await quick.press('Enter'); await count(4); await settled();
  assert((await raw(path)).includes('- [ ] ...\n- [ ] 12:55 (n/a) : >'));
  assert.equal(await raw(summary), baselineSummary);
  checks.push('Quick-entry preview and multiline save create exact unchecked Markdown in Log mode; ? saves the gap ...');
  // Notes written earlier still hold unknown ? rows; the remaining checks cover them.
  await page.evaluate(async path => {
    const c = app.plugins.plugins['thejaz-planner'].controller, f = app.vault.getAbstractFileByPath(path);
    const text = (await app.vault.read(f)).replace('- [ ] ...\n', '- [ ] ?\n'); await app.vault.modify(f, text);
  }, path);
  await page.waitForFunction(path => app.plugins.plugins['thejaz-planner'].controller.days.get(path)?.entries[2]?.label === '?', path);
  await page.waitForFunction(() => document.querySelector('.planner-total-line')?.textContent.includes('2 unknown activities'));
  checks.push('An existing unknown ? row is still read as unknown; the unknown plan count is visible');

  await row(2).locator('.planner-label').click(); await row(2).press('Space'); await settled();
  await page.waitForFunction(() => document.querySelector('.planner-total-line')?.textContent.includes('incomplete'));
  assert((await raw(path)).includes('- [x] ?')); assert((await raw(path)).includes('SUM = 60'));
  assert.equal(await raw(summary), baselineSummary);
  checks.push('Checking an unknown row marks totals incomplete without replacing authoritative daily or summary values');

  const logged = await compose(3, '13:15 0 chp', 'log');
  await logged.press('Enter'); await count(5); await settled();
  assert((await raw(path)).includes('- [x] 13:15 (20) : chp'));
  assert((await page.locator('.planner-totals').innerText()).includes('1h 20m known completed credit'));
  assert((await page.locator('.planner-project-totals').innerText()).includes('1h 20m'));
  assert((await raw(path)).includes('SUM = 60')); assert.equal(await raw(summary), baselineSummary);
  checks.push('A timed arrow anchors subsequent elapsed calculation; known completed credit remains visible while recorded totals are protected');

  await row(3).locator('.planner-label').click(); await row(3).press('Space'); await settled();
  await page.waitForFunction(() => document.querySelector('.planner-totals')?.textContent.includes('2 completed activities have unknown credit'));
  const beforeUndo = await raw(path);
  await row(3).press('Control+z'); await settled();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2009-01-01.md')?.entries[3]?.checked === false);
  await row(3).press('Control+Shift+z'); await settled();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2009-01-01.md')?.entries[3]?.checked === true);
  assert.equal(await raw(path), beforeUndo); assert.equal(await raw(summary), baselineSummary);
  checks.push('Checked timed arrows are unresolved credit, not zero; Undo/Redo restore exact placeholder state without summary changes');

  await page.evaluate(() => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.preset = 'custom'; v.rangeStart = '2009-01-01'; v.rangeEnd = '2009-01-01'; v.switchMode('review'); });
  assert((await page.locator('.planner-review-total').innerText()).includes('incomplete'));
  await page.locator('.planner-day-records > summary').click();
  assert((await page.locator('.planner-review-table').innerText()).includes('1h 00m'));
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.switchMode('day'));
  checks.push('Review preserves the recorded total while explicitly labeling the period incomplete');

  for (const [index, time, label] of [[2, '12:20', 'buffer'], [3, '12:55', 'break']]) {
    await row(index).locator('.planner-label').click(); await row(index).press('F2');
    const editor = page.locator('.planner-activity-editor');
    const activity = editor.getByRole('textbox', { name: 'Edit activity input', exact: true });
    await activity.fill(`${time} n/a ${label}`); await activity.press('Enter'); await editor.waitFor({ state: 'detached' }); await settled();
  }
  assert((await raw(path)).includes('Keep this annotation.'));
  assert.equal(await raw(summary), baselineSummary);
  assert(!(await page.locator('.planner-total-line').innerText()).includes('incomplete'));
  checks.push('Placeholders can be explicitly resolved with inline editing while retaining surrounding Markdown and recorded totals');
  await page.screenshot({ path: 'artifacts/placeholders.png' });
  assert.deepEqual(errors, []);
  const version = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].manifest.version);
  const report = { version, checks, errors };
  await writeFile('artifacts/placeholders.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
