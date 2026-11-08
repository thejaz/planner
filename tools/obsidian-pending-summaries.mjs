import { TEST_VAULT, assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { plannerUI } from './planner-ui.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
// Edits whose summary update is paused stay pending and are explained with both totals;
// checking them must not slow later edits, Retry must leave them pending and say why, and
// Review summary updates the older period they belong to, only as previewed.
//   node tools/obsidian-pending-summaries.mjs --seed   (Obsidian closed: write the synthetic period)
//   node tools/obsidian-pending-summaries.mjs          (isolated Obsidian running)
const FOLDER = 'zPending period', START = '2010-01-01', END = '2012-12-31', DAY = `${FOLDER}/${END}.md`;
const SUMMARY = `${FOLDER}/${START}--${END}-thejaz-summary.md`, EDITS = 40;
const dates = () => { const out = []; for (let d = new Date(`${START}T12:00:00Z`); d.toISOString().slice(0, 10) <= END; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };

if (process.argv.includes('--seed')) {
  // Written on disk before launch, so indexing reads them without one automatic update per note.
  const folder = path.join(TEST_VAULT, FOLDER);
  await mkdir(folder, { recursive: true });
  for (const date of dates().slice(0, -1)) await writeFile(path.join(folder, `${date}.md`), '## recorded totals\nCHP = 10\nSUM = 10\n');
  await writeFile(path.join(TEST_VAULT, DAY), '## plan for 31 dec 12\n\n### morning\n- [x] 09:00 (n/a) : awake\n- [ ] 09:30 (10) : chp\n\n---\nCHP = 0\nSUM = 0\n');
  // Project total deliberately unlike the notes, so automatic summary updates pause.
  await writeFile(path.join(TEST_VAULT, SUMMARY), `### Days (${START} - ${END})\n### Projects\n🪁 CHP = 999999\n`);
  console.log(`Seeded ${dates().length} days in ${FOLDER}.`);
  process.exit(0);
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [];
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await assertTestVault(page);
  const ui = plannerUI(page);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed, { timeout: 120000 });
  const result = await page.evaluate(async ({ DAY, SUMMARY, EDITS }) => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    await c.whenIdle();
    const pending = () => c.journal.data.operations.filter(o => o.state === 'done' && o.summaryPending).length;
    const summaryText = () => c.port.read(SUMMARY);
    const initialSummary = await summaryText(), initialPending = pending();
    const timings = [], counts = [];
    for (let i = 0; i < EDITS; i++) {
      const raw = await c.port.read(DAY), at = /- \[[ x]\] 09:30/.exec(raw).index + 3, box = raw[at];
      c.performance.operations.length = 0;
      await c.apply({ path: DAY, base: raw, label: 'Toggle completion', patches: [{ start: at, end: at + 1, before: box, after: box === 'x' ? ' ' : 'x' }] });
      await c.whenIdle();
      timings.push(c.performance.operations.at(-1)); counts.push(pending());
    }
    const afterEdits = pending(), summaryUnchanged = await summaryText() === initialSummary;
    return { initialPending, afterEdits, counts, timings, summaryUnchanged, waiting: c.issues.get(`summary-wait:${SUMMARY}`) ?? '' };
  }, { DAY, SUMMARY, EDITS });
  assert.equal(result.afterEdits - result.initialPending, EDITS);
  assert(result.summaryUnchanged);
  checks.push(`${EDITS} edits with mismatched project totals stay pending and leave the summary unchanged`);
  const name = SUMMARY.split('/').pop().replace(/\.md$/, ''), totals = 'CHP: 999,999m in the summary, 10,950m in your daily notes';
  assert(result.waiting.startsWith(`${EDITS} saved edits are waiting for ${name}. Automatic updates to ${name} are paused`), result.waiting);
  assert(result.waiting.includes(totals)); assert(result.waiting.includes('Retry summary update cannot finish these until the totals agree.'));
  checks.push('The attention list keeps the pause reason for the older summary, with both CHP totals and the waiting count');

  const pendingNow = () => page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.journal.data.operations.filter(o => o.state === 'done' && o.summaryPending).length);
  const waitingText = () => page.evaluate(SUMMARY => app.plugins.plugins['thejaz-planner'].controller.issues.get(`summary-wait:${SUMMARY}`) ?? '', SUMMARY);
  const openPanel = async () => {
    await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].open(); });
    const notices = page.locator('.planner-notices').first();
    await notices.waitFor();
    if (!await notices.evaluate(d => d.open)) await notices.locator('summary').click();
    return ui.locator('.planner-attention-item').filter({ hasText: 'are waiting for' }).first();
  };
  const closeModal = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.modal')); };
  const modify = (path, from, to) => page.evaluate(async ({ path, from, to }) => {
    const c = app.plugins.plugins['thejaz-planner'].controller, file = app.vault.getAbstractFileByPath(path);
    const raw = await app.vault.read(file); if (!raw.includes(from)) throw Error(`${path} lacks ${from}`);
    await app.vault.modify(file, raw.replace(from, to)); c.ingest(path, raw.replace(from, to));
  }, { path, from, to });
  const summaryText = () => page.evaluate(SUMMARY => app.plugins.plugins['thejaz-planner'].controller.port.read(SUMMARY), SUMMARY);

  // After a restart the planner no longer knows the guard paused these, so it must not claim it.
  await page.evaluate(async () => {
    for (const leaf of app.workspace.getLeavesOfType('thejaz-planner')) { if (leaf.view.scope) app.keymap.popScope(leaf.view.scope); leaf.detach(); }
    await app.plugins.disablePlugin('thejaz-planner'); await app.plugins.enablePlugin('thejaz-planner');
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed, { timeout: 120000 });
  await page.evaluate(async () => { const c = app.plugins.plugins['thejaz-planner'].controller; await c.whenIdle(); await c.recheckSummary(); await c.whenIdle(); });
  const unknown = await waitingText();
  assert(unknown.startsWith(`${EDITS} saved edits are waiting for ${name}. Choose Retry summary update to add them`) && !unknown.includes('paused'), unknown);
  checks.push('Without a guard pause in this session the entry suggests Retry and does not claim the update is paused');

  await openPanel();
  await ui.getByRole('button', { name: 'Retry summary update', exact: true }).click();
  await page.locator('.modal').filter({ hasText: 'paused because' }).waitFor();
  assert((await page.locator('.modal').last().innerText()).includes(totals));
  await closeModal();
  assert.equal(await pendingNow(), result.afterEdits);
  assert((await waitingText()).includes('are paused because'));
  checks.push('When Retry meets the overwrite guard, the edits stay pending and both the result and the entry name the paused totals');

  const review = async () => {
    const item = await openPanel();
    await item.getByRole('button', { name: 'Review summary', exact: true }).click();
    const dialog = page.locator('.modal').last();
    await dialog.filter({ hasText: 'Project totals that differ' }).waitFor();
    return dialog;
  };
  const refused = async dialog => {
    await plannerUI(dialog).getByRole('button', { name: 'Update summary', exact: true }).click();
    await dialog.filter({ hasText: 'changed after this preview, so nothing was written' }).waitFor();
    await closeModal();
  };
  let dialog = await review();
  const text = await dialog.innerText();
  assert(text.includes(totals) && text.includes(`${name} (2010-01-01 - 2012-12-31)`) && text.includes('including any figure typed by hand'), text);
  checks.push('Review summary opens the older period it belongs to and lists the differing project totals before the line changes');
  await modify(SUMMARY, 'CHP = 999999', 'CHP = 777777');
  await refused(dialog);
  assert((await summaryText()).includes('CHP = 777777')); assert.equal(await pendingNow(), result.afterEdits);
  checks.push('Update summary refuses, writing nothing, when the summary was edited after the preview');
  dialog = await review();
  await modify(`${FOLDER}/2010-01-01.md`, 'CHP = 10\nSUM = 10', 'CHP = 20\nSUM = 20');
  await refused(dialog);
  assert((await summaryText()).includes('CHP = 777777')); assert.equal(await pendingNow(), result.afterEdits);
  checks.push('Update summary refuses when a daily note in the period changed after the preview');

  dialog = await review();
  assert((await dialog.innerText()).includes('CHP: 777,777m in the summary, 10,960m in your daily notes'));
  await plannerUI(dialog).getByRole('button', { name: 'Update summary', exact: true }).click();
  await page.waitForFunction(n => app.plugins.plugins['thejaz-planner'].controller.journal.data.operations.filter(o => o.state === 'done' && o.summaryPending).length === n, result.initialPending, { timeout: 30000 });
  const after = await page.evaluate(async SUMMARY => {
    const c = app.plugins.plugins['thejaz-planner'].controller; await c.whenIdle();
    return { text: await c.port.read(SUMMARY), waiting: c.issues.has(`summary-wait:${SUMMARY}`), settings: c.settings.summaryPath };
  }, SUMMARY);
  assert(!after.text.includes('777777') && after.text.includes('CHP = 10960'), after.text); assert(!after.waiting);
  assert.equal(after.settings, 'thejaz-summary-now.md');
  checks.push('A fresh Review then Update summary reconciles that older period, clears every waiting edit and the entry, and leaves the summary setting alone');

  // Typing in a daily note and confirming at once, with no manual index refresh: the edit
  // must count, inside the 450 ms debounce or while its update waits behind a slow operation.
  const reviewDirect = async () => {
    await page.evaluate(async SUMMARY => { const v = await app.plugins.plugins['thejaz-planner'].open(); await v.summaryPreview(SUMMARY); }, SUMMARY);
    const dialog = page.locator('.modal').last();
    await dialog.filter({ hasText: 'Project totals that differ' }).waitFor();
    return dialog;
  };
  const typedThenConfirmed = async (day, autoUpdate, slowMs = 0) => {
    const expectedChp = await page.evaluate(async ({ SUMMARY, day, autoUpdate }) => {
      const c = app.plugins.plugins['thejaz-planner'].controller;
      c.settings.autoUpdate = autoUpdate;
      await c.openSource(day);
      const summary = app.vault.getAbstractFileByPath(SUMMARY), raw = await app.vault.read(summary);
      // A hand-typed figure, so Review summary has a change to confirm.
      await app.vault.modify(summary, raw.replace(/CHP = \d+/, 'CHP = 5000'));
      await new Promise(r => setTimeout(r, 1000)); await c.whenIdle();
      return Number(/CHP = (\d+)/.exec(raw)[1]);
    }, { SUMMARY, day, autoUpdate });
    const dialog = await reviewDirect();
    assert((await dialog.innerText()).includes(`CHP: 5,000m in the summary, ${expectedChp.toLocaleString('en-US')}m in your daily notes`));
    const typed = await page.evaluate(({ day, slowMs }) => {
      // A slow queued operation: the debounce timer expires while the confirmation waits behind it.
      if (slowMs) void app.plugins.plugins['thejaz-planner'].controller.enqueue(() => new Promise(r => setTimeout(r, slowMs)));
      const view = app.workspace.getLeavesOfType('markdown').map(l => l.view).find(v => v.file?.path === day);
      const editor = view.editor, text = editor.getValue(), at = text.indexOf('CHP = 10\n');
      if (at < 0) throw Error(`${day} lacks CHP = 10`);
      editor.replaceRange('CHP = 40\nSUM = 40', editor.offsetToPos(at), editor.offsetToPos(text.indexOf('SUM = 10') + 'SUM = 10'.length));
      return performance.now();
    }, { day, slowMs });
    await plannerUI(dialog).getByRole('button', { name: 'Update summary', exact: true }).click();
    await dialog.filter({ hasText: 'changed after this preview, so nothing was written' }).waitFor();
    const elapsed = await page.evaluate(t => performance.now() - t, typed);
    await closeModal();
    assert((await summaryText()).includes('CHP = 5000'), 'the stale preview was written');
    // Once reviewed again, the typed figure is included.
    await page.waitForTimeout(800);
    await page.evaluate(async () => app.plugins.plugins['thejaz-planner'].controller.whenIdle());
    const again = await reviewDirect();
    assert((await again.innerText()).includes(`${(expectedChp + 30).toLocaleString('en-US')}m in your daily notes`));
    await plannerUI(again).getByRole('button', { name: 'Update summary', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.modal'));
    await page.evaluate(async () => app.plugins.plugins['thejaz-planner'].controller.whenIdle());
    assert((await summaryText()).includes(`CHP = ${expectedChp + 30}`), await summaryText());
    return Math.round(elapsed);
  };
  const offMs = await typedThenConfirmed(`${FOLDER}/2010-01-02.md`, false);
  checks.push(`With automatic totals off, confirming ${offMs} ms after typing in a daily note is refused, and a new review writes the typed figure`);
  const onMs = await typedThenConfirmed(`${FOLDER}/2010-01-03.md`, true);
  checks.push(`With automatic totals on, confirming ${onMs} ms after typing is refused the same way`);
  assert(offMs < 450 && onMs < 450, `confirmed after the debounce: ${offMs}, ${onMs}`);
  const queuedMs = await typedThenConfirmed(`${FOLDER}/2010-01-04.md`, false, 650);
  assert(queuedMs >= 650, `the confirmation did not wait behind the slow operation: ${queuedMs}`);
  checks.push(`A confirmation queued behind a 650 ms operation, so the debounce expires first, is still refused (${queuedMs} ms)`);
  await page.evaluate(() => { app.workspace.getLeavesOfType('markdown').forEach(l => l.detach()); });

  // A retired period too long to total still reports its repair instruction instead of failing.
  const retired = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller, path = 'zPending period/1900-2026-thejaz-summary.md';
    await app.vault.create(path, '### Days (01.01.1900 - 01.01.2026)\n### Projects\nCHP = 1\n'); c.ingest(path, await app.vault.adapter.read(path));
    const saved = c.settings.summaryPath; c.settings.summaryPath = path;
    try { await c.recheckSummary(); await c.whenIdle(); return { summary: c.issues.get('summary') ?? '', index: c.issues.get('index') ?? '' }; }
    finally { c.settings.summaryPath = saved; const f = app.vault.getAbstractFileByPath(path); await app.vault.delete(f); c.remove(path); await c.recheckSummary(); }
  });
  assert(/Write the Days line with full dates/.test(retired.summary) && !/shorter than 100 years/.test(retired.summary), JSON.stringify(retired));
  checks.push('A retired period too long to total keeps its repair message');
  const mean = list => Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  const report = { checks, version: await page.evaluate(() => app.plugins.plugins['thejaz-planner'].manifest.version),
    firstFiveMs: mean(result.timings.slice(0, 5)), lastFiveMs: mean(result.timings.slice(-5)), result };
  await writeFile('artifacts/pending-summaries-native.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks, version: report.version, firstFiveMs: report.firstFiveMs, lastFiveMs: report.lastFiveMs }, null, 2));
} finally { await browser.close(); }
