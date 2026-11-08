import { assertTestVault } from './paths.mjs';
// Between native helpers: close leftover dialogs, settings and an open activity
// edit, and let pending updates finish, so one failure cannot block the next helper.
// Then restore the baseline every helper expects: the plugin settings and the
// criteria note as first seen in this test vault, and a fresh planner view.
import { chromium } from 'playwright';
const b = await chromium.connectOverCDP('http://127.0.0.1:9237');
try {
  const page = b.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page);
  for (let i = 0; i < 5 && await page.locator('.modal').count(); i++) {
    const cancel = page.locator('.modal button', { hasText: /^(cancel|stay)$/i }).first();
    if (await cancel.count()) await cancel.click(); else await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => app.setting?.close());
  const editor = page.locator('.planner-activity-editor');
  if (await editor.count()) await editor.locator('button', { hasText: /^cancel$/i }).first().click().catch(() => {});
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner']?.controller;
    if (!c) return;
    do { while (c.timers.size) await new Promise(r => setTimeout(r, 50)); await c.mutation; } while (c.timers.size);
    // The baseline lives inside the disposable test vault, so a fresh vault starts a fresh baseline:
    // its settings and every note as first seen, including any thejaz-criteria.md.
    const adapter = app.vault.adapter, file = '.obsidian/plugins/thejaz-planner/native-baseline.json';
    if (!await adapter.exists(file)) {
      const notes = {};
      for (const f of app.vault.getMarkdownFiles()) notes[f.path] = await app.vault.read(f);
      await adapter.write(file, JSON.stringify({ settings: c.settings, notes }));
    }
    const baseline = JSON.parse(await adapter.read(file));
    for (const leaf of app.workspace.getLeavesOfType('thejaz-planner')) leaf.detach();
    for (const key of Object.keys(c.settings)) if (!(key in baseline.settings)) delete c.settings[key];
    Object.assign(c.settings, structuredClone(baseline.settings)); await c.saveSettings();
    // Notes earlier helpers created are removed and changed ones restored; the journal starts empty.
    for (const f of app.vault.getMarkdownFiles()) if (!(f.path in baseline.notes)) await app.vault.delete(f);
    for (const [path, text] of Object.entries(baseline.notes)) {
      const f = app.vault.getAbstractFileByPath(path);
      if (!f) { const folder = path.split('/').slice(0, -1).join('/'); if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder); await app.vault.create(path, text); }
      else if (await app.vault.read(f) !== text) await app.vault.modify(f, text);
    }
    c.journal.data.operations = []; await c.journal.save();
    do { while (c.timers.size) await new Promise(r => setTimeout(r, 50)); await c.mutation; } while (c.timers.size);
    await new Promise(r => setTimeout(r, 300));
    if (!app.workspace.getMostRecentLeaf(app.workspace.rootSplit)) app.workspace.getLeaf(true);
    await c.index();
    // An index already running makes index() return early; wait for it so no re-render lands mid-helper.
    while (c.indexing || !c.indexed) await new Promise(r => setTimeout(r, 50));
    do { while (c.timers.size) await new Promise(r => setTimeout(r, 50)); await c.mutation; } while (c.timers.size);
    await app.plugins.plugins['thejaz-planner'].open();
  });
} finally { await b.close(); }
