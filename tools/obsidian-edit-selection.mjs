import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
// Opening the activity editor selects exactly the part that was double-clicked; Edit, E, Enter and F2 select the end time and minutes.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [];
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await assertTestVault(page);
  await page.bringToFront();
  if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const store = async (path, content) => { const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, content); else await app.vault.create(path, content); };
    await store('2008-04-04.md', '## plan for 4 apr 08\n\n### morning\n\n- [x] 08:35 (n/a) : awake\n- [ ] 08:55 (20) : recovery\n- [ ] 10:00 (25-40/65) : frm & party 2\n\n### afternoon\n\n### evening\n\n---\n\nFRM = 0\nSUM = 0\n');
    const v = await app.plugins.plugins['thejaz-planner'].open(); v.switchMode('day'); await v.navigate('2008-04-04');
  });
  const row = i => page.locator(`.planner-row[data-index="${i}"]`);
  const input = page.getByRole('textbox', { name: 'Edit activity input' }).or(page.locator('.planner-activity-editor textarea')).first();
  const selected = () => input.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd));
  const close = async () => { await input.press('Escape'); await page.locator('.planner-activity-editor').waitFor({ state: 'detached' }); };
  const cases = [];
  for (const [index, cell, expected] of [[1, '.planner-time', '08:55'], [1, '.planner-duration', '20'], [1, '.planner-label', 'recovery'],
    [2, '.planner-duration', '25-40/65'], [2, '.planner-label', 'frm & party 2']]) {
    // Select the row first, as a settled double-click on it would.
    await row(index).locator('.planner-label').click(); await row(index).locator(cell).dblclick(); await input.waitFor();
    cases.push([cell, await selected()]); assert.equal(await selected(), expected, `${cell} on row ${index}`);
    await close();
  }
  checks.push('Double-clicking the time, minutes or activity selects exactly that part');
  await row(1).locator('.planner-label').click();
  await row(1).getByRole('button', { name: 'Edit', exact: true }).click(); await input.waitFor();
  assert.equal(await selected(), '08:55 20'); await close();
  for (const key of ['F2', 'e', 'Enter']) {
    await row(1).locator('.planner-label').click(); await row(1).press(key); await input.waitFor();
    assert.equal(await selected(), '08:55 20', key); await close();
  }
  await row(2).locator('.planner-label').click(); await row(2).press('F2'); await input.waitFor();
  assert.equal(await selected(), '10:00 25-40/65'); await close();
  checks.push('The Edit button, E, Enter and F2 select the end time and minutes together');
  await writeFile('artifacts/edit-selection-native.json', JSON.stringify({ checks, cases }, null, 2));
  console.log(JSON.stringify({ checks }, null, 2));
} finally { await browser.close(); }
