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
  original = await page.evaluate(() => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    return { codes: [...c.settings.projectCodes], auto: c.settings.autoUpdate, summary: c.settings.summaryPath };
  });
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false;
    // Test setup only: the interface removes codes through the remove action, never by overwriting the list.
    c.settings.projectCodes = ['CHP', 'MDR'];
    // Registering a project records it in the summary that covers the day, so supply one.
    const summary = '### Days (2015-01-01 - 2015-12-31)\n### Projects\nCHP = 0\nMDR = 0\n';
    c.settings.summaryPath = 'project-labels-summary.md';
    const s = app.vault.getAbstractFileByPath(c.settings.summaryPath);
    if (s) await app.vault.modify(s, summary); else await app.vault.create(c.settings.summaryPath, summary);
    c.ingest(c.settings.summaryPath, summary); await c.saveSettings();
    const text = '## plan for 1 jan 15\n### morning\n- [x] 15:00 (170-40-20/315) : chp & mdr & pln\n- [x] 15:25 (10-15/25) : chp & xpr9\n- [x] 15:40 (15) : breakfast\n\n---\nCHP = 170\nMDR = 40\nPLN = 20\nSUM = 230\n';
    const f = app.vault.getAbstractFileByPath('2015-01-01.md');
    if (f) await app.vault.modify(f, text); else await app.vault.create('2015-01-01.md', text);
    c.ingest('2015-01-01.md', text);
    const v = await p.open(); v.draft = ''; v.captureOpen = false;
    await v.navigate('2015-01-01');
  });
  // A background index finishing would redraw the chips while they are read.
  await page.waitForFunction(() => { const c = app.plugins.plugins['thejaz-planner'].controller; return c.timers.size === 0 && !c.indexing; });
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.whenIdle());
  const rows = page.locator('.planner-row');
  assert.deepEqual(await rows.nth(0).locator('strong.planner-project-name').allTextContents(), ['chp', 'mdr', 'pln']);
  assert(await rows.nth(0).locator('strong.planner-project-name').evaluateAll(els => els.every(el => el.style.getPropertyValue('--planner-project-hue') && +getComputedStyle(el).fontWeight >= 600)));
  checks.push('All three projects are colored and bold when PLN exists only in the note footer');
  assert.deepEqual(await rows.nth(1).locator('strong.planner-project-name').allTextContents(), ['chp']);
  assert.equal(await rows.nth(1).locator('.planner-unknown-project').count(), 0);
  assert.equal(await rows.nth(2).locator('strong, .planner-unknown-project').count(), 0);
  checks.push('An allocated unregistered component stays ordinary while recognized project styling remains intact');
  await rows.nth(1).focus();
  await page.getByRole('button', { name: 'Add XPR9 as project', exact: true }).waitFor({ state: 'visible' });
  const before = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.settings.autoUpdate = true;
    return await app.vault.read(app.vault.getAbstractFileByPath('2015-01-01.md'));
  });
  await page.getByRole('button', { name: 'Add XPR9 as project', exact: true }).click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2015-01-01.md').entries[1].credits.XPR9 === 15);
  await rows.nth(1).locator('strong.planner-project-name', { hasText: 'xpr9' }).waitFor();
  assert.deepEqual(await rows.nth(1).locator('strong.planner-project-name').allTextContents(), ['chp', 'xpr9']);
  const after = await page.evaluate(async () => ({
    text: await app.vault.read(app.vault.getAbstractFileByPath('2015-01-01.md')),
    saved: (await app.plugins.plugins['thejaz-planner'].loadData()).projectCodes
  }));
  assert.equal(after.text, before); assert(after.saved.includes('XPR9'));
  assert.equal(await rows.nth(1).locator('.planner-project-warning').count(), 0);
  checks.push('Inline registration persists the code, refreshes credits/styling and clears its warning without writing the note, with automatic updates enabled');
  // Registered codes now also live in the summary's Projects list; removal is the remove action's job.
  assert.deepEqual(await rows.nth(0).locator('strong.planner-project-name').allTextContents(), ['chp', 'mdr', 'pln']);
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('2015-01-01.md'))), before);
  checks.push('Registration keeps footer-defined projects and the day source unchanged');
  await rows.nth(0).focus();
  await page.locator('.planner-row.is-current .planner-add-below').click();
  await page.getByRole('textbox', { name: 'Quick entry', exact: true }).fill('15:10 10 pln');
  assert.equal(await page.locator('.planner-capture .planner-error').count(), 0);
  assert(await page.locator('.planner-capture').innerText().then(t => t.includes('pln')));
  checks.push('Quick entry accepts the footer-defined PLN code without duplicating it in Settings');
  await page.mouse.move(50, 30);
  await page.screenshot({ path: 'artifacts/planner-project-labels.png' });
  assert.deepEqual(errors, []);
  await writeFile('artifacts/planner-project-labels.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (page && original) await page.evaluate(async state => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.settings.autoUpdate = false;
    c.settings.projectCodes = state.codes;
    c.settings.autoUpdate = state.auto; c.settings.summaryPath = state.summary;
    await c.saveSettings(); await c.index();
  }, original);
  await browser.close();
}
