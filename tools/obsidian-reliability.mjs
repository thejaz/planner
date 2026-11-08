import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { setCriteria } from './criteria-note.mjs';
import { readFile } from 'node:fs/promises';
const legend = /export const CANONICAL_LEGEND = `([\s\S]*?)`;/.exec(await readFile('src/core/marker-rules.ts', 'utf8'))[1];
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
const summaryPath = 'Planner verification summary.md';
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  if (!page) throw Error('Test Obsidian is unavailable');
  await assertTestVault(page);
  page.on('pageerror', e => errors.push(e.message));
  await page.bringToFront();
  // The canonical legend defines every marker other helpers may leave in summaries; buffer keeps 🦥.
  await setCriteria(page, legend);
  await page.evaluate(async summaryPath => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.settings.autoUpdate = false;
    const renamed = app.vault.getAbstractFileByPath('_Planner Verification/2001-01-02.md');
    if (renamed && !app.vault.getAbstractFileByPath('2001-01-02.md')) await app.fileManager.renameFile(renamed, '2001-01-02.md');
    c.settings.summaryPath = summaryPath;
    await c.saveSettings();
    const store = async (path, text) => {
      const old = app.vault.getAbstractFileByPath(path);
      if (old) await app.vault.modify(old, text); else await app.vault.create(path, text);
    };
    for (const date of ['2001-01-01', '2001-01-02', '2001-01-03']) {
      const amount = date.endsWith('01') ? 30 : 0;
      await store(`${date}.md`, `## plan for ${+date.slice(8)} jan 01\n\n### morning\n\n- [x] 09:00 (n/a) : awake\n${amount ? '- [x] 09:30 (30) : chp\n' : ''}\n---\n\nCHP = ${amount}\nSUM = ${amount}\n`);
    }
    await store(summaryPath, '### Days\n2001-01-01 = 30 🦥\n2001-01-02 = 0\n2001-01-03 = 0\n\n### Projects\n🦉 CHP = 30\n\n### Bookmarks\n- Keep this exact checkpoint.\n\n### Results\nDays (2001-01-01 - 2001-01-03): 3d\n**Projected Sum:** 100h (1h/d)\n**Actual Sum:** 0.5h (0.17h/d)\n');
    await c.index();
    const view = await app.plugins.plugins['thejaz-planner'].open(); await view.navigate('2001-01-01');
  }, summaryPath);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    await c.mutation; c.settings.autoUpdate = true; await c.saveSettings();
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2001-01-01.md')?.recordedSum === 30);
  const read = path => page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.port.read(path), path);
  const edit = (path, from, to) => page.evaluate(async ({ path, from, to }) => {
    const file = app.vault.getAbstractFileByPath(path);
    await app.vault.process(file, text => {
      if (!text.includes(from)) throw Error(`Test expected text is missing from ${path}: ${from}`);
      return text.replace(from, to);
    });
  }, { path, from, to });

  await edit('2001-01-01.md', '(30) : chp', '(60) : chp');
  await page.waitForFunction(path => app.plugins.plugins['thejaz-planner'].controller.summaries.get(path)?.projects[0]?.value === 60, summaryPath);
  assert((await read('2001-01-01.md')).includes('SUM = 60'));
  assert((await read(summaryPath)).includes('**Projected Sum:** 100h (1h/d)'));
  assert((await read(summaryPath)).includes('Keep this exact checkpoint.'));
  checks.push('Manual source edit updates daily and period totals without altering bookmarks or projection');
  console.log(checks.at(-1));

  await edit('2001-01-01.md', 'SUM = 60', 'SUM = 999');
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2001-01-01.md')?.recordedSum === 999);
  await edit('2001-01-01.md', '(60) : chp', '(70) : chp');
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2001-01-01.md')?.entries[1]?.duration === '70');
  assert((await read('2001-01-01.md')).includes('SUM = 999'));
  checks.push('Direct edits to recorded totals suspend automatic overwrites');
  console.log(checks.at(-1));
  await page.locator('.planner-diagnostics > summary').click();
  await page.getByRole('button', { name: 'Compare totals', exact: true }).click();
  await page.locator('.modal').getByRole('button', { name: 'Use calculated totals', exact: true }).click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2001-01-01.md')?.recordedSum === 70);
  await page.waitForFunction(path => app.plugins.plugins['thejaz-planner'].controller.summaries.get(path)?.projects[0]?.value === 70, summaryPath);
  checks.push('Explicit daily reconciliation previews and writes calculated totals');
  console.log(checks.at(-1));

  await edit(summaryPath, 'CHP = 70', 'CHP = 999');
  await page.waitForFunction(path => app.plugins.plugins['thejaz-planner'].controller.summaries.get(path)?.projects[0]?.value === 999, summaryPath);
  await edit('2001-01-01.md', '(70) : chp', '(80) : chp');
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2001-01-01.md')?.recordedSum === 80);
  assert((await read(summaryPath)).includes('CHP = 999'));
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.retrySummary(); });
  assert((await read(summaryPath)).includes('CHP = 999'));
  checks.push('Existing summary conflicts survive both automatic refresh and retry');
  console.log(checks.at(-1));
  await page.evaluate(() => { app.workspace.getLeavesOfType('thejaz-planner')[0].view.summaryPreview(); });
  await page.locator('.modal').getByRole('button', { name: 'Update summary', exact: true }).click();
  await page.waitForFunction(path => app.plugins.plugins['thejaz-planner'].controller.summaries.get(path)?.projects[0]?.value === 80, summaryPath);
  checks.push('Explicit summary reconciliation repairs the aggregate');
  console.log(checks.at(-1));

  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    // Contexts are now single values defined in the summary's Criteria & Markers legend.
    await c.setContext('2001-01-01', 'buffer');
  });
  const contextRow = (await read(summaryPath)).split('\n').find(line => line.startsWith('2001-01-01 ='));
  assert(contextRow.includes('☁') && contextRow.includes('🦥'), contextRow);
  checks.push('Context stored as ordinary readable icons');

  await page.evaluate(async path => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    const original = c.port.replace.bind(c.port);
    c.port.replace = async (file, before, after) => { if (file === path) throw Error('Injected summary storage failure'); return original(file, before, after); };
    const day = await c.getDay('2001-01-01');
    const start = day.text.indexOf('(80) : chp') + 1;
    try {
      await c.apply({ path: day.path, base: day.text, label: 'Recovery verification', patches: [{ start, end: start + 2, before: '80', after: '90' }] });
    } finally { c.port.replace = original; }
  }, summaryPath);
  assert((await read('2001-01-01.md')).includes('SUM = 90'));
  assert((await read(summaryPath)).includes('CHP = 80'));
  const pending = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.journal.data.operations.filter(o => o.label === 'Recovery verification').at(-1)?.state);
  assert.equal(pending, 'interrupted');
  checks.push('Injected summary failure retains the saved source and recovery record');
  console.log(checks.at(-1));

  const sourceBeforeReload = await read('2001-01-01.md');
  await page.evaluate(async () => {
    for (const leaf of app.workspace.getLeavesOfType('thejaz-planner')) leaf.detach();
    await app.plugins.disablePlugin('thejaz-planner'); await app.plugins.enablePlugin('thejaz-planner');
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  assert.equal(await read('2001-01-01.md'), sourceBeforeReload);
  assert(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.journal.data.operations.some(o => o.label === 'Recovery verification' && o.state === 'interrupted')));
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.recover(); });
  assert((await read(summaryPath)).includes('CHP = 90'));
  checks.push('Reload is read-only; interrupted summary recovers safely after restart');
  console.log(checks.at(-1));

  await page.evaluate(async () => {
    const folder = '_Planner Verification';
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
    await app.fileManager.renameFile(app.vault.getAbstractFileByPath('2001-01-02.md'), `${folder}/2001-01-02.md`);
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.has('_Planner Verification/2001-01-02.md'));
  assert.equal(await page.evaluate(async () => (await app.plugins.plugins['thejaz-planner'].controller.getDay('2001-01-02')).path), '_Planner Verification/2001-01-02.md');
  await page.evaluate(async () => { await app.vault.create('2001-01-02.md', await app.vault.read(app.vault.getAbstractFileByPath('_Planner Verification/2001-01-02.md'))); });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.has('2001-01-02.md'));
  // Two plans for one date: the folder holding the most planner days (the vault root here) wins.
  assert.equal(await page.evaluate(async () => (await app.plugins.plugins['thejaz-planner'].controller.getDay('2001-01-02')).path), '2001-01-02.md');
  await page.evaluate(async () => { await app.fileManager.trashFile(app.vault.getAbstractFileByPath('2001-01-02.md')); });
  await page.waitForFunction(() => !app.plugins.plugins['thejaz-planner'].controller.days.has('2001-01-02.md'));
  checks.push('Renames preserve identity; a second plan for a date resolves to the folder with most plans; deletion removes stale index entries');
  console.log(checks.at(-1));

  const beforeReindex = await page.evaluate(async () => {
    const paths = ['2001-01-01.md', '_Planner Verification/2001-01-02.md', '2001-01-03.md', 'Planner verification summary.md'];
    return Promise.all(paths.map(async p => [p, await app.vault.read(app.vault.getAbstractFileByPath(p))]));
  });
  await page.evaluate(async () => {
    const cache = '.obsidian/plugins/thejaz-planner/index.json';
    await app.vault.adapter.write(cache, '{broken cache');
    await app.plugins.plugins['thejaz-planner'].controller.index();
  });
  for (const [path, text] of beforeReindex) assert.equal(await read(path), text);
  checks.push('Corrupt cache rebuilds without modifying source notes');

  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner']; const v = await p.open();
    await v.navigate('2026-10-19');
    document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark');
  });
  await page.mouse.move(2, 2); await page.screenshot({ path: 'artifacts/obsidian-dark.png' });
  await page.evaluate(() => { document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light'); });
  const finalMetrics = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.performance);
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile('artifacts/obsidian-reliability.json', JSON.stringify({ checks, errors, metrics: finalMetrics }, null, 2));
  console.log(JSON.stringify({ checks, errors, metrics: finalMetrics }, null, 2));
} catch (error) {
  await writeFile('artifacts/obsidian-reliability-failure.json', JSON.stringify({ checks, errors, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
