import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { plannerUI } from './planner-ui.mjs';
import { setCriteria } from './criteria-note.mjs';
const legend = /export const CANONICAL_LEGEND = `([\s\S]*?)`;/.exec(await readFile('src/core/marker-rules.ts', 'utf8'))[1];

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  await assertTestVault(page);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  page.on('pageerror', error => errors.push(error.message));
  // Eight non-formatting markers come from the canonical legend in thejaz-criteria.md.
  await setCriteria(page, legend);
  await page.evaluate(async () => { app.setting.close(); const p = app.plugins.plugins['thejaz-planner']; const v = await p.open(); v.switchMode('day'); await v.navigate('2014-01-01'); });
  const snapshot = () => page.evaluate(async () => Object.fromEntries(await Promise.all(app.vault.getMarkdownFiles().map(async f => [f.path, await app.vault.read(f)]))));
  const before = await snapshot();
  const icons = await page.locator('.planner-header .planner-icon').evaluateAll(buttons => buttons.map(button => {
    const b = button.getBoundingClientRect(), svg = button.querySelector('svg'), r = svg?.getBoundingClientRect();
    return { width: b.width, height: b.height, svgWidth: r?.width, svgHeight: r?.height,
      x: r ? Math.abs((r.left + r.right - b.left - b.right) / 2) : Infinity,
      y: r ? Math.abs((r.top + r.bottom - b.top - b.bottom) / 2) : Infinity,
      pseudo: getComputedStyle(button, '::after').content };
  }));
  assert.equal(icons.length, 3);
  for (const icon of icons) { assert.equal(icon.width, 32); assert.equal(icon.height, 32); assert.equal(icon.svgWidth, 16); assert.equal(icon.svgHeight, 16); assert(icon.x < 1 && icon.y < 1); assert(['none', 'normal'].includes(icon.pseudo)); }
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.planner-date-navigation input')?.value === '2014-01-02');
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.planner-date-navigation input')?.value === '2014-01-01');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.planner-date-navigation input')?.value === app.plugins.plugins['thejaz-planner'].controller.now().date);
  await page.getByRole('button', { name: 'Keyboard help', exact: true }).focus();
  await page.keyboard.press('Enter'); await page.locator('.modal').waitFor(); await page.keyboard.press('Escape');
  checks.push('Day header uses centered 16px native SVG icons in consistent 32px controls; previous/next/today and keyboard help work');
  await page.evaluate(async () => { await app.workspace.getLeavesOfType('thejaz-planner')[0].view.navigate('2014-01-01'); });
  await page.screenshot({ path: 'artifacts/header-layout.png' });
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  assert.equal(await page.locator('.planner-date-navigation').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Today', exact: true }).count(), 0);
  await page.evaluate(() => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.preset = 'custom'; v.rangeStart = '2010-01-01'; v.rangeEnd = '2010-01-05'; v.project = ''; v.draw(); });
  assert.equal(await page.locator('.planner-review-controls > *').count(), 4);
  const sections = await page.locator('.planner-review-main > .planner-review-section').evaluateAll(elements => elements.map(el => ({ width: getComputedStyle(el).borderTopWidth, style: getComputedStyle(el).borderTopStyle, color: getComputedStyle(el).borderTopColor, padding: getComputedStyle(el).paddingTop })));
  assert(sections.length >= 5); for (const section of sections) { assert.equal(section.width, '1px'); assert.equal(section.style, 'solid'); assert.equal(section.padding, '16px'); assert.equal(section.color, sections[0].color); }
  const markerSize = await page.locator('.planner-marker-counts').evaluate(el => parseFloat(getComputedStyle(el).fontSize) / parseFloat(getComputedStyle(el.closest('.planner')).fontSize));
  assert(markerSize >= .94);
  assert.equal(await page.locator('.planner-marker-count').count(), 8);
  for (const marker of await page.locator('.planner-marker-count').all()) {
    assert.equal(await marker.locator('.planner-marker-symbol').count(), 1);
    assert((await marker.locator('.planner-marker-label').innerText()).length > 0);
    assert(/^\d+$/.test(await marker.locator('.planner-marker-value').innerText()));
  }
  checks.push('Review hides day navigation, retains date/project controls, separates every section consistently and shows eight larger aligned emoji legends/counts');
  const originalClasses = await page.evaluate(() => document.body.className);
  for (const theme of ['theme-light', 'theme-dark']) {
    await page.evaluate(theme => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(theme); }, theme);
    await page.screenshot({ path: `artifacts/review-layout-${theme}.png` });
  }
  await page.evaluate(classes => { document.body.className = classes; }, originalClasses);
  await page.setViewportSize({ width: 740, height: 850 });
  const fit = async () => {
    for (const selector of ['.view-content.planner', '.planner-header', '.planner-review-controls', '.planner-marker-counts'])
      assert(await page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth + 1), selector);
  };
  await fit();
  const rows = await page.locator('.planner-review-controls').evaluate(el => [...el.children].map(child => Math.round(child.getBoundingClientRect().top)));
  assert.equal(rows[0], rows[1]); assert.equal(rows[2], rows[3]); assert(rows[2] > rows[0]);
  await page.screenshot({ path: 'artifacts/review-layout-narrow.png' });
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  assert.equal(await page.locator('.planner-date-navigation').count(), 1);
  await page.screenshot({ path: 'artifacts/header-layout-narrow.png' });
  assert(await page.locator('.view-content.planner').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.setViewportSize({ width: 1024, height: 850 });
  assert.deepEqual(await snapshot(), before); assert.deepEqual(errors, []);
  checks.push('Light/dark screenshots captured; narrow Review filters form two clean rows without overflow; returning to Day restores navigation; all Markdown bytes unchanged');
  const version = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].manifest.version);
  await writeFile('artifacts/review-layout.json', JSON.stringify({ version, checks, errors }, null, 2)); console.log(JSON.stringify({ version, checks, errors }, null, 2));
} finally { await browser.close(); }
