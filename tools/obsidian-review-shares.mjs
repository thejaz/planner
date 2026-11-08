import { assertTestVault } from './paths.mjs';
import { setCriteria } from './criteria-note.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
let page;
try {
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page); await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  await page.evaluate(() => { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); });
  page.on('pageerror', e => errors.push(e.message));
  const legend = /export const CANONICAL_LEGEND = `([\s\S]*?)`;/.exec(await readFile('src/core/marker-rules.ts', 'utf8'))[1];
  await setCriteria(page, legend);
  await page.evaluate(async () => {
    app.setting.close(); const plugin = app.plugins.plugins['thejaz-planner'], c = plugin.controller;
    c.__shareOriginal = { settings: structuredClone(c.settings), now: c.now };
    c.settings.autoUpdate = false; c.settings.summaryPath = 'thejaz-summary-shares-native.md';
    c.settings.projectCodes = [...new Set([...c.settings.projectCodes, 'AAA', 'BBB', 'CCC'])];
    c.settings.projectGroups = [{ name: 'Philosophy', projects: ['AAA', 'CCC'] }, { name: 'Business', projects: ['BBB'] }];
    c.settings.showMarkerCounts = true;
    const put = async (path, text) => { const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text); };
    await put('2001-01-01.md', '## recorded totals\nAAA = 30\nBBB = 70\nSUM = 100\n');
    await put('2001-01-02.md', '## recorded totals\nBBB = 99\nCCC = 1\nSUM = 100\n');
    await put('2001-01-03.md', '## recorded totals\nSUM = 0\n');
    await put(c.settings.summaryPath, '### Days\n2001-01-01 = 100 🕶️🦥\n2001-01-02 = 100 ☁️🦥\n2001-01-03 = 0 😣\n2001-01-04 = ?\n### Projects\nAAA = 30\nBBB = 169\nCCC = 1\n### Results\nDays (2001-01-01 - 2001-01-04): 4d\n');
    await c.index(); await c.whenIdle();
    // Restrict only the test's in-memory index so every preset has a known oracle.
    for (const [path] of c.days) if (!['2001-01-01.md', '2001-01-02.md', '2001-01-03.md'].includes(path)) c.days.delete(path);
    for (const [path] of c.summaries) if (path !== c.settings.summaryPath) c.summaries.delete(path);
    const clock = c.now(); c.now = () => ({ ...clock, date: '2001-01-04' });
    const v = await plugin.open(); v.project = ''; v.preset = 'period'; v.switchMode('review');
  });
  const snapshot = () => page.evaluate(async () => Object.fromEntries(await Promise.all(app.vault.getMarkdownFiles().map(async f => [f.path, await app.vault.read(f)]))));
  const before = await snapshot();
  const group = name => page.locator('.planner-group-total').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
  const chip = code => page.locator('.planner-project-totals .planner-project-chip').filter({ has: page.locator('strong', { hasText: new RegExp(`^${code}$`) }) });
  const share = async item => {
    const text = await item.locator('.planner-share').innerText();
    assert(/^\([^()]+%\)$/.test(text), `Percentage must be parenthesized: ${text}`);
    return text.slice(1, -1);
  };
  const marker = key => page.locator(`.planner-marker-count[data-marker="${key}"]`);
  for (const period of ['period', 'all', '7days', '30days', '6months', '12months']) {
    await page.getByRole('combobox', { name: 'Review period', exact: true }).selectOption(period);
    assert.equal(await share(group('Philosophy')), '15.5%'); assert.equal(await share(group('Business')), '84.5%');
    assert.equal(await share(chip('AAA')), '15%'); assert.equal(await share(chip('BBB')), '84.5%'); assert.equal(await share(chip('CCC')), '0.5%');
    assert.equal(await share(marker('🦥')), '50%'); assert.equal(await share(marker('🕶')), '25%'); assert.equal(await share(marker('☁')), '25%');
  }
  checks.push('All six period presets use selected work minutes for group/project shares and unique covered summary dates for marker shares');
  await page.getByRole('combobox', { name: 'Project filter', exact: true }).selectOption('AAA');
  assert.equal(await share(chip('AAA')), '100%'); assert.equal(await share(group('Philosophy')), '100%');
  assert.equal(await share(marker('🦥')), '50%'); assert.equal(await share(marker('🕶')), '25%');
  checks.push('Project filtering recomputes work shares but leaves independent day/context shares unchanged');
  await page.getByRole('combobox', { name: 'Project filter', exact: true }).selectOption('');
  const range = async (start, end) => page.evaluate(({ start, end }) => { const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; v.preset = 'custom'; v.rangeStart = start; v.rangeEnd = end; v.draw(); }, { start, end });
  await range('2001-01-02', '2001-01-02');
  assert.equal(await share(chip('BBB')), '99%'); assert.equal(await share(chip('CCC')), '1%'); assert.equal(await share(group('Philosophy')), '1%');
  assert.equal(await share(marker('🦥')), '100%'); assert.equal(await share(marker('☁')), '100%');
  checks.push('Custom dates recalculate each denominator; overlapping context/earned labels may both be 100%');
  await range('2001-02-01', '2001-02-02');
  assert((await page.locator('.planner-group-total .planner-share').allTextContents()).every(t => t === '—'));
  assert((await page.locator('.planner-marker-count .planner-share').allTextContents()).every(t => t === '—'));
  checks.push('An empty/unknown-total range shows unavailable shares, never NaN, Infinity or fabricated zero percentages');
  await range('2001-01-01', '2001-01-04');
  const rankedMarkers = await page.locator('.planner-marker-count').evaluateAll(items => items.map(item => ({ key: item.dataset.marker,
    rank: item.querySelector('.planner-marker-rank').textContent, count: Number(item.querySelector('.planner-marker-value').textContent) })));
  assert.deepEqual(rankedMarkers.map(item => item.rank), rankedMarkers.map((_, index) => `${index + 1}.`));
  const legendOrder = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.criteria().definitions.filter(d => !d.formatting).map(d => d.key));
  for (let i = 1; i < rankedMarkers.length; i++) {
    const a = rankedMarkers[i - 1], b = rankedMarkers[i];
    assert(a.count >= b.count, 'Markers rank by recorded days');
    if (a.count === b.count) assert(legendOrder.indexOf(a.key) < legendOrder.indexOf(b.key), 'Ties retain legend order');
  }
  checks.push('Day markers have sequential ranks, descend by recorded count and keep legend order for ties');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // Resolve and measure in one browser task: a native redraw can detach a locator's element between these steps.
  const styling = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.planner-ranked-projects .planner-project-chip')].find(chip => chip.querySelector('strong')?.textContent === 'AAA').querySelector('.planner-share');
    return { color: getComputedStyle(el).color, size: parseFloat(getComputedStyle(el).fontSize), parentSize: parseFloat(getComputedStyle(el.parentElement).fontSize), weight: getComputedStyle(el).fontWeight, title: el.title };
  });
  assert(styling.size < styling.parentSize && styling.weight === '400', JSON.stringify(styling)); assert.equal(styling.title, '');
  for (const theme of ['theme-light', 'theme-dark']) {
    await page.evaluate(theme => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(theme); }, theme);
    for (const width of [1280, 650, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      for (const selector of ['.planner-group-totals', '.planner-project-totals', '.planner-marker-counts']) assert(await page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      const layout = await page.locator('.planner-marker-count').evaluateAll(items => items.map(item => {
        const rect = item.getBoundingClientRect();
        const count = item.querySelector('.planner-marker-value').getBoundingClientRect(), share = item.querySelector('.planner-share').getBoundingClientRect();
        return { x: rect.x, y: rect.y, w: rect.width, countRight: count.right - rect.x, shareRight: share.right - rect.x, fits: item.scrollWidth <= item.clientWidth + 1 };
      }));
      const markerColumns = new Set(layout.map(item => Math.round(item.x))).size;
      assert(markerColumns <= 2 && (width !== 1280 || markerColumns === 2), 'Day markers use at most two columns');
      const weekendLines = await marker('😎').locator('.planner-marker-label').evaluate(el => {
        const range = document.createRange(); range.selectNodeContents(el); return range.getClientRects().length;
      });
      assert.equal(weekendLines, 1, 'no-pro weekends stays on one line');
      for (let i = 0; i < layout.length; i++) {
        const item = layout[i], previous = layout[i - 1];
        assert(item.fits && Math.abs(item.w - layout[0].w) < 1, 'Equal marker widths without overflow');
        assert(Math.abs(item.countRight - layout[0].countRight) < 1 && Math.abs(item.shareRight - layout[0].shareRight) < 1, 'Marker counts and shares align');
        if (previous) {
          if (Math.abs(item.x - previous.x) < 1) assert(item.y > previous.y, 'Markers read down a column');
          else assert(item.x > previous.x && Math.abs(item.y - layout[0].y) < 1, 'Markers continue at the top of the next column');
        }
      }
      await page.locator('.planner-review-overview').scrollIntoViewIfNeeded(); await page.screenshot({ path: `artifacts/review-shares-${theme}-${width}.png` });
    }
  }
  checks.push('Percentages are smaller, muted and normal-weight without added numeric tooltips; light/dark and narrow layouts do not overflow');
  checks.push('Day markers read down then across in at most two columns; no-pro weekends stays on one line and numeric fields align at 1280, 650 and 360px in light/dark');
  assert.deepEqual(await snapshot(), before);
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller, file = app.vault.getAbstractFileByPath(c.settings.summaryPath);
    const text = (await app.vault.read(file)).replace('2001-01-04 = ?', '2001-01-04 = 100 🦥');
    await app.vault.modify(file, text); c.ingest(file.path, text);
    app.workspace.getLeavesOfType('thejaz-planner')[0].view.draw();
  });
  assert.equal(await share(chip('AAA')), '10%'); assert.equal(await share(group('Philosophy')), '10.3%');
  checks.push('Aggregate-only work stays in the denominator; unknown project allocation is not falsely normalized away');
  assert.deepEqual(errors, []); await writeFile('artifacts/review-shares-native.json', JSON.stringify({ checks, errors, styling }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (page) await page.evaluate(async () => { const c = app.plugins.plugins['thejaz-planner']?.controller; if (c?.__shareOriginal) { c.now = c.__shareOriginal.now; Object.assign(c.settings, c.__shareOriginal.settings); delete c.__shareOriginal; await c.saveSettings(); await c.index(); } }).catch(() => {});
  await browser.close();
}
