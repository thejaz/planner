import { assertTestVault } from './paths.mjs';
import { setCriteria } from './criteria-note.mjs';
import { readFileSync } from 'node:fs';
const combinationRules = /export const COMBINATION_RULES = `([\s\S]*?)`;/.exec(readFileSync('src/core/marker-combinations.ts', 'utf8'))[1];
import { plannerUI } from './planner-ui.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], source = 'Review settings verification.md';
const legend = `### Criteria & Markers
- 😣 | 0-29m | can't study
- ✌ | 0-29m | light can't study (context)
- 😎 | 0-29m | no study weekends
- 🦥 | 30-149m | low pro
- ❄️ | 150-299m | cool
- 🔥 | ≥300m | hot
- 🕶️ | at-ease days (context)
- ☁️ | buffer days (context)
- ==highlights== | can't study (formatting)
- **bolds** | weekends (formatting)
${combinationRules}
`;
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  assert(page); await page.waitForFunction(() => typeof app !== 'undefined' && app.vault);
  await assertTestVault(page);
  const trust = page.getByRole('button', { name: 'Trust author and enable plugins', exact: true });
  if (await trust.count()) await trust.click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  await page.evaluate(() => app.setting.close());
  page.on('pageerror', error => errors.push(error.message));
  // One criteria note serves every summary; its 🔥 label is renamed to prove Review reads it.
  await setCriteria(page, legend.replace('hot\n', 'focus\n'));
  await page.evaluate(async ({ source }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.projectCodes = [...new Set([...c.settings.projectCodes, 'HAY'])];
    c.settings.autoUpdate = false; c.settings.summaryPath = source;
    c.settings.projectGroups = []; c.settings.weekendDays = [5]; c.settings.showMarkerCounts = true;
    const store = async (path, text) => {
      const f = app.vault.getAbstractFileByPath(path);
      if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    };
    await store(source, `### Days\n**2010-01-01 = 0 😎**\n2010-01-02 = 60 ☁️🦥\n2010-01-03 = 200 ❄️🕶️\n2010-01-04 = 60 🔥\n==2010-01-05 = 0 😣==\n### Projects\nCHP = 60\nMDR = 200\n### Results\nDays (2010-01-01 - 2010-01-05): 5d\n`);
    await store('2010-01-02.md', '## plan for 2 jan 10\n### morning\n- [x] 09:00 (60) : chp\nCHP = 60\nSUM = 60\n');
    await store('2010-01-03.md', '## plan for 3 jan 10\n### morning\n- [x] 09:00 (200) : mdr\nMDR = 200\nSUM = 200\n');
    await c.saveSettings(); await c.index();
    const v = await p.open(); v.switchMode('day'); await v.navigate('2010-01-02');
  }, { source });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  await page.locator('.planner-label').first().click();
  const snapshot = () => page.evaluate(async () => Object.fromEntries(await Promise.all(app.vault.getMarkdownFiles().map(async f => [f.path, await app.vault.read(f)]))));
  const before = await snapshot();
  let settingsPage = page;
  const settings = async () => {
    await page.evaluate(() => { app.setting.open(); app.setting.openTabById('thejaz-planner'); });
    settingsPage = browser.contexts().flatMap(c => c.pages()).find(p => p.url() === 'about:blank') ?? page;
    await settingsPage.locator('.planner-review-settings').first().waitFor({ state: 'visible' });
  };
  const settle = () => page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });
  await settings();
  assert.equal(await settingsPage.locator('.planner-settings').evaluate(el => getComputedStyle(el).textTransform), 'none');
  assert(await settingsPage.getByText('Automatic totals', { exact: true }).isVisible());
  const groupPanel = settingsPage.locator('.planner-project-settings');
  // Day markers and weekends is an always-visible part of the Reports & markers section (0.2.82).
  const markerPanel = settingsPage.locator('.planner-marker-settings');
  await groupPanel.getByText('Manage groups', { exact: true }).click();
  for (const name of ['Business', 'Academy', 'Hobbies']) {
    await settingsPage.getByRole('textbox', { name: 'New group name', exact: true }).fill(name);
    await groupPanel.getByRole('button', { name: 'Add group', exact: true }).click(); await settle();
    await settingsPage.getByRole('textbox', { name: `Rename ${name}`, exact: true }).waitFor();
  }
  await settingsPage.getByRole('textbox', { name: 'New group name', exact: true }).fill('business');
  await groupPanel.getByRole('button', { name: 'Add group', exact: true }).click();
  assert((await groupPanel.locator('[role=alert]').innerText()).includes('unique'));

  assert.equal(await settingsPage.getByRole('combobox', { name: 'Group for CHP', exact: true }).locator('option:checked').textContent(), 'Unassigned');
  await settingsPage.getByRole('combobox', { name: 'Group for CHP', exact: true }).selectOption({ label: 'Business' }); await settle();
  await settingsPage.getByRole('combobox', { name: 'Group for MDR', exact: true }).selectOption({ label: 'Academy' }); await settle();
  await settingsPage.getByRole('combobox', { name: 'Group for HAY', exact: true }).selectOption({ label: 'Hobbies' }); await settle();
  checks.push('Native settings create named groups, reject duplicate names and assign existing projects');
  await settingsPage.getByRole('combobox', { name: 'Group for CHP', exact: true }).selectOption({ label: 'Academy' }); await settle();
  assert.equal(await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.settings.projectGroups.filter(g => g.projects.includes('CHP')).length), 1);
  await settingsPage.getByRole('combobox', { name: 'Group for CHP', exact: true }).selectOption({ label: 'Business' }); await settle();
  checks.push('Reassignment moves a project between groups without duplicate membership');
  await settingsPage.getByRole('textbox', { name: 'Rename Hobbies', exact: true }).fill('Leisure');
  await settingsPage.getByRole('textbox', { name: 'Rename Hobbies', exact: true }).locator('xpath=ancestor::*[contains(@class,"setting-item")][1]').getByRole('button', { name: 'rename', exact: true }).click(); await settle();
  await settingsPage.getByRole('textbox', { name: 'Rename Leisure', exact: true }).fill('Hobbies');
  await settingsPage.getByRole('textbox', { name: 'Rename Leisure', exact: true }).locator('xpath=ancestor::*[contains(@class,"setting-item")][1]').getByRole('button', { name: 'rename', exact: true }).click(); await settle();
  await settingsPage.getByRole('textbox', { name: 'New group name', exact: true }).fill('Disposable');
  await groupPanel.getByRole('button', { name: 'Add group', exact: true }).click(); await settle();
  await settingsPage.getByRole('combobox', { name: 'Group for HAY', exact: true }).selectOption({ label: 'Disposable' }); await settle();
  await settingsPage.getByRole('textbox', { name: 'Rename Disposable', exact: true }).locator('xpath=ancestor::*[contains(@class,"setting-item")][1]').getByRole('button', { name: 'remove', exact: true }).click(); await settle();
  assert.equal(await settingsPage.getByRole('combobox', { name: 'Group for HAY', exact: true }).inputValue(), '');
  await settingsPage.getByRole('combobox', { name: 'Group for HAY', exact: true }).selectOption({ label: 'Hobbies' }); await settle();
  checks.push('Renaming preserves memberships; removing a group leaves its projects ungrouped and available for reassignment');
  await markerPanel.scrollIntoViewIfNeeded();
  await settingsPage.getByRole('checkbox', { name: 'Friday is a weekend', exact: true }).uncheck();
  await settingsPage.getByRole('checkbox', { name: 'Saturday is a weekend', exact: true }).check(); await settle();
  assert((await markerPanel.innerText()).includes('thejaz-criteria.md'));
  assert.equal(await settingsPage.getByRole('textbox', { name: 'Criteria & Markers note', exact: true }).count(), 0);
  assert.deepEqual(await snapshot(), before);
  checks.push('Weekend selection persists; settings name thejaz-criteria.md as the one criteria note; all Markdown bytes remain unchanged');
  await page.evaluate(() => app.setting.close());
  await page.evaluate(() => {
    const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
    v.preset = 'custom'; v.rangeStart = '2010-01-01'; v.rangeEnd = '2010-01-05'; v.switchMode('review');
  });
  assert((await page.locator('.planner-group-totals').innerText()).includes('Business\n1h 00m'));
  assert((await page.locator('.planner-group-totals').innerText()).includes('Academy\n3h 20m'));
  assert((await page.locator('.planner-group-totals').innerText()).includes('Hobbies\n0h 00m'));
  assert.equal(await page.locator('.planner-marker-count[data-marker="🔥"]').getAttribute('title'), 'focus: 1 day');
  assert.equal(await page.locator('.planner-marker-count[data-marker="bold"]').count(), 0);
  assert.equal(await page.locator('.planner-marker-count[data-marker="highlight"]').count(), 0);
  checks.push('Review displays subtle group sums and actual saved emoji/highlight/bold counts using selected legend labels');
  await page.getByRole('combobox', { name: 'Project filter', exact: true }).selectOption('CHP');
  assert.equal(await page.locator('.planner-group-total').count(), 1);
  assert((await page.locator('.planner-group-total').innerText()).includes('Business'));
  assert.equal(await page.locator('.planner-marker-count[data-marker="🔥"] .planner-marker-value').innerText(), '1');
  await page.getByRole('combobox', { name: 'Project filter', exact: true }).selectOption('');
  await page.getByRole('textbox', { name: 'Review start date', exact: true }).fill('2010-01-03');
  assert((await page.locator('.planner-group-totals').innerText()).includes('Business\n0h 00m'));
  assert.equal(await page.locator('.planner-marker-count[data-marker="🦥"] .planner-marker-value').innerText(), '0');
  await page.getByRole('textbox', { name: 'Review start date', exact: true }).fill('2010-01-01');
  checks.push('Group sums follow dates and project filter; recorded day-marker counts follow dates independently of project filter');
  await page.locator('.planner-marker-checks > summary').click();
  const issues = await page.locator('.planner-marker-checks').innerText();
  assert(issues.includes('does not fit') && issues.includes('not one of your weekend days') && issues.includes('not bold'), issues);
  const issue = page.locator('.planner-marker-issue').filter({ hasText: '2010-01-04:' }).first();
  await issue.getByRole('button', { name: 'Open source line', exact: true }).click();
  await page.waitForFunction(() => {
    const view = app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === 'Review settings verification.md')?.view;
    return view?.editor.getLine(view.editor.getCursor().line).includes('2010-01-04 = 60 🔥');
  });
  const position = await page.evaluate(() => {
    const view = app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === 'Review settings verification.md').view;
    return { line: view.editor.getCursor().line, text: view.editor.getLine(view.editor.getCursor().line) };
  });
  assert(position.text.includes('2010-01-04 = 60 🔥'));
  assert.deepEqual(await snapshot(), before);
  checks.push('Discrepancies preserve recorded counts and open the exact summary line with correction guidance; no note repairs occur');
  await page.evaluate(async () => { const p = app.plugins.plugins['thejaz-planner']; await p.open(); });
  await page.locator('.planner-marker-checks > summary').click();
  await page.locator('.planner').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: 'artifacts/review-extras-light.png' });
  await page.evaluate(() => { document.body.removeClass('theme-light'); document.body.addClass('theme-dark'); });
  await page.screenshot({ path: 'artifacts/review-extras-dark.png' });
  await page.evaluate(() => { document.body.removeClass('theme-dark'); document.body.addClass('theme-light'); });
  await page.setViewportSize({ width: 740, height: 800 });
  for (const selector of ['.planner-group-totals', '.planner-marker-counts'])
    assert(await page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.screenshot({ path: 'artifacts/review-extras-narrow.png' });
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.evaluate(async () => {
    for (const leaf of app.workspace.getLeavesOfType('thejaz-planner')) leaf.detach();
    await app.plugins.disablePlugin('thejaz-planner'); await app.plugins.enablePlugin('thejaz-planner');
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  const saved = await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner']; await p.open();
    return { groups: p.controller.settings.projectGroups, weekends: p.controller.settings.weekendDays, hot: p.controller.criteria()?.definitions.find(d => d.key === '🔥')?.label };
  });
  assert.deepEqual(saved.weekends, [6]); assert.equal(saved.hot, 'focus');
  assert.deepEqual(saved.groups.find(g => g.name === 'Business').projects, ['CHP']);
  assert.deepEqual(await snapshot(), before);
  checks.push('Plugin reload restores groups, memberships, weekend days and the criteria note while every Markdown file remains unchanged');
  assert.deepEqual(errors, []);
  const version = await page.evaluate(() => app.plugins.plugins['thejaz-planner'].manifest.version);
  const report = { version, checks, errors };
  await writeFile('artifacts/review-extras.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
