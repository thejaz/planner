import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
// A summary changed outside the index no longer blocks every action, and repeated errors show one pop-up.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [];
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await assertTestVault(page);
  const result = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    const store = async (path, content) => { const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, content); else await app.vault.create(path, content); };
    const summary = 'zArchives stale/2005-03-01--2005-03-31-thejaz-summary.md', day = '2005-03-01.md';
    await store(day, '## plan for 1 mar 05\n\n### morning\n- [x] 09:00 (n/a) : awake\n- [ ] 09:30 (30) : chp\n\n---\nCHP = 0\nSUM = 0\n');
    if (!app.vault.getAbstractFileByPath('zArchives stale')) await app.vault.createFolder('zArchives stale');
    await store(summary, '### Days (2005-03-01 - 2005-03-31)\n2005-03-01 = 0\n### Projects\n🦉 CHP = 0\n');
    await c.index(); await c.whenIdle();
    const code = c.settings.projectCodes.includes('CHP') ? 'CHP' : c.settings.projectCodes[0];
    // The indexed copy lags behind the note, as when another editor or tool changed it.
    const stale = () => { const cached = c.summaries.get(summary); c.summaries.set(summary, { ...cached, text: cached.text + 'older indexed copy\n' }); };
    stale();
    let emojiError = '';
    try { await c.setProjectEmoji(code, '🌱'); } catch (e) { emojiError = e.message; }
    stale();
    const raw = await c.port.read(day), at = raw.indexOf('- [ ] 09:30');
    let editError = '';
    try { await c.apply({ path: day, base: raw, label: 'Toggle completion', patches: [{ start: at + 3, end: at + 4, before: ' ', after: 'x' }] }); } catch (e) { editError = e.message; }
    await c.whenIdle();
    // Repeated identical errors.
    const before = document.querySelectorAll('.notice').length;
    for (let i = 0; i < 5; i++) c.report(new Error('Repeated planner test error.'));
    const shown = [...document.querySelectorAll('.notice')].filter(n => n.textContent.includes('Repeated planner test error.')).length;
    return { emojiError, emoji: c.settings.projectEmojis[code], editError, saved: (await c.port.read(day)).includes('- [x] 09:30'), shown, before };
  });
  assert.equal(result.emojiError, ''); assert.equal(result.emoji, '🌱');
  checks.push('Changing a project emoji succeeds when the indexed summary is behind its note');
  assert.equal(result.editError, ''); assert(result.saved);
  checks.push('An ordinary edit succeeds with a lagging summary instead of reporting "changed. Refresh"');
  assert.equal(result.shown, 1);
  checks.push('Five identical errors in a row show one pop-up');
  await writeFile('artifacts/stale-summary-native.json', JSON.stringify({ checks, result }, null, 2));
  console.log(JSON.stringify({ checks }, null, 2));
} finally { await browser.close(); }
