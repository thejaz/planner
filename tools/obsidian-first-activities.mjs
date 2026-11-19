// Synthetic native check (0.2.130): a first timed activity without minutes saves n/a, and an
// activity name indexed only once is green until a second occurrence is indexed.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { assertTestVault } from './paths.mjs';
import { plannerUI } from './planner-ui.mjs';
import { chooseCapture } from './capture-choice.mjs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], date = '2005-06-07', other = '2005-06-06', later = '2005-06-08';
let page;
try {
  page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await assertTestVault(page); page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  await page.evaluate(async ([date, other, later]) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller; await c.whenIdle();
    c.settings.autoUpdate = false;
    for (const path of [other + '.md', later + '.md']) { const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.delete(f); }
    const path = date + '.md', text = '## plan for 7 jun 05\n### morning\n\nSUM = 0\n';
    const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    await c.index(); const v = await p.open(); v.switchMode('day'); v.draft = ''; await v.navigate(date);
  }, [date, other, later]);
  const raw = () => page.evaluate(date => app.plugins.plugins['thejaz-planner'].controller.port.read(date + '.md'), date);
  const settled = () => page.evaluate(async () => { const c = app.plugins.plugins['thejaz-planner'].controller; await c.mutation; await c.whenIdle(); });
  const input = () => page.getByRole('textbox', { name: 'Quick entry', exact: true });
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  await chooseCapture(page, 'Entry mode', 'plan');
  const name = 'zephyrwalk';
  await input().fill(`14:30 ${name}`);
  const preview = await page.locator('.planner-preview').innerText();
  assert(preview.includes(`14:30 (n/a) : ${name}`), preview); assert(!preview.includes('awake'), preview);
  await input().press('Enter');
  await page.waitForFunction(date => app.plugins.plugins['thejaz-planner'].controller.days.get(date + '.md')?.entries.length === 1, date);
  await settled();
  assert((await raw()).includes(`- [ ] 14:30 (n/a) : ${name}\n`));
  checks.push('Empty day: 14:30 activity without minutes previews and saves n/a, with no start row');

  const green = () => page.evaluate(name => [...document.querySelectorAll('.planner-row .planner-new-activity')].map(el => ({
    text: el.textContent, color: getComputedStyle(el).color, plain: getComputedStyle(el.closest('.planner-label')).color,
    weight: getComputedStyle(el).fontWeight, plainWeight: getComputedStyle(el.closest('.planner-label')).fontWeight,
    tag: getComputedStyle(el, '::after').content })).filter(g => g.text === name), name);
  await page.waitForFunction(name => [...document.querySelectorAll('.planner-row .planner-new-activity')].some(el => el.textContent === name), name);
  const first = await green();
  // 0.2.135: plain text colour and weight with a small "new" tag, unlike bold coloured projects.
  assert.equal(first.length, 1); assert.equal(first[0].color, first[0].plain); assert.equal(first[0].weight, first[0].plainWeight);
  assert.equal(first[0].tag, '"new"');
  assert.equal(await page.evaluate(name => document.querySelector('.planner-row .planner-label')?.textContent, name), name);
  checks.push('A never-indexed activity name keeps the plain text style with a small "new" tag; the label text is unchanged');

  // 0.2.138: a later plan that already lists the name (a template copy) is not earlier use.
  await page.evaluate(async ([later, name]) => { await app.vault.create(later + '.md', `## plan for 8 jun 05\n### morning\n- [ ] 09:00 (n/a) : ${name}\nSUM = 0\n`); }, [later, name]);
  await page.waitForFunction(later => app.plugins.plugins['thejaz-planner'].controller.days.has(later + '.md'), later);
  await page.waitForTimeout(500);
  assert.equal((await green()).length, 1);
  checks.push('A later plan with the same name leaves it marked new on the earlier day');

  // An earlier occurrence, written in another note outside the planner, is indexed by the file watcher.
  await page.evaluate(async ([other, name]) => { await app.vault.create(other + '.md', `## plan for 6 jun 05\n### morning\n- [ ] 09:00 (n/a) : ${name} & tea\nSUM = 0\n`); }, [other, name]);
  await page.waitForFunction(other => app.plugins.plugins['thejaz-planner'].controller.days.has(other + '.md'), other);
  await page.waitForFunction(name => ![...document.querySelectorAll('.planner-row .planner-new-activity')].some(el => el.textContent === name), name, { timeout: 5000 });
  checks.push('Once an earlier date uses the name, the new tag disappears');

  await page.evaluate(other => { void app.vault.delete(app.vault.getAbstractFileByPath(other + '.md')); }, other);
  await page.waitForFunction(other => !app.plugins.plugins['thejaz-planner'].controller.days.has(other + '.md'), other);
  await page.waitForFunction(name => [...document.querySelectorAll('.planner-row .planner-new-activity')].some(el => el.textContent === name), name, { timeout: 5000 });
  checks.push('Removing the earlier occurrence makes it new again, without a reindex');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/first-activities.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  console.error(error); console.log(JSON.stringify({ checks, errors }, null, 2)); process.exitCode = 1;
} finally {
  await page?.evaluate(async ([date, other, later]) => {
    for (const path of [date + '.md', other + '.md', later + '.md']) { const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.delete(f); }
  }, [date, other, later]).catch(() => {});
  await browser.close();
}
