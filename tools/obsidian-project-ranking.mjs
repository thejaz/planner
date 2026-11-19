import { assertTestVault } from './paths.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], layouts = [];
let page, original;
try {
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page);
  page.on('pageerror', error => errors.push(error.message));
  original = await page.evaluate(() => ({ settings: structuredClone(app.plugins.plugins['thejaz-planner'].controller.settings), body: document.body.className }));
  const projects = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`QA${String.fromCharCode(65 + i)}`, i < 2 ? 141000 : 10000 - i * 500]));
  await page.evaluate(async projects => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false; c.settings.projectCodes = Object.keys(projects);
    c.settings.projectEmojis = Object.fromEntries(Object.keys(projects).map(code => [code, '🎷']));
    c.settings.projectGroups = []; c.settings.showMarkerCounts = false;
    c.settings.summaryPath = 'thejaz-summary-ranking-native.md';
    await c.saveSettings();
    const total = Object.values(projects).reduce((a, b) => a + b, 0);
    const rows = Object.entries(projects).map(([code, minutes]) => `${code} = ${minutes}`).join('\n');
    for (const [path, text] of [
      ['2002-01-01.md', `## recorded totals\n${rows}\nSUM = ${total}\n`],
      [c.settings.summaryPath, `### Days (2002-01-01 - 2002-01-01)\n2002-01-01 = ${total}\n### Projects\n${rows}\n`]
    ]) {
      const f = app.vault.getAbstractFileByPath(path);
      if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    }
    await c.index(); await c.whenIdle();
    const v = await p.open(); v.project = ''; v.preset = 'custom'; v.rangeStart = v.rangeEnd = '2002-01-01'; v.switchMode('review');
    // Render an intentionally unassigned emoji without changing persisted registry state.
    const emojis = c.settings.projectEmojis;
    c.settings.projectEmojis = { ...emojis, QAA: undefined }; v.draw(); c.settings.projectEmojis = emojis;
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
  }, projects);
  const notes = () => page.evaluate(async () => Object.fromEntries(await Promise.all(app.vault.getMarkdownFiles().map(async f => [f.path, await app.vault.read(f)]))));
  const before = await notes();
  const grid = page.locator('.planner-ranked-projects');
  const chips = grid.locator('.planner-project-chip');
  assert.equal(await chips.count(), 18);
  assert.deepEqual(await chips.locator('.planner-project-rank').allTextContents(), Array.from({ length: 18 }, (_, i) => `${i + 1}.`));
  const order = await chips.locator('strong').allTextContents();
  assert(order.every((code, i) => !i || projects[order[i - 1]] >= projects[code]));
  assert.equal(await chips.first().locator('.planner-project-rank').evaluate(el => document.getElementById(el.getAttribute('aria-labelledby'))?.textContent), 'Rank 1');
  assert.equal(await chips.first().locator('.planner-project-emoji').count(), 1);
  assert.equal(await chips.first().locator('.planner-project-emoji').textContent(), '');
  checks.push('Ranks 1-18 follow descending totals, include accessible rank labels and reserve emoji alignment for unassigned projects');

  for (const theme of ['theme-light', 'theme-dark']) {
    await page.evaluate(theme => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(theme); }, theme);
    for (const width of [1280, 800, 650, 500, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(250); // Let native pane resize animations settle before measuring columns.
      // Resolve and measure in one task; redraws can detach a previously resolved locator.
      const layout = await page.evaluate(() => {
        const el = document.querySelector('.planner-ranked-projects');
        const box = el.getBoundingClientRect();
        const rows = [...el.querySelectorAll('.planner-project-chip')].map(chip => {
          const rect = chip.getBoundingClientRect();
          return { x: rect.x, y: rect.y, w: rect.width, right: rect.right, fits: chip.scrollWidth <= chip.clientWidth + 1,
            fields: [...chip.children].map(field => { const r = field.getBoundingClientRect(); return { x: r.x - rect.x, right: r.right - rect.x }; }),
            background: getComputedStyle(chip).backgroundColor };
        });
        return { fits: el.scrollWidth <= el.clientWidth + 1, columns: new Set(rows.map(row => Math.round(row.x))).size, rows, left: box.left, right: box.right };
      });
      assert(layout.rows.length === 18 && layout.right > layout.left, 'Measure the visible current project list');
      assert(layout.fits && layout.rows.every(row => row.fits && row.x >= layout.left - 1 && row.right <= layout.right + 1), `${theme} ${width}: no overflow`);
      for (let i = 1; i < layout.rows.length; i++) {
        const previous = layout.rows[i - 1], current = layout.rows[i];
        if (Math.abs(current.x - previous.x) < 1) assert(current.y > previous.y, `Ranks advance down the column: ${JSON.stringify({ theme, width, previous, current })}`);
        else assert(current.x > previous.x && Math.abs(current.y - layout.rows[0].y) < 1, 'Next rank starts at the top of the next column');
      }
      for (const row of layout.rows) {
        assert(Math.abs(row.w - layout.rows[0].w) < 1, 'Equal-width chips');
        assert.notEqual(row.background, 'rgba(0, 0, 0, 0)', 'Keep project colours');
        // Code/emoji/rank starts and the time/percentage right edges line up even across two-digit ranks.
        for (const index of [0, 1, 2]) assert(Math.abs(row.fields[index].x - layout.rows[0].fields[index].x) < 1, 'Aligned leading fields');
        for (const index of [3, 4]) assert(Math.abs(row.fields[index].right - layout.rows[0].fields[index].right) < 1, 'Aligned numeric fields');
      }
      layouts.push({ theme, width, columns: layout.columns });
      await page.evaluate(() => document.querySelector('.planner-ranked-projects').scrollIntoView({ block: 'nearest' }));
      await page.screenshot({ path: `artifacts/project-ranking-${theme}-${width}.png` });
    }
  }
  assert(layouts[0].columns > 1 && layouts.find(l => l.width === 360).columns === 1, JSON.stringify(layouts));
  checks.push('Light/dark at 1280, 800, 650, 500 and 360px: ranks read down then across, responsive columns, equal widths, aligned fields, preserved colours and no overflow');
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.draw());
  assert.deepEqual(await chips.locator('strong').allTextContents(), order);
  checks.push('Tied totals retain their order after redraw');
  await page.getByRole('combobox', { name: 'Project filter', exact: true }).selectOption('QAB');
  assert.equal(await chips.count(), 1);
  assert.equal(await chips.locator('.planner-project-rank').innerText(), '1.');
  assert.equal(await chips.locator('.planner-share').innerText(), '(100%)');
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'];
    p.controller.settings.projectEmojis = (await p.loadData()).projectEmojis;
  });
  await chips.first().click();
  await page.locator('.modal').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.modal').waitFor({ state: 'detached' });
  checks.push('Filtering recomputes rank and percentage; project management still opens from the chip');
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.switchMode('day'));
  assert.equal(await page.locator('.planner-project-rank').count(), 0);
  assert.deepEqual(await notes(), before);
  assert.deepEqual(errors, []);
  checks.push('Activity chips remain compact/unranked; all test notes stay byte-identical and no browser errors occur');
  await writeFile('artifacts/project-ranking-native.json', JSON.stringify({ checks, layouts, errors }, null, 2));
  console.log(JSON.stringify({ checks, layouts, errors }, null, 2));
} finally {
  if (page && original) await page.evaluate(async original => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    Object.assign(c.settings, original.settings); await c.saveSettings(); document.body.className = original.body;
  }, original).catch(() => {});
  await browser.close();
}
