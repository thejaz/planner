import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
let page, appPage, original;
try {
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page); appPage = page; await assertTestVault(page);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed && !app.plugins.plugins['thejaz-planner'].controller.indexing);
  page.on('pageerror', e => errors.push(e.message));
  original = await appPage.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    return { settings: structuredClone(c.settings), journal: structuredClone(c.journal.data), notes: Object.fromEntries(await Promise.all(['2007-01-01.md', 'thejaz-summary-settings-native.md'].map(async path => [path, await c.port.read(path)]))) };
  });
  await appPage.evaluate(async () => { const c = app.plugins.plugins['thejaz-planner'].controller; c.settings.autoUpdate = false; await c.whenIdle(); app.setting.open(); app.setting.openTabById('thejaz-planner'); });
  for (const candidate of browser.contexts().flatMap(c => c.pages())) if (await candidate.locator('.planner-settings').count()) page = candidate;
  if (page !== appPage) page.on('pageerror', e => errors.push(e.message));
  const settings = page.locator('.planner-settings'), modal = page.locator('.modal:has(.planner-action-result)');
  await settings.locator('.planner-settings-section > .setting-item-heading').first().waitFor({ state: 'visible' });
  const close = async () => { await modal.getByRole('button', { name: 'Close', exact: true }).click(); await modal.waitFor({ state: 'detached' }); };
  assert.deepEqual(await settings.locator('.planner-settings-section > .setting-item-heading').allTextContents(), ['Daily setup', 'Activity entry', 'Reports & markers', 'Projects & groups', 'Maintenance & recovery']);
  await settings.locator('.planner-settings-nav').getByRole('link', { name: 'Projects & groups', exact: true }).click();
  assert.equal(await settings.locator('.planner-settings-section > .setting-item-heading').filter({ hasText: 'Projects & groups' }).evaluate(el => el === el.ownerDocument.activeElement), true);
  checks.push('Five clear settings sections; navigation scrolls and moves keyboard focus to the selected heading');
  const rebuild = settings.getByRole('button', { name: 'Rebuild index', exact: true });
  assert.equal(await rebuild.getAttribute('title'), null);
  assert.equal(await settings.getByRole('button', { name: 'Save entry defaults', exact: true }).getAttribute('title'), null);
  assert.equal(await settings.locator('.planner-settings-nav [title]').count(), 0);
  assert.match(await settings.getByRole('button', { name: 'Sync summaries', exact: true }).getAttribute('title'), /missing project definitions/);
  assert.equal(await rebuild.getAttribute('aria-label'), null);
  checks.push('Hover help is limited to ambiguous actions and icons; obvious buttons and navigation do not repeat their labels');
  const snapshot = () => appPage.evaluate(async () => Object.fromEntries(await Promise.all(app.vault.getMarkdownFiles().map(async f => [f.path, await app.vault.read(f)]))));
  const before = await snapshot();
  await rebuild.click(); await modal.getByText('Index rebuilt.', { exact: true }).waitFor();
  assert.match(await modal.innerText(), /daily notes and \d+ summaries are indexed/);
  assert.match(await modal.innerText(), /Read \d+ notes; reused \d+ unchanged cached records/);
  assert.deepEqual(await snapshot(), before);
  if (page !== appPage) assert.equal(await appPage.locator('.planner-action-result').count(), 0);
  await modal.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Tab'); assert(await modal.evaluate(el => el.contains(el.ownerDocument.activeElement)));
  await page.keyboard.press('Shift+Tab'); assert(await modal.evaluate(el => el.contains(el.ownerDocument.activeElement)));
  await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });
  assert(await settings.isVisible()); assert(await rebuild.evaluate(el => el === el.ownerDocument.activeElement));
  checks.push('Rebuild displays completion, indexed counts and disk/cache details without changing Markdown');
  checks.push('Result stays in the Settings window; Tab remains inside and Escape closes only the result, returning focus');
  await appPage.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.indexing = true; });
  await rebuild.click(); await modal.getByText('Planner is already reading your notes.', { exact: true }).waitFor(); await close();
  await appPage.evaluate(() => { app.plugins.plugins['thejaz-planner'].controller.indexing = false; });
  checks.push('A busy index explains that no extra rebuild was started');
  await appPage.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.__index = c.index; c.index = async () => { c.issues.set('index', 'Synthetic read failure'); }; });
  await rebuild.click(); await modal.getByRole('alert').filter({ hasText: 'Synthetic read failure' }).waitFor();
  assert(!(await modal.innerText()).includes('Index rebuilt.')); await close();
  await appPage.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.index = c.__index; delete c.__index; c.issues.delete('index'); });
  checks.push('A swallowed index failure is shown as a failed result, never as a successful rebuild');
  await appPage.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.__index = c.index; c.index = async () => { await new Promise(resolve => { c.__releaseIndex = resolve; }); await c.__index.call(c); }; });
  await rebuild.click(); await modal.getByText('Working…', { exact: true }).waitFor(); assert(await rebuild.isDisabled());
  await appPage.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.__releaseIndex());
  await modal.getByText('Index rebuilt.', { exact: true }).waitFor(); await close();
  await appPage.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.index = c.__index; delete c.__index; delete c.__releaseIndex; });
  assert(await rebuild.isEnabled());
  checks.push('Long actions show progress, block repeated clicks and re-enable the control after completion');
  await settings.getByRole('button', { name: 'Retry summary updates', exact: true }).click();
  await modal.getByText('No pending summary updates to retry.', { exact: true }).waitFor(); await close();
  checks.push('Retry explicitly reports when there is no pending summary work');
  await appPage.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.__operations = c.journal.data.operations; c.journal.data.operations = []; });
  await settings.getByRole('button', { name: 'Undo last operation', exact: true }).click(); await modal.getByText('Nothing to undo.', { exact: true }).waitFor(); await close();
  await appPage.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.journal.data.operations = c.__operations; delete c.__operations; });
  checks.push('Undo explicitly reports a no-op rather than implying restoration');
  await appPage.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    const put = async (path, text) => { const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text); c.ingest(path, text); };
    await put('2007-01-01.md', '## recorded totals\n\nNATIVE = 15\nSUM = 15\n');
    const path = 'thejaz-summary-settings-native.md';
    await put(path, '### Days\n\n2007-01-01 = 15 😣\n\n### Projects\n\n### Results\n\nDays (2007-01-01 - 2007-01-01): 1d\n');
    c.settings.summaryPath = path; await c.index();
  });
  await settings.getByRole('button', { name: 'Sync summaries', exact: true }).click(); await modal.getByText('1 summary note updated.', { exact: true }).waitFor();
  assert((await modal.innerText()).includes('thejaz-summary-settings-native.md')); await close();
  await settings.getByRole('button', { name: 'Sync summaries', exact: true }).click(); await modal.locator('[role=status][data-outcome]').waitFor();
  assert.match(await modal.innerText(), /already synchronized|No summary notes changed/); await close();
  checks.push('Sync identifies a genuinely changed summary; repeated no-op sync retains unresolved warning information');
  const undoText = await appPage.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller, path = '2007-01-01.md', base = await c.port.read(path);
    await c.journal.perform([{ path, base, patches: [{ start: base.length, end: base.length, before: '', after: '\nNative undo check.\n' }], label: 'Settings undo test' }], 'Settings undo test');
    return base;
  });
  await settings.getByRole('button', { name: 'Undo last operation', exact: true }).click();
  await modal.getByText('Last Planner operation undone.', { exact: true }).waitFor(); await close();
  assert.equal(await appPage.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.port.read('2007-01-01.md')), undoText);
  checks.push('Successful Undo restores the exact saved text and reports the completed operation');
  const entry = settings.locator('#planner-settings-entry');
  await entry.getByRole('textbox', { name: 'Default start activity', exact: true }).fill('native-baseline');
  await entry.getByRole('button', { name: 'Save entry defaults', exact: true }).click(); await entry.getByText('Entry defaults saved.', { exact: true }).waitFor();
  assert.equal(await appPage.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.settings.defaultStartActivity), 'native-baseline');
  await entry.getByRole('button', { name: 'Restore helper defaults', exact: true }).click(); await modal.locator('[role=status][data-outcome]').waitFor();
  assert.match(await modal.innerText(), /activity helpers|activity suggestion/i); await close();
  assert.equal(await appPage.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.settings.defaultStartActivity), 'native-baseline');
  await entry.getByRole('button', { name: 'Restore helper defaults', exact: true }).click(); await modal.getByText('Default activity helpers are already in use.', { exact: true }).waitFor(); await close();
  checks.push('Saving entry defaults gives visible feedback; restoring helpers leaves entry defaults intact and reports no-op defaults');
  await appPage.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.__updateSettings = c.updateSettings; c.settings.activityHelpers = ['custom-native']; c.updateSettings = async () => { throw new Error('Synthetic save failure'); }; });
  const helpersBefore = await entry.getByRole('textbox', { name: 'Activity helpers', exact: true }).inputValue();
  await entry.getByRole('button', { name: 'Restore helper defaults', exact: true }).click();
  await modal.getByRole('alert').filter({ hasText: 'Synthetic save failure' }).waitFor(); await close();
  assert.equal(await entry.getByRole('textbox', { name: 'Activity helpers', exact: true }).inputValue(), helpersBefore);
  await appPage.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.updateSettings = c.__updateSettings; delete c.__updateSettings; });
  checks.push('Failed helper restoration explains the failure without replacing the displayed suggestion list');
  const project = settings.locator('.planner-project-setting-row').first();
  await project.getByRole('button', { name: /^Rename or merge / }).click();
  const transfer = page.locator('.modal:has(.planner-project-transfer)'); await transfer.waitFor();
  if (page !== appPage) assert.equal(await appPage.locator('.planner-project-transfer').count(), 0);
  await transfer.getByRole('button', { name: /^cancel$/i }).click(); await transfer.waitFor({ state: 'detached' });
  await project.getByRole('button', { name: /^Remove / }).click();
  const manage = page.locator('.modal:has(.planner-project-management)'); await manage.waitFor();
  await manage.getByRole('button', { name: /^rename or merge$/i }).click(); await transfer.waitFor();
  if (page !== appPage) assert.equal(await appPage.locator('.planner-project-transfer').count(), 0);
  await transfer.getByRole('button', { name: /^cancel$/i }).click(); await transfer.waitFor({ state: 'detached' });
  checks.push('Project dialogs also open in the Settings window; Cancel returns without applying changes');
  const time = settings.getByRole('textbox', { name: 'Time zone', exact: true });
  const zone = await time.inputValue(); await time.fill('not/a/zone'); await settings.getByText(/Invalid time zone/).waitFor();
  assert.equal(await appPage.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.settings.timezone), zone); await time.fill(zone);
  checks.push('An invalid time zone explains that the last valid value is retained');
  for (const theme of ['theme-light', 'theme-dark']) {
    await page.evaluate(theme => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(theme); }, theme);
    await page.setViewportSize({ width: 1280, height: 950 });
    await settings.locator('#planner-settings-daily').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/settings-${theme}.png` });
    await page.setViewportSize({ width: 650, height: 850 });
    await settings.locator('#planner-settings-projects').scrollIntoViewIfNeeded();
    const overflow = await settings.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert(overflow.scroll <= overflow.width + 1, JSON.stringify(overflow));
    const alignment = await settings.locator('#planner-settings-projects').evaluate(el => {
      const heading = el.querySelector(':scope > .setting-item-heading').getBoundingClientRect(), search = el.querySelector('input[type=search]').getBoundingClientRect();
      return { heading: heading.x, controls: search.x };
    });
    assert(Math.abs(alignment.heading - alignment.controls) < 1, JSON.stringify(alignment));
    await page.screenshot({ path: `artifacts/settings-${theme}-narrow.png` });
  }
  checks.push('Light/dark layouts and narrow settings panel have no horizontal overflow');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/settings-feedback-native.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (page) await appPage.evaluate(() => {
    const c = app.plugins.plugins['thejaz-planner']?.controller;
    if (c?.__releaseIndex) c.__releaseIndex();
    if (c?.__index) { c.index = c.__index; delete c.__index; }
    if (c?.__operations) { c.journal.data.operations = c.__operations; delete c.__operations; }
    if (c?.__updateSettings) { c.updateSettings = c.__updateSettings; delete c.__updateSettings; }
    if (c) c.indexing = false;
  }).catch(() => {});
  if (original) await appPage.evaluate(async original => {
    app.setting.close();
    const c = app.plugins.plugins['thejaz-planner'].controller;
    await c.whenIdle(); c.settings.autoUpdate = false;
    for (const [path, text] of Object.entries(original.notes)) {
      const file = app.vault.getAbstractFileByPath(path);
      if (text === null) { if (file) await app.vault.delete(file); }
      else if (file) await app.vault.modify(file, text); else await app.vault.create(path, text);
    }
    Object.assign(c.settings, original.settings); await c.saveSettings();
    c.journal.data = original.journal; await c.journal.save(); await c.index();
  }, original).catch(error => { process.exitCode = 1; console.error('Synthetic fixture restoration failed:', error.message); });
  await browser.close();
}
