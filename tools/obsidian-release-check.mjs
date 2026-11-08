import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page);
  const commands = await page.evaluate(() => Object.entries(app.commands.commands)
    .filter(([id]) => id.startsWith('thejaz-planner:')).map(([id, value]) => ({ id, name: value.name, hotkeys: value.hotkeys ?? [] })));
  for (const id of ['open', 'day', 'review', 'log', 'plan', 'submit', 'today', 'previous-day', 'next-day', 'new-day', 'edit',
    'toggle', 'duplicate', 'delete', 'move-up', 'move-down', 'shift', 'compact', 'reconcile-day', 'source',
    'undo', 'retry-summary', 'reconcile-summary', 'recover', 'day-context', 'rebuild-index', 'help'])
    assert(commands.some(c => c.id === `thejaz-planner:${id}`), `Missing command: ${id}`);
  assert(commands.every(c => c.hotkeys.length === 0), 'Global shortcuts must stay user-assignable');
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], v = await p.open(); v.switchMode('review');
    app.commands.executeCommandById('thejaz-planner:day');
  });
  await page.waitForFunction(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.mode === 'day');
  const historic = await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], v = await p.open();
    // A historical day known only by its totals (legacy notes are converted, not read as days).
    const text = '## recorded totals\n\nTHZ = 175\nSUM = 175\n', f = app.vault.getAbstractFileByPath('2024-06-21.md');
    if (f) await app.vault.modify(f, text); else await app.vault.create('2024-06-21.md', text);
    p.controller.ingest('2024-06-21.md', text);
    await v.navigate('2024-06-21');
    const before = await p.controller.port.read(v.day.path);
    const label = v.contentEl.querySelector('main').textContent;
    // Recorded totals are edited in Markdown: the day offers its source instead of rows.
    [...v.contentEl.querySelectorAll('button')].find(b => /^open source$/i.test(b.textContent)).click();
    await new Promise(r => setTimeout(r, 400));
    return { label, unchanged: before === await p.controller.port.read(v.day.path), sourceOpened: app.workspace.getActiveFile()?.path === v.day.path };
  });
  assert(historic.label.includes('2h 55m')); assert(historic.unchanged && historic.sourceOpened);
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], v = await p.open();
    await v.navigate('2026-10-19'); v.selected = -1; v.paintSelection(); v.contentEl.scrollTop = 0;
    document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light');
  });
  await page.mouse.move(1, 1);
  const light = await page.locator('.planner').evaluate(el => getComputedStyle(el).color);
  await page.screenshot({ path: 'artifacts/obsidian-day.png' });
  await page.evaluate(() => { document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark'); });
  const dark = await page.locator('.planner').evaluate(el => getComputedStyle(el).color);
  assert.notEqual(dark, light);
  await page.screenshot({ path: 'artifacts/obsidian-dark.png' });
  await page.evaluate(() => { document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light'); });
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 700, height: 800 });
  const layout = await page.locator('.planner').evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
  assert(layout.content <= layout.width + 1, 'Narrow planner overflows horizontally');
  await page.screenshot({ path: 'artifacts/obsidian-narrow.png' });
  await page.setViewportSize(viewport ?? { width: 1024, height: 800 });
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  // Calendar presets were replaced by rolling ranges on 20 October 2026.
  await page.getByLabel('Review period', { exact: true }).selectOption('30days');
  assert.equal(await page.getByLabel('Review period', { exact: true }).inputValue(), '30days');
  await page.screenshot({ path: 'artifacts/obsidian-review.png' });
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const report = { checks: ['Every daily action has a registered command; no global hotkeys are imposed',
    'Day command switches from Review', 'Historical Day footer displays authoritative recorded credit',
    'Legacy toggle opens the source without changing the note', 'Native light/dark theme values differ',
    'Narrow desktop layout has no horizontal overflow', 'Review applies a rolling period preset'], commands, historic, light, dark, layout };
  await writeFile('artifacts/obsidian-release-check.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
