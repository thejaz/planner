import { assertTestVault } from './paths.mjs';
// Native check (0.3.13): recovery files that exist but cannot be read are reported, copied aside
// and replaced by fresh history, so the next start is quiet; Dismiss hides the message. A summary
// paused by the overwrite guard keeps its pause when the note is renamed.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('manifest.json', 'utf8'));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page);
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  const restart = () => page.evaluate(async () => {
    await app.plugins.disablePlugin('thejaz-planner'); await app.plugins.enablePlugin('thejaz-planner');
  }).then(() => page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller?.initialized));

  // Damage both snapshots, then start the plugin again.
  await page.evaluate(async () => {
    const dir = `${app.vault.configDir}/plugins/thejaz-planner`;
    for (const name of await app.vault.adapter.list(dir).then(l => l.files)) if (name.includes('recovery-unreadable-')) await app.vault.adapter.remove(name);
    await app.vault.adapter.write(`${dir}/recovery-0.json`, 'damaged 0');
    await app.vault.adapter.write(`${dir}/recovery-1.json`, 'damaged 1');
  });
  await restart();
  const after = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller, dir = `${app.vault.configDir}/plugins/thejaz-planner`;
    const files = (await app.vault.adapter.list(dir)).files.map(f => f.split('/').pop());
    const copies = files.filter(f => f.startsWith('recovery-unreadable-')).sort();
    const contents = await Promise.all(copies.map(f => app.vault.adapter.read(`${dir}/${f}`)));
    const fresh = await Promise.all(['recovery-0.json', 'recovery-1.json'].map(f => app.vault.adapter.read(`${dir}/${f}`).then(t => { try { JSON.parse(t); return true; } catch { return false; } })));
    return { message: c.issues.get('recovery-history'), copies, contents, fresh };
  });
  assert(after.message?.includes('could not be read') && after.message.includes('Your notes are unchanged') && after.message.includes('Choose Dismiss'), JSON.stringify(after));
  assert.equal(after.copies.length, 2, JSON.stringify(after));
  assert.deepEqual(after.contents.sort(), ['damaged 0', 'damaged 1']);
  assert(after.fresh.some(Boolean), JSON.stringify(after));
  checks.push('Two unreadable recovery files are reported (notes unchanged), copied aside unchanged as recovery-unreadable files, and fresh history is written');

  // Dismiss from the attention panel.
  await page.evaluate(async () => { const v = await app.plugins.plugins['thejaz-planner'].open(); v.switchMode('day'); });
  const panel = page.locator('.planner-notices');
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.waitForFunction(() => !app.plugins.plugins['thejaz-planner'].controller.issues.has('recovery-history'));
  checks.push('Dismiss in the attention panel hides the message');

  // The next start reads the fresh history and says nothing.
  await restart();
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.issues.has('recovery-history')), false);
  checks.push('The next start reads the fresh history without a message');

  // A paused summary keeps its pause when renamed.
  const paused = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    for (const path of ['pause-check.md', 'pause-check-renamed.md']) { const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.delete(f); }
    const file = await app.vault.create('pause-check.md', '### Days (2004-01-01 - 2004-01-31)\n### Projects\nCHP = 5\n');
    c.pausedSummaries.add('pause-check.md');
    await app.fileManager.renameFile(file, 'pause-check-renamed.md');
    await new Promise(resolve => setTimeout(resolve, 300));
    const result = { old: c.pausedSummaries.has('pause-check.md'), renamed: c.pausedSummaries.has('pause-check-renamed.md') };
    c.pausedSummaries.delete('pause-check-renamed.md');
    await app.vault.delete(app.vault.getAbstractFileByPath('pause-check-renamed.md'));
    return result;
  });
  assert.deepEqual(paused, { old: false, renamed: true });
  checks.push('A paused summary stays paused under its new name after a rename');

  // Leave no copies behind for later helpers.
  await page.evaluate(async () => {
    const dir = `${app.vault.configDir}/plugins/thejaz-planner`;
    for (const name of (await app.vault.adapter.list(dir)).files) if (name.includes('recovery-unreadable-')) await app.vault.adapter.remove(name);
  });
  assert.deepEqual(errors, []);
  await writeFile('artifacts/obsidian-recovery-history.json', JSON.stringify({ version, checks, errors }, null, 2));
  console.log(JSON.stringify({ version, checks, errors }, null, 2));
} finally { await browser.close(); }
