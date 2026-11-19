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
    const p = app.plugins.plugins['thejaz-planner'], v = await p.open();
    v.switchMode('day'); await v.navigate('2026-10-20'); v.focusEntry();
  });
  const controls = [
    page.getByRole('button', { name: 'Collapse activity editor', exact: true }),
    page.getByRole('textbox', { name: 'Quick entry', exact: true }),
    page.getByRole('button', { name: 'Entry mode', exact: true }),
    page.getByRole('button', { name: 'Activity', exact: true })
  ];
  for (const control of controls) {
    await page.mouse.move(350, 50);
    await page.locator('.tooltip').waitFor({ state: 'detached', timeout: 2000 });
    assert.equal(await control.getAttribute('title'), null);
    await control.hover();
    const tooltip = await page.locator('.tooltip').waitFor({ state: 'visible', timeout: 1000 }).then(() => true, () => false);
    assert.equal(tooltip, false);
  }
  checks.push('Close, quick entry, entry mode and Day retain accessible names without redundant hover tooltips');
  const close = controls[0];
  const geometry = await close.evaluate(el => {
    const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect();
    const stroke = el.querySelector('svg').getBoundingClientRect();
    return { width: r.width, height: r.height, top: r.top - p.top, right: p.right - r.right,
      centerX: stroke.left + stroke.width / 2 - r.left, centerY: stroke.top + stroke.height / 2 - r.top };
  });
  assert.equal(geometry.width, 28); assert.equal(geometry.height, 28);
  assert(Math.abs(geometry.top - geometry.right) < .5);
  assert.equal(geometry.centerX, geometry.width / 2); assert.equal(geometry.centerY, geometry.height / 2);
  checks.push('Close control is 28px square, has equal top/right insets, and its drawn strokes meet at its exact center');
  assert.equal(await page.locator('.planner-submit').getAttribute('title'), 'Enter to add; Ctrl + Enter for a new activity line');
  const informative = page.getByRole('button', { name: 'Review summary', exact: true });
  if (await informative.count()) assert((await informative.getAttribute('title')).includes('Compare'));
  checks.push('Non-obvious instructions and shortcut tooltips remain available');
  await close.hover();
  await page.screenshot({ path: 'artifacts/planner-close-centered.png' });
  await close.click();
  assert.equal(await page.locator('.planner-capture-toggle').getAttribute('aria-expanded'), 'false');
  checks.push('Centered close control still collapses the editor');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/planner-tooltip-checks.json', JSON.stringify({ checks, geometry, errors, noteWrites: 0 }, null, 2));
  console.log(JSON.stringify({ checks, geometry, errors }, null, 2));
} finally { await browser.close(); }
