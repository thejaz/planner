import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
let page, original;
try {
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await assertTestVault(page);
  page.on('pageerror', e => errors.push(e.message));
  original = await page.evaluate(() => structuredClone(app.plugins.plugins['thejaz-planner'].controller.settings));
  const rawDay = '## plan for 1 jan 16\n### morning\n- [x] 09:00 (10) : chp\n\n---\nCHP = 10\nSUM = 10\n';
  const rawSummary = '### Days (2016-01-01 - 2016-01-01)\n2016-01-01 = 10 😎\n\n### Projects\n🦉 CHP = 10\n\n---\n\n## Bookmarks\nkeep this exactly\n\n## Results\nprivate prose stays\n';
  await page.evaluate(async ({ rawDay, rawSummary }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    // Save the test settings: Undo restores project settings by merging the saved settings.
    c.settings.autoUpdate = false; c.settings.summaryPath = 'new-project-summary.md'; await c.saveSettings();
    // setProjectCodes only adds; removing a code needs the remove preview.
    await c.setProjectCodes([...new Set([...c.settings.projectCodes, 'CHP'])]);
    for (const [path, text] of [['2016-01-01.md', rawDay], ['new-project-summary.md', rawSummary]]) {
      const f = app.vault.getAbstractFileByPath(path);
      if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
      c.ingest(path, text);
    }
    const v = await p.open(); v.draft = ''; v.captureOpen = false; v.mode = 'day'; await v.navigate('2016-01-01');
  }, { rawDay, rawSummary });
  // Wait for pending updates and their re-render before using the chip.
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    do { while (c.timers.size || c.indexing) await new Promise(r => setTimeout(r, 50)); await c.mutation; } while (c.timers.size);
    await new Promise(r => requestAnimationFrame(() => r()));
  });
  const chip = page.getByRole('button', { name: '+ Add new project', exact: true });
  await chip.scrollIntoViewIfNeeded();
  const style = await chip.evaluate(el => ({ border: getComputedStyle(el).borderTopStyle, background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
  assert.equal(style.border, 'dashed'); assert.equal(style.background, 'rgb(255, 255, 255)'); assert.equal(style.color, 'rgb(115, 115, 126)');
  await chip.focus(); await chip.press('Enter');
  await page.getByRole('textbox', { name: 'Project code', exact: true }).fill('SUM');
  await page.getByRole('button', { name: 'Add project', exact: true }).click();
  assert((await page.locator('.modal .planner-error').innerText()).includes('reserved'));
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('2016-01-01.md'))), rawDay);
  checks.push('Dashed white/gray chip opens by keyboard; reserved codes show an inline error without touching the note');
  await page.getByRole('textbox', { name: 'Project code', exact: true }).fill(' zpr9 ');
  await page.getByRole('button', { name: 'Add project', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.modal-container'));
  const result = await page.evaluate(async () => ({
    day: await app.vault.read(app.vault.getAbstractFileByPath('2016-01-01.md')),
    summary: await app.vault.read(app.vault.getAbstractFileByPath('new-project-summary.md')),
    codes: (await app.plugins.plugins['thejaz-planner'].loadData()).projectCodes
  }));
  assert.equal(result.day, rawDay.replace('SUM = 10', 'ZPR9 = 0\nSUM = 10'));
  const line = result.summary.split('\n').find(line => line.includes('ZPR9 ='));
  assert(line && /\p{Extended_Pictographic}/u.test(line) && line.endsWith('ZPR9 = 0'));
  assert.equal(result.summary, rawSummary.replace('🦉 CHP = 10\n', `🦉 CHP = 10\n${line}\n`));
  assert(result.codes.includes('ZPR9'));
  assert((await page.locator('.planner-project-chip').allTextContents()).some(t => t.includes('ZPR9')));
  checks.push('Creation persists the definition, adds its zero chip/day footer and a random emoji summary row after the last project, preserving all trailing text');
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    await c.undo();
  });
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('2016-01-01.md'))), rawDay);
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('new-project-summary.md'))), rawSummary);
  await page.evaluate(async emoji => { await app.plugins.plugins['thejaz-planner'].controller.createProject('ZPR9', emoji, '2016-01-01.md'); }, line.slice(0, line.indexOf(' ZPR9')));
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('new-project-summary.md'))), result.summary);
  checks.push('One undo restores both note changes exactly; the registered code can be added again safely');
  await chip.click(); await page.getByRole('textbox', { name: 'Project code', exact: true }).fill('zpr9');
  await page.getByRole('button', { name: 'Add project', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.modal-container'));
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('new-project-summary.md'))), result.summary);
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('2016-01-01.md'))), result.day);
  checks.push('Adding the same code again preserves the existing emoji/totals and creates no duplicate');
  const reordered = result.summary.replace(line + '\n', '').replace('### Projects\n', `### Projects\n${line}\n`);
  await page.evaluate(async text => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    await app.vault.modify(app.vault.getAbstractFileByPath('new-project-summary.md'), text); c.ingest('new-project-summary.md', text);
  }, reordered);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  await page.evaluate(() => { app.plugins.plugins['thejaz-planner'].controller.settings.autoUpdate = true; });
  const row = page.locator('.planner-row').first(); await row.focus(); await row.press('Enter');
  // 0.2.49 compact editor: one input with time, activity and minutes.
  const compact = page.getByRole('textbox', { name: 'Edit activity input', exact: true });
  await compact.fill('09:00 10 zpr9'); await compact.press('Enter');
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.summaries.get('new-project-summary.md').projects.find(p => p.code === 'ZPR9')?.value === 10);
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('new-project-summary.md'))), reordered.replace('ZPR9 = 0', 'ZPR9 = 10').replace('CHP = 10', 'CHP = 0'));
  checks.push('Manual project reordering is retained; logging updates the relocated total by code without moving it or modifying Bookmarks');
  await chip.scrollIntoViewIfNeeded(); await page.mouse.move(40, 40);
  await page.screenshot({ path: 'artifacts/planner-new-project.png' });
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller; c.settings.autoUpdate = false;
    // A valid period but no Projects heading; the period is validated first.
    const text = '### Days (2016-01-01 - 2016-01-01)\n2016-01-01 = 10\n\n### Bookmarks\nkeep';
    await app.vault.modify(app.vault.getAbstractFileByPath('new-project-summary.md'), text); c.ingest('new-project-summary.md', text);
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  const before = await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('2016-01-01.md')));
  await chip.click(); await page.getByRole('textbox', { name: 'Project code', exact: true }).fill('BAD9');
  await page.getByRole('button', { name: 'Add project', exact: true }).click();
  assert((await page.locator('.modal .planner-error').innerText()).includes('Projects heading'));
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('2016-01-01.md'))), before);
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.settings.projectCodes.includes('BAD9')), false);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  checks.push('A missing Projects heading explains how to resolve it and leaves daily notes and definitions unchanged');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/planner-new-project.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (page && original) await page.evaluate(async state => {
    const c = app.plugins.plugins['thejaz-planner'].controller; c.settings.autoUpdate = false;
    c.settings.summaryPath = state.summaryPath; await c.saveSettings(); // Added test codes stay registered; removal needs the remove preview.
    c.settings = state; await c.saveSettings(); c.emit();
  }, original);
  await browser.close();
}

