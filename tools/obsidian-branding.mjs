import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const selectedSvg = await readFile('src/assets/thejaz-sun.svg', 'utf8');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await page.waitForFunction(() => typeof app !== 'undefined' && app.vault);
  await assertTestVault(page);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  await page.evaluate(() => app.setting.close());
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const snapshotNotes = () => page.evaluate(async () => Object.fromEntries(await Promise.all(
    app.vault.getMarkdownFiles().map(async file => [file.path, await app.vault.read(file)]))));
  const notesBefore = await snapshotNotes();
  const state = await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], v = await p.open();
    return { name: p.manifest.name, author: p.manifest.author, url: p.manifest.authorUrl,
      version: p.manifest.version, title: v.getDisplayText(), icon: v.getIcon(),
      command: app.commands.commands['thejaz-planner:open'].name };
  });
  assert.equal(state.name, 'THEJAZ Planner'); assert.equal(state.title, state.name);
  assert.equal(state.author, 'THEJAZ'); assert.equal(state.url, 'https://github.com/thejaz/');
  assert.equal(state.command, 'THEJAZ Planner: Open planner');
  assert.equal(state.icon, 'thejaz-sun');
  const ribbon = page.locator('.side-dock-ribbon-action[aria-label="Open THEJAZ Planner"]');
  assert.equal(await ribbon.count(), 1); assert.equal(await ribbon.locator('svg path').count(), 2);
  assert(await ribbon.locator('svg').evaluate(el => el.getBoundingClientRect().width > 0));
  const tab = page.locator('.workspace-tab-header').filter({ hasText: 'THEJAZ Planner' });
  assert.equal(await tab.count(), 1); assert.equal(await tab.locator('.workspace-tab-header-inner-icon svg path').count(), 2);
  const icons = [ribbon.locator('svg'), tab.locator('.workspace-tab-header-inner-icon svg')];
  const geometry = [];
  for (const icon of icons) {
    const result = await icon.evaluate((svg, selected) => {
      const source = new DOMParser().parseFromString(selected, 'image/svg+xml').documentElement;
      const shapes = element => [...element.querySelectorAll('path,circle')].map(el => ({ tag: el.localName,
        attrs: Object.fromEntries([...el.attributes].map(a => [a.name, a.value])) }));
      const bbox = svg.getBBox(), viewBox = svg.viewBox.baseVal;
      return { matchesSelectedShapes: JSON.stringify(shapes(source)) === JSON.stringify(shapes(svg)),
        circleCount: svg.querySelectorAll('circle').length, viewBox: [viewBox.x, viewBox.y, viewBox.width, viewBox.height],
        center: [bbox.x + bbox.width / 2, bbox.y + bbox.height / 2],
        bounds: [bbox.x, bbox.y, bbox.width, bbox.height] };
    }, selectedSvg);
    assert(result.matchesSelectedShapes, 'Installed shapes differ from the selected SVG');
    assert.equal(result.circleCount, 3); assert.deepEqual(result.viewBox, [0, 0, 100, 100]);
    assert(result.center.every(c => Math.abs(c - 50) < .01), 'Icon is not centered');
    assert(result.bounds[0] > 3 && result.bounds[1] > 3 && result.bounds[0] + result.bounds[2] < 97 && result.bounds[1] + result.bounds[3] < 97);
    geometry.push(result);
    for (const size of [16, 20, 24]) {
      const measured = await icon.evaluate((svg, size) => {
        const original = svg.getAttribute('style'); svg.style.width = `${size}px`; svg.style.height = `${size}px`;
        const rect = svg.getBoundingClientRect();
        if (original === null) svg.removeAttribute('style'); else svg.setAttribute('style', original);
        return { width: rect.width, height: rect.height };
      }, size);
      assert(Math.abs(measured.width - size) < .01 && Math.abs(measured.height - size) < .01);
    }
  }
  const originalClasses = await page.locator('body').getAttribute('class'), themeColors = [];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(`theme-${theme}`); }, theme);
    const colors = await ribbon.locator('svg').evaluate(svg => ({
      stroke: getComputedStyle(svg.querySelector('path')).stroke,
      eye: getComputedStyle(svg.querySelectorAll('circle')[1]).fill,
      fill: getComputedStyle(svg.querySelector('path')).fill
    }));
    assert.equal(colors.stroke, colors.eye); assert.equal(colors.fill, 'none');
    assert(!['none', 'rgba(0, 0, 0, 0)'].includes(colors.stroke)); themeColors.push({ theme, ...colors });
    await page.screenshot({ path: `artifacts/branding-${theme}.png` });
  }
  assert.notEqual(themeColors[0].stroke, themeColors[1].stroke);
  await page.locator('body').evaluate((body, classes) => body.setAttribute('class', classes), originalClasses);
  await page.screenshot({ path: 'artifacts/branding-tab.png' });
  await page.evaluate(() => { app.setting.open(); app.setting.openTabById('thejaz-planner'); });
  const settingsPage = browser.contexts().flatMap(c => c.pages()).find(p => p !== page && p.url() === 'about:blank') ?? page;
  const settings = settingsPage.locator('.vertical-tab-content');
  await settings.getByRole('heading', { name: 'Daily setup', exact: true }).waitFor();
  assert.equal(await settings.getByRole('heading', { name: 'THEJAZ Planner', exact: true }).count(), 0, 'Settings repeat the plugin name as a heading');
  assert.equal(await settings.getByRole('link', { name: 'THEJAZ', exact: true }).getAttribute('href'), state.url);
  await settingsPage.screenshot({ path: 'artifacts/branding-settings.png' });
  await page.evaluate(() => app.setting.close());
  assert.deepEqual(await snapshotNotes(), notesBefore, 'Opening the branded planner changed notes');
  assert.deepEqual(errors, []);
  const report = { state, errors, geometry, themeColors, sourceSha256: createHash('sha256').update(selectedSvg).digest('hex'), unchangedNotes: Object.keys(notesBefore).length,
    checks: ['Manifest and command branding', 'Selected sun SVG renders in ribbon and tab',
      'Exact selected paths and circles, centered on the 100-unit canvas with safe padding',
      '16/20/24px sizing and theme-aware strokes/eyes in light and dark modes',
      'Settings creator credit and link', 'All synthetic notes unchanged'] };
  await writeFile('artifacts/branding.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
