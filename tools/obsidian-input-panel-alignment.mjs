import { assertTestVault } from './paths.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
let page, original;
try {
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page);
  original = await page.evaluate(() => ({ settings: structuredClone(app.plugins.plugins['thejaz-planner'].controller.settings), body: document.body.className }));
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false;
    const put = async (path, text) => { const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text); };
    await put('2012-01-01.md', '## plan for 1 jan 12\n### morning\n- [x] 09:00 (n/a) : awake\n- [ ] 09:30 (30) : chp\n### afternoon\n### evening\nCHP = 0\nSUM = 0\nKeep annotation.\n');
    await put('_Codes/🌞 Mixed Case Routine.md', '## plan for {{date}}\n### morning\n- [ ] 09:00 (n/a) : awake\nCHP = 0\nSUM = 0\n');
    c.settings.lastRoutine = '_Codes/🌞 Mixed Case Routine.md';
    await c.index(); await c.whenIdle();
    const v = await p.open(); await v.navigate('2012-01-01');
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
  });
  const notes = () => page.evaluate(async () => Object.fromEntries(await Promise.all(app.vault.getMarkdownFiles().map(async f => [f.path, await app.vault.read(f)]))));
  const before = await notes();
  for (const theme of ['theme-light', 'theme-dark']) {
    await page.evaluate(theme => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(theme); }, theme);
    for (const width of [1280, 650, 360]) {
      await page.setViewportSize({ width, height: 950 }); await page.waitForTimeout(250);
      await page.evaluate(() => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.date = '2099-08-01'; v.newDay(); });
      const form = page.locator('.planner-routine-form');
      const routine = form.getByRole('combobox', { name: 'Routine', exact: true });
      assert.equal(await routine.locator('option[value=""]').innerText(), '📄 blank day');
      assert.equal(await routine.inputValue(), '_Codes/🌞 Mixed Case Routine.md');
      assert.equal(await routine.locator('option:checked').innerText(), '🌞 Mixed Case Routine');
      const geometry = await page.evaluate(() => {
        const f = document.querySelector('.planner-routine-form'), r = f.getBoundingClientRect(), s = f.querySelector('select').getBoundingClientRect(), b = f.querySelector('.planner-dialog-buttons').getBoundingClientRect();
        return { left: s.left - r.left, right: r.right - s.right, gap: b.top - s.bottom, fits: f.scrollWidth <= f.clientWidth + 1 };
      });
      assert(Math.abs(geometry.left) < 1 && Math.abs(geometry.right) < 1 && geometry.gap >= 12 && geometry.fits, JSON.stringify(geometry));
      await page.screenshot({ path: `artifacts/input-panel-routine-${theme}-${width}.png` });
      await page.keyboard.press('Escape'); await form.waitFor({ state: 'detached' });
      await page.evaluate(async () => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; await v.navigate('2012-01-01'); });
      const row = page.locator('.planner-row[data-index="1"]');
      await row.locator('.planner-label').click(); await row.getByRole('button', { name: /^add below$/i }).click();
      const measure = () => page.evaluate(() => {
        const f = document.querySelector('.planner-capture.is-open'), row = document.querySelector('.planner-row:not([hidden])'), body = f.querySelector('.planner-capture-body');
        const r = row.getBoundingClientRect(), b = body.getBoundingClientRect(), p = f.getBoundingClientRect(), t = f.querySelector('textarea').getBoundingClientRect();
        const choices = [...f.querySelectorAll('.planner-capture-choice')].map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
        return { left: p.left - r.left, right: p.right - r.right, inputLeft: t.left - b.left, inputRight: t.right - b.right, fits: f.scrollWidth <= f.clientWidth + 1, choices };
      });
      let layout = await measure();
      assert(Math.abs(layout.left) < 1 && Math.abs(layout.right) < 1 && Math.abs(layout.inputLeft) < 1 && Math.abs(layout.inputRight) < 1 && layout.fits, JSON.stringify(layout));
      assert(layout.choices.every(c => Math.abs(c.w - layout.choices[0].w) < 1));
      if (width === 1280) assert(layout.choices.every(c => Math.abs(c.y - layout.choices[0].y) < 1));
      else assert(layout.choices.every(c => Math.abs(c.x - layout.choices[0].x) < 1));
      await page.screenshot({ path: `artifacts/input-panel-add-${theme}-${width}.png` });
      await page.getByRole('textbox', { name: 'Quick entry', exact: true }).press('Escape');
      await row.getByRole('button', { name: /^edit$/i }).click();
      layout = await measure();
      assert(Math.abs(layout.left) < 1 && Math.abs(layout.right) < 1 && Math.abs(layout.inputRight) < 1 && layout.fits, JSON.stringify(layout));
      await page.screenshot({ path: `artifacts/input-panel-edit-${theme}-${width}.png` });
      await page.locator('.planner-activity-editor').getByRole('button', { name: /^cancel$/i }).click();
    }
  }
  checks.push('📄 blank day is exact lowercase; existing routine selection and authored casing are retained');
  checks.push('Create-day selector spans its form, footer has clearance, and Cancel creates nothing');
  checks.push('Add/Edit panel edges match activity rows; textarea edges fit the body; three equal controls stack in narrow panes');
  checks.push('Light/dark at 1280/650/360px: no overflow; unchanged notes/templates after all cancellations');
  assert.deepEqual(await notes(), before); assert.deepEqual(errors, []);
  await writeFile('artifacts/input-panel-alignment.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (page && original) await page.evaluate(async original => { const c = app.plugins.plugins['thejaz-planner'].controller; Object.assign(c.settings, original.settings); await c.saveSettings(); document.body.className = original.body; }, original).catch(() => {});
  await browser.close();
}
