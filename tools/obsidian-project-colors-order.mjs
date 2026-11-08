import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
let page, original;
const checks = [], errors = [];
try {
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page);
  original = await page.evaluate(() => ({ settings: structuredClone(app.plugins.plugins['thejaz-planner'].controller.settings), body: document.body.className }));
  page.on('pageerror', e => errors.push(e.message));
  const rawSummary = '### Days (2020-01-01 - 2020-01-01)\n2020-01-01 = 40 🦥\n### Projects\n🦉 CHP = 10\n\n---\n🌍 MDR = 30\n🐰 HAY = 0\n\n### Bookmarks\nkeep exact prose\n';
  await page.evaluate(async rawSummary => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false; c.settings.summaryPath = 'colors-order-summary.md';
    const day = '## plan for 1 jan 20\n### morning\n- [x] 09:00 (10) : chp\n- [x] 09:30 (30) : mdr\n\nCHP = 10\nMDR = 30\nHAY = 0\nSUM = 40\n';
    for (const [path, text] of [['2020-01-01.md', day], [c.settings.summaryPath, rawSummary]]) {
      const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text); c.ingest(path, text);
    }
    const v = await p.open(); v.mode = 'day'; v.captureOpen = false; v.draft = ''; await v.navigate('2020-01-01');
  }, rawSummary);
  // A background index finishing would redraw the chips while they are read.
  await page.waitForFunction(() => { const c = app.plugins.plugins['thejaz-planner'].controller; return c.timers.size === 0 && !c.indexing; });
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.whenIdle());
  const chips = page.locator('.planner-totals .planner-project-totals > button.planner-project-chip');
  assert.deepEqual(await chips.locator('strong').allTextContents(), ['MDR', 'CHP', 'HAY']);
  for (const theme of ['theme-light', 'theme-dark']) {
    await page.evaluate(theme => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(theme); }, theme);
    await page.mouse.move(20, 20);
    const colors = await chips.evaluateAll(es => es.map(e => ({ background: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color })));
    assert.equal(colors.length, 3); assert.equal(new Set(colors.map(c => c.background)).size, 3);
    assert(colors.every(c => c.background !== 'rgb(255, 255, 255)' && c.background !== 'rgba(0, 0, 0, 0)'));
    await chips.first().hover();
    assert.equal(await chips.first().evaluate(e => getComputedStyle(e).backgroundColor), colors[0].background);
    await page.locator('.planner-totals').screenshot({ path: `artifacts/planner-project-colors-${theme}.png` });
  }
  checks.push('Three clickable project chips retain distinct pastel colors in light/dark themes and on hover, including zero credit');
  await chips.first().click(); assert.equal(await page.locator('.modal-title').innerText(), 'Manage project');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  checks.push('Colored chips still open project management');
  await page.evaluate(() => {
    const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
    v.preset = 'custom'; v.rangeStart = '2020-01-01'; v.rangeEnd = '2020-01-01'; v.switchMode('review');
  });
  assert.deepEqual(await page.locator('.planner main > .planner-project-totals strong').allTextContents(), ['MDR', 'CHP', 'HAY']);
  checks.push('Review project totals appear from most to least credited time');
  await page.getByRole('button', { name: 'Sort summary projects', exact: true }).click();
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  const expected = rawSummary.replace('🦉 CHP = 10', '🌍 MDR = 30').replace('---\n🌍 MDR = 30', '---\n🦉 CHP = 10');
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('colors-order-summary.md'))), expected);
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.undo(); });
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('colors-order-summary.md'))), rawSummary);
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.redo(); });
  assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath('colors-order-summary.md'))), expected);
  checks.push('Recorded summary sorting preserves totals, emoji, separators and Bookmarks, and supports exact grouped Undo/Redo');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/planner-project-colors-order.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (page && original) await page.evaluate(async state => { const c = app.plugins.plugins['thejaz-planner'].controller; c.settings = state.settings; await c.saveSettings(); document.body.className = state.body; c.emit(); }, original);
  await browser.close();
}
