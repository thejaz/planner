import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
// Edits made while the planner starts are saved, and their summary updates finish without a manual retry.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [];
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await assertTestVault(page);
  const day = '2004-02-01.md', summary = 'Planner startup summary.md';
  const note = (credit) => `## plan for 1 feb 04\n\n### morning\n- [x] 09:00 (n/a) : awake\n- [x] 09:30 (30) : chp\n${credit ? '- [x] 10:00 (30) : chp\n' : ''}\n---\nCHP = ${credit ? 60 : 30}\nSUM = ${credit ? 60 : 30}\n`;
  await page.evaluate(async ({ day, summary, text }) => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.settings.summaryPath = summary; c.settings.autoUpdate = true; await c.saveSettings();
    const store = async (path, content) => { const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, content); else await app.vault.create(path, content); };
    await store(day, text);
    await store(summary, '### Days (2004-02-01 - 2004-02-01)\n2004-02-01 = 30 🦥\n### Projects\nCHP = 30\n### Results\nDays (2004-02-01 - 2004-02-01): 1d\n**Actual Sum:** 0.5h (0.50h/d)\n');
    await c.index(); await c.whenIdle();
  }, { day, summary, text: note(false) });

  // 1. An edit sent before recovery records finish loading waits instead of failing.
  const early = await page.evaluate(async ({ day }) => {
    for (const leaf of app.workspace.getLeavesOfType('thejaz-planner')) leaf.detach();
    await app.plugins.disablePlugin('thejaz-planner');
    const enabling = app.plugins.enablePlugin('thejaz-planner');
    while (!app.plugins.plugins['thejaz-planner']?.controller) await new Promise(r => setTimeout(r, 0));
    const c = app.plugins.plugins['thejaz-planner'].controller, waited = !c.initialized;
    const raw = await c.port.read(day), at = raw.indexOf('\n---');
    let error = '';
    try { await c.apply({ path: day, base: raw, label: 'Early edit', patches: [{ start: at, end: at, before: '', after: '\n- [ ] 11:00 (30) : early' }] }); }
    catch (e) { error = e.message; }
    await enabling;
    while (!c.indexed) await new Promise(r => setTimeout(r, 20));
    await c.whenIdle();
    return { waited, error, saved: (await c.port.read(day)).includes(': early') };
  }, { day });
  assert.equal(early.error, ''); assert(early.saved);
  checks.push(`An edit sent during startup is saved instead of failing (sent before recovery records loaded: ${early.waited})`);

  // 2. A summary update postponed by indexing finishes on its own when indexing completes.
  const deferred = await page.evaluate(async ({ day, summary, text }) => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    const raw = await c.port.read(day);
    c.indexed = false;
    await c.apply({ path: day, base: raw, label: 'Edit while indexing', patches: [{ start: 0, end: raw.length, before: raw, after: text }] });
    const waiting = c.issues.get('summary') ?? '', unchanged = (await c.port.read(summary)).includes('2004-02-01 = 30');
    await c.index(); await c.whenIdle();
    const op = c.journal.data.operations.filter(o => o.label === 'Edit while indexing').at(-1);
    return { waiting, unchanged, updated: (await c.port.read(summary)).includes('2004-02-01 = 60'), pending: op?.summaryPending, issue: c.issues.get('summary') ?? '' };
  }, { day, summary, text: note(true) });
  assert(deferred.waiting.includes('update automatically')); assert(deferred.unchanged);
  assert(deferred.updated, JSON.stringify(deferred)); assert.equal(deferred.pending, false); assert(!deferred.issue.includes('update automatically'));
  checks.push('A summary update postponed by indexing completes automatically afterwards, with no Retry needed');

  // 3. Adding a project while notes are still being indexed waits for indexing instead of refusing.
  const project = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.indexed = false;
    let settled = false, error = '';
    const adding = c.createProject('ZWT').then(() => { settled = true; }, e => { settled = true; error = e.message; });
    await new Promise(r => setTimeout(r, 100));
    const waited = !settled;
    await c.index(); await adding; await c.whenIdle();
    return { waited, error, registered: c.settings.projectCodes.includes('ZWT') };
  });
  assert(project.waited); assert.equal(project.error, ''); assert(project.registered);
  checks.push('Adding a project while notes are being read waits and then succeeds');
  await writeFile('artifacts/startup-wait-native.json', JSON.stringify({ checks, early, deferred }, null, 2));
  console.log(JSON.stringify({ checks }, null, 2));
} finally { await browser.close(); }
