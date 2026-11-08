import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { plannerUI } from './planner-ui.mjs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], path = '2009-03-04.md', summary = 'Recorded totals verification.md';
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await page.waitForFunction(() => typeof app !== 'undefined' && app.vault);
  await assertTestVault(page);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed || [...document.querySelectorAll('button')].some(b => b.textContent === 'Trust author and enable plugins'));
  const trust = page.getByRole('button', { name: 'Trust author and enable plugins', exact: true });
  if (await trust.count()) await trust.click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  await page.evaluate(() => app.setting.close());
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(async ({ path, summary }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false; c.settings.summaryPath = summary;
    const store = async (name, text) => {
      const f = app.vault.getAbstractFileByPath(name);
      if (f) await app.vault.modify(f, text); else await app.vault.create(name, text);
    };
    await store(path, '## recorded totals\r\n\r\nCHP = 120\r\nFRM = 90\r\nSUM = 210\r\n\r\nHistorical figures only; annotation remains.\r\n');
    await store(summary, '### Days\n2009-03-04 = 210 ❄️\n### Projects\nCHP = 120\nFRM = 90\n### Results\nDays (2009-03-04 - 2009-03-04): 1d\n');
    await c.index(); const v = await p.open(); v.project = ''; v.switchMode('day'); await v.navigate('2009-03-04');
  }, { path, summary });
  const raw = name => page.evaluate(name => app.plugins.plugins['thejaz-planner'].controller.port.read(name), name);
  const original = await raw(path), summaryOriginal = await raw(summary);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  assert(await page.locator('.planner-recorded-description').isVisible());
  assert((await page.locator('.planner-total-line').innerText()).includes('3h 30m recorded'));
  assert.equal(await page.locator('.planner-row, .planner-capture').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Replace plan from template', exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.days.get(path).diagnostics, path), []);
  assert.equal(await raw(path), original); assert.equal(await raw(summary), summaryOriginal);
  await page.screenshot({ path: 'artifacts/recorded-totals-day.png' });
  checks.push('Recorded-only Day shows source-edit guidance and project figures without capture/activity tools or spurious conflicts; opening/rendering changes no bytes');
  await page.evaluate(() => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.preset = 'custom'; v.rangeStart = '2009-03-04'; v.rangeEnd = '2009-03-04'; v.switchMode('review'); });
  assert((await page.locator('.planner-review-total').innerText()).includes('3h 30m'));
  await page.locator('.planner-day-records').evaluate(el => { el.open = true; });
  assert.equal(await page.locator('.planner-record-kind').innerText(), 'recorded totals');
  await page.getByRole('combobox', { name: 'Project filter', exact: true }).selectOption('FRM');
  assert((await page.locator('.planner-review-total').innerText()).includes('1h 30m'));
  checks.push('Review identifies recorded totals and counts full/project-filtered minutes accurately');
  const guarded = await page.evaluate(async path => {
    const c = app.plugins.plugins['thejaz-planner'].controller, day = c.days.get(path);
    try { await c.apply({ path, base: day.text, patches: [{ start: 0, end: 0, before: '', after: '- [ ] ?\n' }], label: 'Test activity guard' }); return false; }
    catch (error) { return error.message.includes('recorded totals'); }
  }, path);
  assert(guarded); assert.equal(await raw(path), original);
  checks.push('Controller rejects activity mutations before writing a totals-only note');
  await page.evaluate(async ({ path, text }) => {
    const c = app.plugins.plugins['thejaz-planner'].controller; c.settings.autoUpdate = true;
    await app.vault.modify(app.vault.getAbstractFileByPath(path), text);
  }, { path, text: original.replace('FRM = 90', 'FRM = 100').replace('SUM = 210', 'SUM = 220') });
  await page.waitForFunction(summary => app.plugins.plugins['thejaz-planner'].controller.summaries.get(summary)?.rows.some(row => row.value === 220), summary);
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  const valid = await raw(path), validSummary = await raw(summary);
  assert.equal(valid, original.replace('FRM = 90', 'FRM = 100').replace('SUM = 210', 'SUM = 220'));
  assert(validSummary.includes('FRM = 100'), validSummary); assert(validSummary.includes('CHP = 120'));
  checks.push('Manual recorded project/SUM edit updates the corresponding summary automatically while retaining exact CRLF daily source and annotation');
  await page.evaluate(async ({ path, text }) => { await app.vault.modify(app.vault.getAbstractFileByPath(path), text); }, { path, text: valid.replace('SUM = 220', 'SUM = 221') });
  await page.waitForFunction(path => app.plugins.plugins['thejaz-planner'].controller.days.get(path)?.diagnostics.some(d => d.code === 'recorded-sum-conflict'), path);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  assert.equal(await raw(summary), validSummary); assert((await raw(path)).includes('SUM = 221'));
  await page.evaluate(async ({ path, text }) => { await app.vault.modify(app.vault.getAbstractFileByPath(path), text); const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.switchMode('day'); await v.navigate('2009-03-04'); }, { path, text: valid + '\r\n- [ ] ?\r\n' });
  await page.waitForFunction(path => app.plugins.plugins['thejaz-planner'].controller.days.get(path)?.diagnostics.some(d => d.code === 'mixed-recorded-day'), path);
  assert((await page.locator('.planner-diagnostics').innerText()).includes('cannot also have activity checkboxes'));
  assert.equal(await page.locator('.planner-row').count(), 0);
  assert.equal(await raw(summary), validSummary);
  checks.push('Mismatched SUM and mixed checkboxes show specific corrective errors, preserve source figures and block summary changes');
  await page.evaluate(async ({ path, text }) => {
    const p = app.plugins.plugins['thejaz-planner']; p.controller.settings.autoUpdate = false;
    await app.vault.modify(app.vault.getAbstractFileByPath(path), text); await p.controller.index();
    for (const leaf of app.workspace.getLeavesOfType('thejaz-planner')) leaf.detach();
    await app.plugins.disablePlugin('thejaz-planner'); await app.plugins.enablePlugin('thejaz-planner');
  }, { path, text: valid });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  await page.evaluate(async () => { const v = await app.plugins.plugins['thejaz-planner'].open(); await v.navigate('2009-03-04'); });
  assert(await page.locator('.planner-recorded-description').isVisible()); assert.equal(await raw(path), valid);
  checks.push('Plugin reload reparses recorded totals from Markdown and preserves the record');
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], path = '2009-03-05.md', text = '## recorded totals\n\nSUM = 0\n';
    const file = app.vault.getAbstractFileByPath(path);
    if (file) await app.vault.modify(file, text); else await app.vault.create(path, text);
    await p.controller.index(); const view = await p.open(); await view.navigate('2009-03-05');
  });
  assert.deepEqual(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2009-03-05.md').diagnostics), []);
  assert((await page.locator('.planner-total-line').innerText()).includes('0h 00m recorded'));
  assert(!(await page.locator('.planner-total-line').innerText()).includes('incomplete'));
  checks.push('Explicit zero-only recorded day is complete without inventing a project allocation');
  assert.deepEqual(errors, []);
  const version = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].manifest.version);
  const report = { version, checks, errors }; await writeFile('artifacts/recorded-totals.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
