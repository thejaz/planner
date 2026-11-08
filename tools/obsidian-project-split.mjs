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
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    globalThis.splitTestClock = c.now; c.now = () => ({ date: '2010-01-01', time: '17:22' }); c.settings.autoUpdate = false;
    const raw = '## plan for 1 jan 10\n### afternoon\n- [x] 16:10 (n/a) : setup\n\n---\nSUM = 0\n\nKeep this note.\n';
    const file = app.vault.getAbstractFileByPath('2010-01-01.md');
    if (file) await app.vault.modify(file, raw); else await app.vault.create('2010-01-01.md', raw);
    c.ingest('2010-01-01.md', raw);
    const v = await p.open(); await v.navigate('2010-01-01');
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  const raw = () => page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.port.read('2010-01-01.md'));
  const initial = await raw();
  const quick = page.getByRole('textbox', { name: 'Quick entry', exact: true });
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  await quick.fill('now chp & frm');
  assert(await page.getByRole('button', { name: 'Add entry', exact: true }).isDisabled());
  assert((await page.locator('.planner-error').first().innerText()).includes('Choose how to divide credit'));
  await page.getByRole('button', { name: 'Split equally: CHP 36m | FRM 36m', exact: true }).click();
  assert.equal(await quick.inputValue(), 'now 36-36/0 chp & frm');
  assert.equal(await raw(), initial);
  assert.equal(await page.locator('.planner-preview-area .planner-error').count(), 0);
  assert((await page.locator('.planner-preview').innerText()).includes('(36-36/72) : chp & frm'));
  checks.push('The reported now chp & frm input has an actionable equal-split choice; choosing it clears the error and previews explicit credits without saving');
  await quick.press('Enter');
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2010-01-01.md')?.text.includes('17:22 (36-36/72) : chp & frm'));
  assert((await raw()).includes('Keep this note.'));
  await page.waitForFunction(() => document.querySelector('[data-planner-key="quick-entry"]')?.value === '');
  checks.push('Keyboard submission saves the explicit allocation as ordinary Markdown and preserves unrelated text');
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  await quick.fill('17:52 20-10/0 chp & frm');
  assert((await page.locator('.planner-preview').innerText()).includes('(20-10/30)'));
  assert.equal(await page.locator('.planner-split-choice').count(), 0);
  assert(await page.getByRole('button', { name: 'Add entry', exact: true }).isEnabled());
  checks.push('Custom unequal allocations remain intact and do not receive a replacement suggestion');
  const backgrounds = {};
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(`theme-${theme}`); }, theme);
    await page.locator('.planner-capture').evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))); });
    backgrounds[theme] = await page.locator('.planner-capture').evaluate(el => getComputedStyle(el).backgroundColor);
    assert(backgrounds[theme].includes(theme === 'light' ? '0.055' : '0.075'));
    await page.locator('.planner-capture').scrollIntoViewIfNeeded();
    await page.mouse.move(1, 1);
    await page.screenshot({ path: `artifacts/planner-inline-purple-${theme}.png` });
  }
  checks.push('Inline editor has a soft translucent purple surface in light and dark themes');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/planner-project-split.json', JSON.stringify({ checks, errors, backgrounds }, null, 2));
  console.log(JSON.stringify({ checks, errors, backgrounds }, null, 2));
} finally {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await page.evaluate(() => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    if (globalThis.splitTestClock) { c.now = globalThis.splitTestClock; delete globalThis.splitTestClock; }
    document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light');
  });
  await browser.close();
}
