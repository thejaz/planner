import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
let original;
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await assertTestVault(page);
  page.on('pageerror', e => errors.push(e.message));
  if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  original = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    await c.mutation;
    const original = { settings: structuredClone(c.settings), journal: structuredClone(c.journal.data) };
    c.journal.data = { version: 1, operations: [] }; c.issues.clear();
    c.settings.autoUpdate = false; c.settings.summaryPath = 'Attention status verification.md';
    const store = async (path, raw) => {
      const f = app.vault.getAbstractFileByPath(path);
      if (f) await app.vault.modify(f, raw); else await app.vault.create(path, raw);
      c.ingest(path, raw);
    };
    await store('2008-01-01.md', '## plan for 1 jan 08\n### morning\n- [x] 08:00 (n/a) : awake\n- [x] 09:00 (60) : chp\n\n---\nCHP = 60\nSUM = 60\n');
    await store(c.settings.summaryPath, '### Days\n2008-01-01 = 60 🦥\n### Projects\nCHP = 60\nDays (2008-01-01 - 2008-01-01): 1d\n');
    await c.saveSettings();
    const v = await app.plugins.plugins['thejaz-planner'].open(); await v.navigate('2008-01-01');
    return original;
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  const hint = await page.locator('.planner-entry-help').innerText();
  // Interface copy is normalized to ASCII separators; elapsed help now shows the 30/ form.
  assert(hint.includes('End time | minutes | activity (time and minutes optional)'));
  assert(hint.includes('14:30 30/ prj records elapsed time'));
  assert(hint.includes('Calculate from 09:00'));
  const quick = page.getByRole('textbox', { name: 'Quick entry', exact: true });
  await quick.fill('10:00 chp');
  const blank = await page.locator('.planner-preview').innerText();
  await quick.fill('10:00 0 chp');
  assert.equal(await page.locator('.planner-preview').innerText(), blank);
  assert(blank.includes('(60) : chp'));
  await quick.fill('');
  checks.push('Visible syntax help shows optional minutes, blank/zero calculation, actual previous endpoint, and matching blank/zero previews');
  await page.screenshot({ path: 'artifacts/planner-entry-help.png' });

  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    const summary = app.vault.getAbstractFileByPath(c.settings.summaryPath);
    await app.vault.modify(summary, (await app.vault.read(summary)).replace('CHP = 60', 'CHP = 999'));
    c.ingest(summary.path, await app.vault.read(summary));
    const day = app.vault.getAbstractFileByPath('2008-01-01.md');
    const raw = (await app.vault.read(day)).replace('(60)', '(90)').replaceAll('= 60', '= 90');
    await app.vault.modify(day, raw); c.ingest(day.path, raw);
    // A completed source save whose old before-version no longer matches the
    // current summary: the original sticky retry condition.
    const before = raw.replace('(90)', '(60)').replaceAll('= 90', '= 60');
    c.journal.data.operations.push({ id: crypto.randomUUID(), time: Date.now(), label: 'Stale baseline verification', state: 'done', summaryPending: true,
      writes: [{ path: day.path, before, after: raw, state: 'saved' }] });
    await c.journal.save();
    await c.recheckSummary();
  });
  const unresolved = await page.evaluate(() => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    return { summary: c.issues.get('summary'), recovery: c.issues.get('recovery') };
  });
  assert(unresolved.summary.includes('Choose Review summary'));
  assert.equal(unresolved.recovery, undefined);
  assert(await page.evaluate(async () => (await app.plugins.plugins['thejaz-planner'].controller.port.read('Attention status verification.md')).includes('CHP = 999')));
  checks.push('A real remaining discrepancy is preserved with an explicit review/apply instruction; saved summary work is not mislabelled as an interrupted write');
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.summaryPreview());
  await page.getByRole('button', { name: 'Update summary', exact: true }).click();
  await page.waitForFunction(() => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    return !c.issues.has('summary') && !c.issues.has('recovery') && !c.journal.data.operations.some(o => o.summaryPending);
  });
  checks.push('Explicit reconciliation clears completed journal checkpoints and removes summary/recovery attention notices');

  const beforeRetry = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    const op = c.journal.data.operations.find(o => o.label === 'Stale baseline verification');
    op.summaryPending = true;
    c.issues.set('summary', 'Existing summary project totals disagree with daily records.');
    c.issues.set('recovery', 'An earlier update was interrupted.');
    await c.journal.save();
    return [await c.port.read('2008-01-01.md'), await c.port.read(c.settings.summaryPath)];
  });
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.retrySummary());
  const afterRetry = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    return { notes: [await c.port.read('2008-01-01.md'), await c.port.read(c.settings.summaryPath)], issues: [...c.issues.keys()], pending: c.journal.data.operations.some(o => o.summaryPending) };
  });
  assert.deepEqual(afterRetry.notes, beforeRetry);
  assert(!afterRetry.issues.includes('summary') && !afterRetry.issues.includes('recovery') && !afterRetry.pending);
  checks.push('Retry recognizes an already-current summary despite a stale historical baseline, clears both old notices, and writes neither note');

  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.journal.data.operations.find(o => o.label === 'Stale baseline verification').summaryPending = true;
    await c.journal.save();
    for (const leaf of app.workspace.getLeavesOfType('thejaz-planner')) leaf.detach();
    await app.plugins.disablePlugin('thejaz-planner'); await app.plugins.enablePlugin('thejaz-planner');
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed && !app.plugins.plugins['thejaz-planner'].controller.journal.data.operations.some(o => o.summaryPending));
  // The checkpoint retires inside the status check; wait for it to finish recomputing notices.
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    while (c.indexing) await new Promise(r => setTimeout(r, 50));
    await c.mutation;
  });
  // Other synthetic notes lie outside this helper's summary period; only its own records must be clear.
  const foreign = ([key, text]) => key === 'projects' && !text.includes('2008-01-01');
  const remaining = (await page.evaluate(() => [...app.plugins.plugins['thejaz-planner'].controller.issues])).filter(issue => !foreign(issue));
  assert.equal(remaining.length, 0, JSON.stringify(remaining));
  await page.evaluate(async () => { const v = await app.plugins.plugins['thejaz-planner'].open(); await v.navigate('2008-01-01'); await v.summaryPreview(); });
  assert(await page.getByRole('button', { name: 'Done', exact: true }).isEnabled());
  assert((await page.locator('.modal .planner-preview').innerText()).includes('This summary (2008-01-01 - 2008-01-01) is up to date.'));
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const panel = await page.locator('.planner-notices').count() ? await page.locator('.planner-notices').innerText() : '';
  const shown = (await page.evaluate(() => [...app.plugins.plugins['thejaz-planner'].controller.issues])).filter(issue => !foreign(issue));
  assert.equal(shown.length, 0, JSON.stringify(shown));
  assert(!/2008-01-01|summary check|interrupted/i.test(panel), panel);
  checks.push('Plugin reload retires an already-satisfied persisted checkpoint; completed review shows Done and no attention notice remains for these records');
  await page.screenshot({ path: 'artifacts/planner-status-resolved.png' });

  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    const file = app.vault.getAbstractFileByPath('2008-01-01.md');
    const raw = (await app.vault.read(file)).replace('(90)', '(?)');
    await app.vault.modify(file, raw);
    await c.recheckSummary();
    await app.workspace.getLeavesOfType('thejaz-planner')[0].view.summaryPreview();
  });
  assert((await page.locator('.planner-reconcile-issues').innerText()).includes('2008-01-01'));
  assert(await page.locator('.planner-reconcile-issues').getByRole('button', { name: 'Open note', exact: true }).isEnabled());
  assert(await page.getByRole('button', { name: 'Fix the days below', exact: true }).isDisabled());
  checks.push('An unresolved edit is detected even before debounce and exposes its exact date and source action instead of claiming completion');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/planner-attention-status.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (original) {
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
    if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
    await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
    await page.evaluate(async original => {
      const c = app.plugins.plugins['thejaz-planner'].controller;
      await c.mutation; c.settings = original.settings; c.journal.data = original.journal;
      await c.saveSettings(); await c.journal.save(); c.issues.clear(); await c.recheckSummary();
    }, original);
  }
  await browser.close();
}
