import { assertTestVault } from './paths.mjs';
import { setCriteria } from './criteria-note.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { plannerUI } from './planner-ui.mjs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await page.waitForFunction(() => typeof app !== 'undefined' && app.vault);
  await assertTestVault(page);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed || [...document.querySelectorAll('button')].some(b => b.textContent === 'Trust author and enable plugins'));
  const trust = page.getByRole('button', { name: 'Trust author and enable plugins', exact: true }); if (await trust.count()) await trust.click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(async () => {
    app.setting.close();
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.settings.autoUpdate = false; c.settings.summaryPath = 'thejaz-summary-now.md';
    for (const name of ['nested/thejaz-summary-now.md', 'nested/retired.md', 'nested/2017-01-01--2017-01-02-thejaz-summary.md', 'nested/thejaz-criteria.md']) {
      const f = app.vault.getAbstractFileByPath(name); if (f) await app.vault.trash(f, false);
    }
    for (const folder of ['history', 'nested', 'zArchives synthetic', 'thejaz-summary-folder']) if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
    const store = async (path, text) => {
      const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    };
    await store('thejaz-summary-now.md', '### Days\n2013-01-01 = 0 😣\n### Projects\nFRM = 0\n### Results\nDays (2013-01-01 - 2013-01-01): 1d\n');
    await store('2013-01-01.md', '## recorded totals\nFRM = 30\nSUM = 30\n');
    await store('history/2017-01-01--2017-01-02-thejaz-summary.md', '### Days\n2017-01-01 = 60 🦥\n2017-01-02 = 90 🦥\n');
    await store('_Codes/THEJAZ-SUMMARY-extra.MD', '### Days\n2011-01-01 = 15 😣\nDays (2011-01-01 - 2011-01-01): 1d\n');
    await store('zArchives synthetic/unrelated.md', '### Days\n2009-01-01 = 60\nDays (2009-01-01 - 2009-01-01): 1d\n');
    await store('thejaz-summary-folder/unrelated.md', '### Days\n2008-01-01 = 60\nDays (2008-01-01 - 2008-01-01): 1d\n');
    await c.saveSettings(); await c.index();
  });
  const paths = () => page.evaluate(() => [...app.plugins.plugins['thejaz-planner'].controller.summaries.keys()]);
  let found = await paths();
  for (const path of ['thejaz-summary-now.md', 'history/2017-01-01--2017-01-02-thejaz-summary.md', '_Codes/THEJAZ-SUMMARY-extra.MD']) assert(found.includes(path), path);
  assert(!found.includes('zArchives synthetic/unrelated.md')); assert(!found.includes('thejaz-summary-folder/unrelated.md'));
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.summaries.get('history/2017-01-01--2017-01-02-thejaz-summary.md').rows[0].date), '2017-01-01');
  checks.push('Index discovers marker filenames case-insensitively in arbitrary/routine folders, reads ISO fallback periods and excludes folder-only/legacy-folder false positives');
  await page.evaluate(async () => {
    await app.vault.modify(app.vault.getAbstractFileByPath('_Codes/THEJAZ-SUMMARY-extra.MD'), '### Days\n2011-01-01 = 25 😣\nDays (2011-01-01 - 2011-01-01): 1d\n');
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.summaries.get('_Codes/THEJAZ-SUMMARY-extra.MD')?.rows[0]?.value === 25);
  await page.evaluate(async () => { await app.fileManager.renameFile(app.vault.getAbstractFileByPath('history/2017-01-01--2017-01-02-thejaz-summary.md'), 'nested/2017-01-01--2017-01-02-thejaz-summary.md'); });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.summaries.has('nested/2017-01-01--2017-01-02-thejaz-summary.md'));
  assert(!(await paths()).includes('history/2017-01-01--2017-01-02-thejaz-summary.md'));
  await page.evaluate(async () => { await app.fileManager.renameFile(app.vault.getAbstractFileByPath('nested/2017-01-01--2017-01-02-thejaz-summary.md'), 'nested/retired.md'); });
  await page.waitForFunction(() => !app.plugins.plugins['thejaz-planner'].controller.summaries.has('nested/2017-01-01--2017-01-02-thejaz-summary.md'));
  assert(!(await paths()).includes('nested/retired.md'));
  checks.push('Modify and rename watchers update discovered summaries, including inside the routines folder; removing the filename marker removes automatic discovery');
  await page.evaluate(async () => { await app.fileManager.renameFile(app.vault.getAbstractFileByPath('thejaz-summary-now.md'), 'nested/thejaz-summary-now.md'); });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.settings.summaryPath === 'nested/thejaz-summary-now.md');
  assert.equal((await page.evaluate(() => app.plugins.plugins['thejaz-planner'].loadData())).markerSourcePath, undefined);
  const archiveBefore = await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('_Codes/THEJAZ-SUMMARY-extra.MD')));
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.reconcileSummary(); });
  assert((await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.port.read('nested/thejaz-summary-now.md'))).includes('2013-01-01 = 30'));
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('_Codes/THEJAZ-SUMMARY-extra.MD'))), archiveBefore);
  checks.push('The active summary setting follows native renames; summary reconciliation writes only the configured current target and leaves discovered history unchanged');
  // The criteria note is found by name wherever it is moved; a second one is reported instead of guessed.
  await setCriteria(page, '### Criteria & Markers\n- 😣 | 0-29m | no-pro\n- 🦥 | 30-149m | low-pro\n- ❄️ | 150-299m | cool\n- 🔥 | >=300m | hot\n');
  await page.evaluate(async () => { await app.fileManager.renameFile(app.vault.getAbstractFileByPath('thejaz-criteria.md'), 'nested/thejaz-criteria.md'); });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.criteriaPath() === 'nested/thejaz-criteria.md');
  await page.evaluate(async () => { await app.vault.create('thejaz-criteria.md', '### Criteria & Markers\n- 😣 | 0-29m | no-pro\n'); });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.criteria()?.issues[0]?.message.includes('Keep one thejaz-criteria.md'));
  await page.evaluate(async () => { for (const name of ['thejaz-criteria.md', 'nested/thejaz-criteria.md']) await app.vault.delete(app.vault.getAbstractFileByPath(name)); });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.criteria() === null);
  checks.push('thejaz-criteria.md is found by name after a move; a second copy is reported as a blocking issue rather than chosen');
  await page.evaluate(async () => {
    for (const leaf of app.workspace.getLeavesOfType('thejaz-planner')) leaf.detach();
    await app.plugins.disablePlugin('thejaz-planner'); await app.plugins.enablePlugin('thejaz-planner');
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  assert((await paths()).includes('nested/thejaz-summary-now.md'));
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.settings.summaryPath), 'nested/thejaz-summary-now.md');
  checks.push('Plugin reload retains renamed target settings and rediscovers filename-marked summaries');
  await page.waitForFunction(() => !app.plugins.plugins['thejaz-planner'].controller.indexing);
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.settings.summaryPath = 'missing-old-name.md'; await c.index();
  });
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.settings.summaryPath), 'nested/thejaz-summary-now.md');
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    await app.vault.create('thejaz-summary-now.md', '### Days\nDays (2014-01-01 - 2014-01-01): 1d\n');
    c.settings.summaryPath = 'missing-old-name.md'; await c.index();
  });
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.settings.summaryPath), 'missing-old-name.md');
  // Remove the root summary created above so later helpers do not adopt it as the current summary.
  await page.evaluate(async () => { await app.vault.delete(app.vault.getAbstractFileByPath('thejaz-summary-now.md')); });
  checks.push('Unique current-summary filenames recover missing settings; multiple candidates never cause an arbitrary target switch');
  assert.deepEqual(errors, []);
  const version = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].manifest.version);
  const report = { version, checks, errors }; await writeFile('artifacts/summary-discovery.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
