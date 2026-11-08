import { assertTestVault } from './paths.mjs';
import { readFileSync } from 'node:fs';
const combinationRules = /export const COMBINATION_RULES = `([\s\S]*?)`;/.exec(readFileSync('src/core/marker-combinations.ts', 'utf8'))[1];
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';
import { plannerUI } from './planner-ui.mjs';
import { setCriteria } from './criteria-note.mjs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], path = 'Context legend verification.md';
let legend = `### Criteria & Markers
- 😣 | 0-29m | can't study
- ✌ | 0-29m | light can't study (context: excused)
- 😎 | 0-29m | no study weekends
- 🦥 | 30-149m | low pro
- ❄️ | 150-299m | cool
- 🔥 | ≥300m | hot
- 🕶️ | at-ease days (context: at-ease)
- ☁️ | buffer days (context: buffer)
- highlights | can't study (formatting)
- **bolds** | weekends (formatting)
${combinationRules}
`;
if (process.argv.includes('--canonical')) legend = /export const CANONICAL_LEGEND = `([\s\S]*?)`;/.exec(await readFile('src/core/marker-rules.ts', 'utf8'))[1];
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await page.waitForFunction(() => typeof app !== 'undefined' && app.vault);
  await assertTestVault(page);
  const trust = page.getByRole('button', { name: 'Trust author and enable plugins', exact: true });
  if (await trust.count()) await trust.click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  await page.evaluate(() => app.setting.close());
  page.on('pageerror', e => errors.push(e.message));
  // The legend lives in thejaz-criteria.md; the summary holds only days, projects and results.
  await setCriteria(page, legend);
  await page.evaluate(async ({ path }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false; c.settings.summaryPath = path; c.settings.weekendDays = [5];
    const store = async (path, text) => {
      const f = app.vault.getAbstractFileByPath(path);
      if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    };
    await store(path, '### Days\n2011-01-02 = 20 😣\n2011-01-03 = 200 ❄️\n### Projects\nCHP = 20\nMDR = 200\n### Results\nDays (2011-01-02 - 2011-01-03): 2d\nMy annotation stays.\n');
    await store('2011-01-02.md', '## plan for 2 jan 11\n### morning\n- [x] 09:00 (20) : CHP\nCHP = 20\nSUM = 20\n');
    await store('2011-01-03.md', '## plan for 3 jan 11\n### morning\n- [x] 09:00 (200) : mdr\nMDR = 200\nSUM = 200\n');
    await c.index(); const v = await p.open(); v.switchMode('day'); await v.navigate('2011-01-02');
  }, { path });
  await page.locator('.planner-label').first().click();
  const raw = () => page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.port.read(path), path);
  const before = await raw();
  const open = async () => { await page.getByRole('button', { name: 'set day context', exact: true }).click(); await page.locator('.modal').waitFor(); };
  const choose = async value => {
    await page.locator(`.modal input[data-context="${value}"]`).check();
    await page.getByRole('button', { name: 'save context', exact: true }).click();
    await page.locator('.modal').waitFor({ state: 'detached' });
  };
  await open();
  const options = await page.locator('.modal input[type=radio]').evaluateAll(els => els.map(el => el.value));
  assert.deepEqual(options, ['ordinary', 'excused', 'at-ease', 'buffer']);
  assert.equal(await page.locator('.modal input[type=radio]:checked').inputValue(), 'ordinary');
  assert.equal(await page.locator('.modal input[type=checkbox]').count(), 0);
  await choose('excused');
  assert((await raw()).includes('2011-01-02 = 20 ✌'));
  assert((await raw()).includes('My annotation stays.'));
  checks.push('One context selector reads named contexts from the legend, defaults to ordinary and saves excused 20m as unhighlighted no-pro');
  await page.locator('.planner-row').first().focus(); await page.keyboard.press('Control+z');
  await page.waitForFunction(path => app.plugins.plugins['thejaz-planner'].controller.summaries.get(path)?.text.includes('2011-01-02 = 20 😣'), path);
  assert.equal(await raw(), before);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(path => app.plugins.plugins['thejaz-planner'].controller.summaries.get(path)?.text.includes('2011-01-02 = 20 ✌'), path);
  checks.push('Context changes use guarded recovery; Undo/Redo restore exact summary bytes');
  await open(); assert.equal(await page.locator('.modal input[type=radio]:checked').inputValue(), 'excused'); await choose('buffer');
  assert((await raw()).includes('2011-01-02 = 20 ☁️')); assert(!(await raw()).includes('2011-01-02 = 20 ✌'));
  await open(); await choose('ordinary'); assert((await raw()).includes('2011-01-02 = 20 😣'));
  checks.push('Selecting a different context replaces the prior context; ordinary clears context without changing productivity credit');
  await page.evaluate(async () => { await app.workspace.getLeavesOfType('thejaz-planner')[0].view.navigate('2011-01-03'); });
  await open(); await page.locator('.modal input[data-context=excused]').check(); assert((await page.locator('.modal .planner-context-result').innerText()).includes('No special context will remain')); await choose('excused');
  assert((await raw()).includes('2011-01-03 = 200 ❄️')); assert(!(await raw()).includes('200 ✌'));
  await open(); assert.equal(await page.locator('.modal input[type=radio]:checked').inputValue(), 'ordinary'); await page.keyboard.press('Escape');
  checks.push('Excused at 200m saves only normal productivity and reopens as ordinary when no applicable context marker exists; the dialog explains the range');
  await open(); await choose('buffer'); assert((await raw()).includes('2011-01-03 = 200 ☁️❄️'));
  await open(); await choose('at-ease'); assert((await raw()).includes('2011-01-03 = 200 🕶️❄️'));
  await open(); await choose('ordinary');
  checks.push('Planned contexts at 200m keep the earned cool marker without any no-pro face');
  await page.evaluate(() => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.preset = 'custom'; v.rangeStart = '2011-01-02'; v.rangeEnd = '2011-01-03'; v.switchMode('review'); });
  assert.equal(await page.locator('.planner-marker-count').count(), 8);
  assert.equal(await page.locator('.planner-marker-count[data-marker="bold"],.planner-marker-count[data-marker="highlight"]').count(), 0);
  // Symbol and lowercase legend label are separate elements.
  const cantStudy = page.locator('.planner-marker-count[data-marker="😣"]');
  assert.equal(await cantStudy.locator('.planner-marker-symbol').innerText(), '😣');
  assert.equal(await cantStudy.locator('.planner-marker-label').innerText(), process.argv.includes('--canonical') ? 'no-pro' : "can't study");
  assert(!(await page.locator('.planner-marker-counts').innerText()).includes('(context'));
  assert(!(await page.locator('.planner-day-records').evaluate(el => el.open)));
  await page.locator('.planner-day-records > summary').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.planner-day-records').open);
  assert(await page.locator('.planner-review-table').isVisible());
  await page.evaluate(async () => { await app.workspace.getLeavesOfType('thejaz-planner')[0].view.refresh(); });
  assert(await page.locator('.planner-day-records').evaluate(el => el.open));
  await page.locator('.planner-day-records > summary').click();
  assert(!(await page.locator('.planner-review-table').isVisible()));
  checks.push('Every emoji has a visible lowercase legend; formatting rules add no duplicate counts; day records collapse, expand by keyboard and retain state across refresh');
  await page.screenshot({ path: 'artifacts/context-legend-review.png' });
  await page.evaluate(async () => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.switchMode('day'); await v.navigate('2011-01-02'); });
  assert.equal(await page.locator('.planner-project-name').innerText(), 'chp');
  assert.equal(await page.locator('.planner-project-chip strong').first().innerText(), 'CHP');
  assert.equal(await page.locator('.planner').evaluate(el => getComputedStyle(el).textTransform), 'none');
  assert.equal(await page.getByRole('button', { name: 'Activity', exact: true }).innerText(), 'Activity');
  assert.equal(await page.getByRole('button', { name: 'Set day context', exact: true }).innerText(), 'set day context');
  await setCriteria(page, '### Criteria & Markers\n- 😣 | 0-29m | can\'t study\n');
  await open(); assert.equal(await page.locator('.modal input[type=radio]').count(), 1);
  await page.keyboard.press('Escape');
  checks.push('Normal interface capitalization is preserved, emoji legends and inline project codes remain lowercase, totals retain uppercase codes, and a legend with no contexts offers ordinary day only');
  assert.deepEqual(errors, []);
  const version = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].manifest.version);
  const report = { version, checks, errors };
  await writeFile(process.argv.includes('--canonical') ? 'artifacts/context-legend-canonical.json' : 'artifacts/context-legend.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
