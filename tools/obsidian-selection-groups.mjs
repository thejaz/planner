import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { plannerUI } from './planner-ui.mjs';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await page.waitForFunction(() => typeof app !== 'undefined' && app.vault);
  await assertTestVault(page);
  const trust = page.getByRole('button', { name: 'Trust author and enable plugins', exact: true });
  if (await trust.count()) await trust.click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  await page.evaluate(() => app.setting.close());
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false; c.settings.summaryPath = 'Selection groups verification.md';
    c.settings.projectGroups = [
      { name: 'Business', projects: ['MDR'] }, { name: 'Academy', projects: ['CHP'] },
      { name: 'Hobbies', projects: ['HAY'] }, { name: 'Empty one', projects: [] }, { name: 'Empty two', projects: [] }
    ];
    const store = async (path, text) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (file) await app.vault.modify(file, text); else await app.vault.create(path, text);
    };
    await store('2013-01-01.md', '## plan for 1 jan 13\n### morning\n- [x] 09:00 (n/a) : awake\n- [x] 09:20 (20) : mdr\n- [x] 11:20 (120) : chp\n- [x] 12:20 (60) : hay\n- [x] 15:20 (180) : jib\n### afternoon\n- [ ] 16:00 (40) : buffer\nMDR = 20\nCHP = 120\nHAY = 60\nJIB = 180\nSUM = 380\nKeep this annotation.\n');
    await store('2013-01-02.md', '## plan for 2 jan 13\n### morning\n- [x] 10:00 (240) : mdr\n- [x] 10:10 (10) : chp\nMDR = 240\nCHP = 10\nSUM = 250\n');
    await store(c.settings.summaryPath, '### Days\n2013-01-01 = 380 🔥\n2013-01-02 = 250 ❄️\n### Projects\nMDR = 260\nCHP = 130\nHAY = 60\nJIB = 180\n### Results\nDays (2013-01-01 - 2013-01-02): 2d\n');
    await c.index(); const v = await p.open(); v.switchMode('day'); await v.navigate('2013-01-01');
  });
  const snapshot = () => page.evaluate(async () => Object.fromEntries(await Promise.all(app.vault.getMarkdownFiles().map(async file => [file.path, await app.vault.read(file)]))));
  const original = await snapshot();
  const groupsBefore = await page.evaluate(() => JSON.stringify(app.plugins.plugins['thejaz-planner'].controller.settings.projectGroups));
  const row = i => page.locator(`.planner-row[data-index="${i}"]`);
  await row(1).locator('.planner-label').click();
  await row(1).focus();
  for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowDown');
  assert.equal(await page.locator('.planner-row.is-selected').count(), 3);
  const clearStroke = async () => {
    const geometry = await page.locator('.planner-row:focus').evaluate(el => {
      const r = el.getBoundingClientRect(), style = getComputedStyle(el);
      const offset = parseFloat(style.outlineOffset), width = parseFloat(style.outlineWidth);
      const inside = [...el.querySelectorAll(':scope > .planner-time, :scope > .planner-duration, :scope > .planner-label')].map(child => {
        const b = child.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
      });
      const rows = [...el.parentElement.querySelectorAll('.planner-row')], index = rows.indexOf(el);
      const previous = rows[index - 1]?.getBoundingClientRect(), next = rows[index + 1]?.getBoundingClientRect();
      return { focused: el.matches(':focus-visible'), top: r.top, bottom: r.bottom, left: r.left, right: r.right, offset, width, inside,
        previousBottom: previous?.bottom, nextTop: next?.top };
    });
    assert(geometry.focused); assert(geometry.width >= 2); assert(geometry.offset <= -geometry.width);
    const strokeTop = geometry.top - geometry.offset, strokeBottom = geometry.bottom + geometry.offset;
    for (const text of geometry.inside) {
      assert(text.top >= strokeTop - 1, JSON.stringify(geometry));
      assert(text.bottom <= strokeBottom + 1, JSON.stringify(geometry));
      assert(text.left > geometry.left - geometry.offset, JSON.stringify(geometry));
    }
    if (geometry.previousBottom !== undefined) assert(geometry.previousBottom <= geometry.top + 1);
    if (geometry.nextTop !== undefined) assert(geometry.nextTop >= geometry.bottom - 1);
  };
  await clearStroke();
  await page.screenshot({ path: 'artifacts/selection-outline.png' });
  // Resizing can drop :focus-visible from the focused row; moving the range back and forth by keyboard restores it.
  await page.setViewportSize({ width: 740, height: 850 }); await page.keyboard.press('Shift+ArrowUp'); await page.keyboard.press('Shift+ArrowDown'); assert.equal(await page.locator('.planner-row.is-selected').count(), 3); await clearStroke();
  await page.screenshot({ path: 'artifacts/selection-outline-narrow.png' });
  checks.push('Keyboard-focused multi-selection outline stays within its own row and clears time/duration/activity and adjacent rows at normal/narrow widths');
  await page.setViewportSize({ width: 1024, height: 850 });
  const reviewRange = async (start, end, project = '') => page.evaluate(({ start, end, project }) => {
    const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
    v.preset = 'custom'; v.rangeStart = start; v.rangeEnd = end; v.project = project; v.switchMode('review'); v.draw();
  }, { start, end, project });
  const names = () => page.locator('.planner-group-total strong').allTextContents();
  await reviewRange('2013-01-01', '2013-01-01');
  assert.deepEqual(await names(), ['Unassigned', 'Academy', 'Hobbies', 'Business', 'Empty one', 'Empty two']);
  await page.screenshot({ path: 'artifacts/group-order.png' });
  await reviewRange('2013-01-02', '2013-01-02');
  assert.deepEqual(await names(), ['Business', 'Academy', 'Hobbies', 'Empty one', 'Empty two', 'Unassigned']);
  checks.push('Review sorts groups by total descending including Unassigned, updates with date range and retains configured order for ties');
  await page.getByRole('combobox', { name: 'Project filter', exact: true }).selectOption('JIB');
  assert.deepEqual(await names(), ['Unassigned']);
  await reviewRange('2013-01-01', '2013-01-02');
  assert.deepEqual((await names()).slice(0, 4), ['Business', 'Unassigned', 'Academy', 'Hobbies']);
  assert.equal(await page.evaluate(() => JSON.stringify(app.plugins.plugins['thejaz-planner'].controller.settings.projectGroups)), groupsBefore);
  assert.deepEqual(await snapshot(), original);
  checks.push('Project filtering remains correct; sorting changes neither configured group order nor any note bytes');
  assert.deepEqual(errors, []);
  const version = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].manifest.version);
  const report = { version, checks, errors };
  await writeFile('artifacts/selection-groups.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
