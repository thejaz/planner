import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
// A heading naming another date offers Fix heading; it rewrites only that line and Undo restores it.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], path = '2006-04-05.md';
const text = '## plan for 4 apr 06\n\n### morning\n- [x] 09:00 (n/a) : awake\n- [x] 09:30 (30) : chp\n\n---\nCHP = 30\nSUM = 30\nKeep this annotation.\n';
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page); await assertTestVault(page); page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(async ({ path, text }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    await c.index(); await c.whenIdle(); const v = await p.open(); v.switchMode('day'); await v.navigate('2006-04-05');
  }, { path, text });
  const raw = () => page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.port.read(path), path);
  const checksPanel = page.locator('.planner-diagnostics');
  await checksPanel.locator('summary').click();
  assert((await checksPanel.innerText()).includes('This heading says 2006-04-04, but the note is for 2006-04-05.'));
  const fix = checksPanel.getByRole('button', { name: 'Fix heading', exact: true });
  assert.equal(await fix.count(), 1);
  await fix.click();
  await page.waitForFunction(path => app.plugins.plugins['thejaz-planner'].controller.days.get(path)?.text.startsWith('## plan for 5 apr 06'), path);
  assert.equal(await raw(), text.replace('## plan for 4 apr 06', '## plan for 5 apr 06'));
  assert.equal(await page.locator('.planner-diagnostics').getByRole('button', { name: 'Fix heading', exact: true }).count(), 0);
  checks.push('A heading naming another date shows Fix heading, which rewrites only that heading; the check disappears');
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.undo()); assert.equal(await raw(), text);
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.redo()); assert.equal(await raw(), text.replace('## plan for 4 apr 06', '## plan for 5 apr 06'));
  checks.push('Undo/Redo restore exact note bytes');
  // Leave the synthetic vault as other checks expect it.
  await page.evaluate(async path => {
    const p = app.plugins.plugins['thejaz-planner'], f = app.vault.getAbstractFileByPath(path);
    if (f) await app.vault.delete(f);
    await p.controller.index(); await p.controller.whenIdle(); const v = await p.open(); v.switchMode('day'); await v.navigate(p.controller.now().date);
  }, path);
  assert.deepEqual(errors, []);
  const version = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].manifest.version);
  await writeFile('artifacts/fix-heading.json', JSON.stringify({ version, checks, errors }, null, 2));
  console.log(JSON.stringify({ version, checks, errors }, null, 2));
} finally { await browser.close(); }
