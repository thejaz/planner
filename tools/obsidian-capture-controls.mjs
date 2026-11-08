import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { chooseCapture } from './capture-choice.mjs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
let page, settings;
try {
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  page.on('pageerror', e => errors.push(e.message));
  settings = await page.evaluate(() => structuredClone(app.plugins.plugins['thejaz-planner'].controller.settings));
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller; c.settings.autoUpdate = false;
    const text = '## plan for 1 jan 21\n### morning\n- [x] 09:00 (n/a) : example start\n- [ ] 10:00 (60) : buffer\n\n### afternoon\n\n### evening\n\nCHP = 0\nSUM = 0\n';
    const path = '2021-01-01.md', f = app.vault.getAbstractFileByPath(path);
    if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    // A fresh view starts in Plan mode; earlier helpers may have chosen Log in the existing one.
    c.ingest(path, text); for (const leaf of app.workspace.getLeavesOfType('thejaz-planner')) leaf.detach();
    // Obsidian replaces a closed last tab asynchronously; open only once a tab group exists again.
    await new Promise(r => setTimeout(r, 300)); if (!app.workspace.getMostRecentLeaf(app.workspace.rootSplit)) app.workspace.getLeaf(true);
    const v = await p.open(); v.mode = 'day'; await v.navigate('2021-01-01'); v.focusEntry();
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  const mode = page.getByRole('button', { name: 'Entry mode', exact: true });
  assert.equal(await mode.getAttribute('data-value'), 'plan');
  assert.equal(await page.locator('.planner-capture select').count(), 0);
  assert.equal(await page.locator('.planner-capture-choice').count(), 2);
  assert.equal(await page.locator('[data-planner-choice=placement]').count(), 0);
  assert.equal(await page.locator('.planner-capture-choice svg').count(), 4);
  const quick = page.getByRole('textbox', { name: 'Quick entry', exact: true });
  await quick.fill('09:30 30 chp');
  assert((await page.locator('.planner-preview').innerText()).includes('- [ ] 09:30 (30) : chp'));
  checks.push('Fresh composer defaults to Plan; two bordered icon/chevron buttons replace OS dropdowns and preview unchecked entries');
  await mode.focus(); await mode.press('ArrowDown');
  assert.equal(await mode.getAttribute('aria-expanded'), 'true');
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowDown');
    if ((await page.locator('.planner-choice-menu-item.is-selected').allTextContents()).some(t => t.includes('Log completed work'))) break;
  }
  await page.keyboard.press('Enter');
  assert.equal(await mode.getAttribute('data-value'), 'log');
  assert((await page.locator('.planner-preview').innerText()).includes('- [x] 09:30 (30) : chp'));
  checks.push('Accessible themed menu supports keyboard navigation and explicit Log changes the preview to completed work');
  await chooseCapture(page, 'Entry mode', 'plan');
  await page.locator('.planner-row').nth(1).focus();
  // Selecting a row collapses the composer but keeps its draft.
  assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.draft), '09:30 30 chp');
  await page.locator('.planner-capture-toggle').click(); assert.equal(await quick.inputValue(), '09:30 30 chp');
  await chooseCapture(page, 'Section for new activity', 'evening');
  assert.equal(await page.locator('.planner-capture').evaluate(el => el.closest('.planner-section').dataset.plannerSection), 'evening');
  assert.equal(await quick.inputValue(), '09:30 30 chp');
  checks.push('Section menus preserve the draft and move the inline editor to its actual destination');
  await page.locator('.planner-row').first().focus(); await page.locator('.planner-capture-toggle').click();
  assert.equal(await page.getByRole('button', { name: 'Section for new activity', exact: true }).getAttribute('data-value'), 'morning');
  await page.evaluate(async () => { await app.workspace.getLeavesOfType('thejaz-planner')[0].view.refresh(); });
  assert.equal(await mode.getAttribute('data-value'), 'plan');
  await quick.press('Enter'); // Enter adds; Ctrl+Enter starts another line.
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2021-01-01.md').entries.length === 3);
  const saved = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.days.get('2021-01-01.md').text);
  assert(saved.includes('- [ ] 09:30 (30) : chp'));
  checks.push('Selected-row changes synchronize the section label, refresh retains Plan, and submission saves an unchecked plan');
  assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.getViewType()), 'thejaz-planner');
  // Let the save finish its re-render before reopening the composer.
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  const close = page.getByRole('button', { name: 'Collapse activity editor', exact: true });
  const geometry = await close.evaluate(el => {
    const r = el.getBoundingClientRect(), icon = el.querySelector('svg').getBoundingClientRect();
    return { width: r.width, height: r.height, dx: (icon.left + icon.width / 2) - (r.left + r.width / 2), dy: (icon.top + icon.height / 2) - (r.top + r.height / 2) };
  });
  assert.equal(geometry.width, 28); assert.equal(geometry.height, 28); assert(Math.abs(geometry.dx) < .5 && Math.abs(geometry.dy) < .5);
  const originalTheme = await page.evaluate(() => document.body.className);
  await page.setViewportSize({ width: 1280, height: 950 });
  await page.evaluate(async () => {
    for (const leaf of app.workspace.getLeavesOfType('markdown')) leaf.detach();
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    const view = await app.plugins.plugins['thejaz-planner'].open(); view.focusEntry();
  });
  await page.waitForFunction(() => {
    const controls = [...document.querySelectorAll('.planner-capture-choice')];
    return controls.length === 2 && controls.every(el => el.getBoundingClientRect().width > 150 && el.getBoundingClientRect().height > 20) && Math.abs(controls[0].getBoundingClientRect().top - controls[1].getBoundingClientRect().top) < 1;
  });
  checks.push('Two remaining controls align side by side in a wide editor');
  for (const theme of ['theme-light', 'theme-dark']) {
    await page.evaluate(theme => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(theme); }, theme);
    await page.evaluate(async () => { const view = await app.plugins.plugins['thejaz-planner'].open(); view.focusEntry(); });
    assert(await page.locator('.planner-capture-choice').evaluateAll(es => es.every(e => getComputedStyle(e).borderTopWidth === '1px' && parseFloat(getComputedStyle(e).height) >= 34)));
    await page.locator('.planner-capture').screenshot({ path: `artifacts/planner-capture-controls-${theme}.png` });
  }
  await mode.click(); await page.screenshot({ path: 'artifacts/planner-capture-controls-menu.png' }); await page.keyboard.press('Escape');
  await page.waitForFunction(() => app.workspace.activeLeaf.view.getViewType() === 'thejaz-planner');
  assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.getViewType()), 'thejaz-planner');
  await page.locator('.planner-shell').evaluate(el => { el.style.width = '300px'; el.style.maxWidth = '100%'; });
  assert(await page.locator('.planner-capture-options').evaluate(el => [...el.children].every(c => c.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1)));
  await page.locator('.planner-capture').screenshot({ path: 'artifacts/planner-capture-controls-narrow.png' });
  await page.locator('.planner-shell').evaluate(el => { el.style.removeProperty('width'); el.style.removeProperty('max-width'); });
  await page.evaluate(theme => { document.body.className = theme; }, originalTheme);
  checks.push('Icons and centered close button render in both themes; option controls wrap within a 300px column');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/planner-capture-controls.json', JSON.stringify({ checks, errors, geometry }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (page && settings) await page.evaluate(async value => { const c = app.plugins.plugins['thejaz-planner'].controller; c.settings = value; await c.saveSettings(); }, settings);
  await browser.close();
}
