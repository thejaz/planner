import { assertTestVault } from './paths.mjs';
// Native check of the planner-day rule (0.2.63): date-named notes count only with a plan
// heading and SUM; two plans for one date resolve by folder; a non-plan note holding the
// name can be turned into the plan with consent, keeping its own text below.
import { plannerUI } from './planner-ui.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await assertTestVault(page);
  page.on('pageerror', e => errors.push(e.message));
  const journal = 'Wrote three pages.\nSUM = 30 felt like a good number.\n';
  await page.evaluate(async journal => {
    const c = app.plugins.plugins['thejaz-planner'].controller; c.settings.autoUpdate = false;
    const store = async (path, text) => {
      const folder = path.split('/').slice(0, -1).join('/');
      if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
      const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    };
    const plan = (heading, minutes) => `${heading}\n### morning\n- [x] 09:00 (${minutes}) : chp\nCHP = ${minutes}\nSUM = ${minutes}\n`;
    await store('Journal/2007-05-02.md', journal);
    await store('plans/2007-05-03.md', plan('## plan for 3 may 07', 30));
    await store('plans/2007-05-04.md', plan('## plan for 4 may 07', 40));
    await store('other/2007-05-03.md', plan('## plan for 3 may 07', 99));
    await store('2007-05-05.md', journal);
    await c.index(); while (c.indexing) await new Promise(r => setTimeout(r, 50));
  }, journal);
  const state = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    const day = await c.getDay('2007-05-03');
    return { journalIndexed: c.days.has('Journal/2007-05-02.md') || c.days.has('2007-05-05.md'), chosen: day?.path };
  });
  assert.equal(state.journalIndexed, false);
  checks.push('A date-named note without a plan heading and SUM is ignored: not indexed, not reported');
  assert.equal(state.chosen, 'plans/2007-05-03.md');
  await page.evaluate(() => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.preset = 'custom'; v.rangeStart = '2007-05-03'; v.rangeEnd = '2007-05-03'; v.recordsOpen = true; v.switchMode('review'); });
  const records = await page.locator('.planner-day-records').textContent();
  assert(records.includes('Also a plan for this date, not counted: other/2007-05-03.md'), records);
  assert((await page.locator('.planner-review-total').innerText()).includes('30'));
  checks.push('Two plans for one date: the one among most planner days counts (30m, not 99m); Review names the other without blocking');
  await page.evaluate(async () => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.switchMode('day'); await v.navigate('2007-05-05'); });
  await page.getByRole('button', { name: 'Create day', exact: true }).click();
  await page.locator('.modal').getByRole('button', { name: 'Create day', exact: true }).click();
  const consent = page.getByRole('button', { name: 'Add plan to this note', exact: true });
  await consent.waitFor();
  assert((await page.locator('.modal').last().innerText()).includes('2007-05-05.md already exists and is not a plan'));
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.port.read('2007-05-05.md')), journal);
  await consent.click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.has('2007-05-05.md'));
  const adopted = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.port.read('2007-05-05.md'));
  assert(adopted.startsWith('## plan for 5 may 07\n')); assert(adopted.endsWith('\n' + journal));
  checks.push('Creating a day whose name a non-plan note holds asks first; consent adds the plan on top and keeps every byte of the note below');
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.undo(); });
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.port.read('2007-05-05.md')), journal);
  checks.push('Undo restores the note exactly');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/day-identity.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await browser.close(); }
