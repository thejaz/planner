import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await assertTestVault(page);
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.autoUpdate = false;
    c.settings.summaryPath = 'Reconcile UI verification.md';
    const store = async (path, text) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (file) await app.vault.modify(file, text); else await app.vault.create(path, text);
      c.ingest(path, text);
    };
    await store('2006-01-01.md', '## plan for 1 jan 06\n### morning\n- [x] 10:00 (250) : chp\n\n---\nCHP = 250\nSUM = 250\n');
    await store(c.settings.summaryPath, '### Days\n2006-01-01 =0 ☁️🦥 ==keep==\n### Projects\nCHP = 0\nMDR = 0\n### Results\nDays (2006-01-01 - 2006-01-01): 1d\n**Actual Sum:** 0h (0.00h/d)\n');
    const view = await p.open(); await view.navigate('2006-01-01');
    await view.summaryPreview();
  });
  await page.getByRole('button', { name: 'Update summary', exact: true }).waitFor();
  const preview = await page.locator('.modal .planner-preview').innerText();
  // Removed lines are marked with an ASCII '- ' prefix.
  assert(preview.includes('- CHP = 0') && preview.includes('+ CHP = 250'));
  assert(preview.includes('+ 2006-01-01 = 250 ☁️❄️ ==keep=='));
  assert(!preview.includes('MDR'));
  assert(await page.locator('.planner-diff-added').count() > 0);
  await page.screenshot({ path: 'artifacts/planner-reconcile-preview.png' });
  await page.getByRole('button', { name: 'Update summary', exact: true }).click();
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.summaries.get('Reconcile UI verification.md')?.text.includes('CHP = 250'));
  checks.push('Preview shows actual daily, project and result patches with explicit removed/added highlighting, omits unchanged projects, and saves spaced colon syntax with context intact');
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.summaryPreview());
  assert(await page.getByRole('button', { name: 'Done', exact: true }).isEnabled());
  assert((await page.locator('.modal .planner-preview').innerText()).includes('up to date'));
  await page.keyboard.press('Escape');
  checks.push('An unchanged summary confirms completion with Done');

  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    await c.mutation; c.settings.autoUpdate = true;
    const file = app.vault.getAbstractFileByPath('2006-01-01.md');
    await app.vault.modify(file, (await app.vault.read(file)).replaceAll('= 250', '= 200'));
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.issues.get('2006-01-01.md')?.includes('no longer match its completed activities'));
  await page.locator('.planner-notices > summary').click();
  assert((await page.locator('.planner-notices').innerText()).includes('total says 200m, but completed activities add up to 250m'));
  const reviewDay = page.getByRole('button', { name: 'Compare totals | 2006-01-01', exact: true });
  assert(await reviewDay.isEnabled());
  assert((await reviewDay.getAttribute('title')).includes('Compare'));
  await reviewDay.click();
  assert((await page.locator('.modal .planner-preview').innerText()).includes('SUM: 200 -> 250'));
  await page.getByRole('button', { name: 'Use calculated totals', exact: true }).click();
  await page.waitForFunction(() => !app.plugins.plugins['thejaz-planner'].controller.issues.has('2006-01-01.md'));
  assert(await page.evaluate(async () => (await app.plugins.plugins['thejaz-planner'].controller.port.read('2006-01-01.md')).includes('SUM = 250')));
  checks.push('A real manual footer edit is preserved, explained with both totals, and resolved through a direct preview/action that clears the notice');

  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.settings.autoUpdate = false;
    const file = app.vault.getAbstractFileByPath('2006-01-01.md');
    const raw = (await app.vault.read(file)).replace('(250)', '(?)');
    await app.vault.modify(file, raw); c.ingest(file.path, raw);
    await c.reconcileSummary();
    c.issues.set('verification', 'Check unavailable controls.'); c.emit();
    await app.workspace.getLeavesOfType('thejaz-planner')[0].view.refresh();
  });
  if (!(await page.locator('.planner-notices').getAttribute('open'))) await page.locator('.planner-notices > summary').click();
  assert.equal(await page.getByRole('button', { name: 'Compare totals | 2006-01-01', exact: true }).count(), 0);
  assert(await page.getByRole('button', { name: 'Open note | 2006-01-01', exact: true }).isEnabled());
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.summaryPreview());
  assert((await page.locator('.modal .planner-reconcile-issues').innerText()).includes('Days to fix first'));
  assert(await page.getByRole('button', { name: 'Fix the days below', exact: true }).isDisabled());
  await page.keyboard.press('Escape');
  checks.push('Incomplete daily records expose an open-note action, hide unavailable daily comparison, and remain unchanged in the summary preview');
  const retainedOperations = await page.evaluate(() => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    // In-memory control availability only; existing recovery files stay intact.
    const retained = structuredClone(c.journal.data.operations);
    c.journal.data.operations = [];
    c.emit();
    return retained;
  });
  await page.getByRole('button', { name: 'Check again', exact: true }).waitFor();
  for (const name of ['Retry summary update', 'Undo last change', 'Finish interrupted edits'])
    assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, `${name} is hidden while unavailable`);
  for (const title of await page.locator('.planner-notices button').evaluateAll(els => els.map(el => el.title))) assert(title);
  const gaps = await page.locator('.planner-notices .planner-actions').evaluateAll(els => els.map(el => getComputedStyle(el).gap));
  assert(gaps.every(gap => gap === '8px'));
  await page.screenshot({ path: 'artifacts/planner-attention-panel.png' });
  checks.push('Unavailable recovery/retry/undo controls are hidden, all attention actions have hover descriptions, and action rows have an 8px gap');
  await page.locator('.planner-shell').evaluate(el => { el.style.maxWidth = '320px'; });
  assert(await page.locator('.planner-notices').evaluate(el => [...el.querySelectorAll('button')].every(b => b.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1)));
  await page.locator('.planner-notices').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/planner-attention-narrow.png' });
  await page.locator('.planner-shell').evaluate(el => { el.style.maxWidth = ''; });
  checks.push('Attention actions wrap without overflowing a 320px content area');
  await page.evaluate(operations => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.journal.data.operations = operations; c.emit();
  }, retainedOperations);
  assert.deepEqual(errors, []);
  await writeFile('artifacts/planner-reconcile-native.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await browser.close(); }
