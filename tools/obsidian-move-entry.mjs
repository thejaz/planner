import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await assertTestVault(page);
  page.on('pageerror', e => errors.push(e.message));
  if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller; c.settings.autoUpdate = false;
    const raw = '## plan for 1 jan 12\n### morning\n- [ ] 09:00 (30) : alpha\n- [ ] 10:00 (40) : bravo\nKeep this annotation.\n\n### afternoon\n- [ ] 11:00 (50) : charlie\n- [ ] 12:00 (60) : delta\n\n---\nSUM = 0\n';
    const f = app.vault.getAbstractFileByPath('2012-01-01.md');
    if (f) await app.vault.modify(f, raw); else await app.vault.create('2012-01-01.md', raw);
    c.ingest('2012-01-01.md', raw);
    const v = await p.open(); await v.navigate('2012-01-01');
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  const waitMove = index => page.waitForFunction(index => {
    const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
    return !v.moving && v.selected === index && v.day.entries[index]?.label === 'bravo' &&
      document.querySelector('.planner-row.is-current')?.getAttribute('data-index') === String(index);
  }, index);
  const state = () => page.evaluate(() => {
    const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
    return { selected: v.selected, entries: v.day.entries.map(e => ({ label: e.label, section: e.section, raw: e.raw })),
      position: v.contentEl.querySelector('.planner-capture').previousElementSibling?.getAttribute('data-index') };
  });
  const raw = () => page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.port.read('2012-01-01.md'));
  await page.locator('.planner-row').nth(1).click();
  const down = page.locator('.planner-row.is-current').getByRole('button', { name: 'Move down', exact: true });
  await down.click(); await waitMove(1);
  let result = await state();
  assert.deepEqual(result.entries.map(e => e.label), ['alpha', 'bravo', 'charlie', 'delta']);
  assert.deepEqual(result.entries.map(e => e.section), ['morning', 'afternoon', 'afternoon', 'afternoon']);
  assert((await raw()).includes('Keep this annotation.\n\n### afternoon\n- [ ] 10:00 (40) : bravo\n- [ ] 11:00 (50) : charlie'));
  assert.equal(result.position, '1');
  checks.push('Crossing a heading moves to the start of the next section without also passing its first activity');
  await down.click(); await waitMove(2);
  assert.deepEqual((await state()).entries.map(e => e.label), ['alpha', 'charlie', 'bravo', 'delta']);
  await down.click(); await waitMove(3);
  result = await state();
  assert.deepEqual(result.entries.map(e => e.label), ['alpha', 'charlie', 'delta', 'bravo']);
  assert.equal(result.entries[3].raw, '- [ ] 10:00 (40) : bravo');
  assert(await down.isDisabled());
  assert(await page.locator('.planner-row.is-current').evaluate(el => el === document.activeElement));
  checks.push('Repeated Move down follows the same activity; its raw time/credit remain intact and the boundary action disables');
  const up = page.locator('.planner-row.is-current').getByRole('button', { name: 'Move up', exact: true });
  await up.click(); await waitMove(2);
  assert(await up.evaluate(el => el === document.activeElement));
  await page.keyboard.press('Enter'); await waitMove(1);
  assert.deepEqual((await state()).entries.map(e => e.label), ['alpha', 'bravo', 'charlie', 'delta']);
  checks.push('Repeated Move up and keyboard Enter keep focus attached to the moved activity');
  await up.click(); await waitMove(1);
  assert.equal((await state()).entries[1].section, 'morning');
  assert.deepEqual((await state()).entries.map(e => e.label), ['alpha', 'bravo', 'charlie', 'delta']);
  checks.push('Moving up across a heading reaches the end of the previous section without passing its last activity');
  const before = await raw();
  await up.click(); await waitMove(0);
  assert(await up.isDisabled());
  result = await state();
  assert.equal(result.entries[0].section, 'morning');
  assert.equal(result.entries[1].label, 'alpha');
  checks.push('Moving into the preceding section preserves the other activities and disables Move up at the first row');
  await page.locator('.planner-row.is-current').focus(); await page.keyboard.press('Control+z');
  await page.waitForFunction(before => app.plugins.plugins['thejaz-planner'].controller.days.get('2012-01-01.md')?.text === before, before);
  assert.equal(await raw(), before);
  checks.push('Conflict-aware keyboard undo restores the exact pre-move note bytes');
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    const text = '## plan for 1 jan 14\n### morning\n- [ ] 10:00 (40) : bravo\n\n### afternoon\n\n### evening\n- [ ] 19:00 (30) : charlie\n- [ ] 20:00 (50) : delta\n\n---\nSUM = 0\n';
    const f = app.vault.getAbstractFileByPath('2014-01-01.md');
    if (f) await app.vault.modify(f, text); else await app.vault.create('2014-01-01.md', text);
    c.ingest('2014-01-01.md', text);
    const v = await p.open(); await v.navigate('2014-01-01');
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  await page.locator('.planner-row').first().focus();
  const boundaryMove = async (direction, section) => {
    await page.locator('.planner-row.is-current').getByRole('button', { name: direction === 1 ? 'Move down' : 'Move up', exact: true }).click();
    await page.waitForFunction(section => {
      const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
      return !v.moving && v.day.entries[v.selected]?.label === 'bravo' && v.day.entries[v.selected]?.section === section;
    }, section);
    assert.deepEqual((await state()).entries.map(e => e.label), ['bravo', 'charlie', 'delta']);
  };
  await boundaryMove(1, 'afternoon');
  assert(await page.locator('.planner-row.is-current').getByRole('button', { name: 'Move up', exact: true }).isEnabled());
  await boundaryMove(1, 'evening');
  await boundaryMove(-1, 'afternoon');
  await boundaryMove(-1, 'morning');
  assert(await page.locator('.planner-row.is-current').getByRole('button', { name: 'Move up', exact: true }).isDisabled());
  checks.push('Empty afternoon and populated evening are each one step in both directions; valid section moves stay enabled even at the first activity index');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/planner-move-entry.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await browser.close(); }
