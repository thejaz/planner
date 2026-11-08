import { assertTestVault } from './paths.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], path = '2013-01-01.md';
const text = '## plan for 1 jan 13\n### morning\n- [x] 09:00 (n/a) : awake\n- [ ] 10:00 (30) : chp\n- [ ] 10:30 (30) : mdr\n- [ ] 11:00 (30) : buffer\n### afternoon\n### evening\nCHP = 0\nMDR = 0\nSUM = 0\nKeep annotation.\n';
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page); page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async ({ path, text }) => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller; c.settings.autoUpdate = false;
    const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text);
    await c.index(); await c.whenIdle(); const v = await p.open(); await v.navigate('2013-01-01');
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
  }, { path, text });
  const raw = () => page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.port.read(path), path);
  const row = index => page.locator(`.planner-row[data-index="${index}"]`);
  const select = async (index, extend = false) => { await row(index).locator('.planner-label').click({ modifiers: extend ? ['Shift'] : [] }); await row(index).focus(); };
  const unchanged = async () => assert.equal(await raw(), text);
  const waitText = expected => page.waitForFunction(({ path, expected }) => app.plugins.plugins['thejaz-planner'].controller.days.get(path)?.text === expected, { path, expected });
  const command = async name => { await page.evaluate(async name => { const c = app.plugins.plugins['thejaz-planner'].controller; await c[name](); await c.whenIdle(); }, name); };
  await select(1);
  const keys = { 'add-below': 'a', edit: 'e', shift: 's', correct: 'r', duplicate: 'd', 'move-up': 'k', 'move-down': 'j', delete: 'x' };
  for (const [action, key] of Object.entries(keys)) {
    const button = row(1).locator(`[data-planner-row-action="${action}"]`);
    assert.equal(await button.getAttribute('aria-keyshortcuts'), key);
    assert.equal(await button.locator('kbd[aria-hidden=true]').innerText(), key.toUpperCase());
  }
  await row(1).press('a');
  const quick = page.getByRole('textbox', { name: 'Quick entry', exact: true });
  assert(await quick.evaluate(el => el === el.ownerDocument.activeElement));
  await quick.pressSequentially('aesrdkjx'); assert.equal(await quick.inputValue(), 'aesrdkjx'); await unchanged();
  await quick.fill(''); await quick.press('Escape');
  checks.push('All eight buttons show key hints and accessible key metadata; A focuses Add below and typing never runs row actions');

  await select(1); await row(1).press('e');
  const edit = page.getByRole('textbox', { name: 'Edit activity input', exact: true });
  const editor = page.getByRole('form', { name: 'Edit activity', exact: true });
  assert.equal(await editor.count(), 1);
  for (const target of [editor, edit]) {
    assert.equal(await target.getAttribute('aria-label'), null);
    await page.mouse.move(0, 0); await target.hover();
    assert.equal(await page.locator('.tooltip').waitFor({ state: 'visible', timeout: 900 }).then(() => true, () => false), false, 'No edit-panel label bubble');
  }
  checks.push('Edit panel and input retain accessible names without black label bubbles');
  await edit.fill('10:00 30 aesrdkjx'); await unchanged();
  await page.locator('.view-content.planner').focus(); await page.keyboard.press('s');
  const unsaved = page.locator('.modal').filter({ hasText: 'Stay' });
  await unsaved.getByRole('button', { name: /^stay$/i }).click();
  assert.equal(await edit.inputValue(), '10:00 30 aesrdkjx');
  await edit.press('Escape'); await unchanged();
  checks.push('E uses the compact editor; shortcuts outside a dirty editor retain Save/Discard/Stay protection');

  for (const key of ['s', 'r']) {
    await select(1); await select(2, true); await row(2).press(key);
    assert.match(await page.locator('.modal-title').innerText(), key === 's' ? /Shift 2 selected/i : /Correct 2 selected/i);
    await page.keyboard.press('Escape'); await unchanged();
    for (const [action, letter] of [['shift', 's'], ['correct', 'r'], ['delete', 'x']]) {
      const b = row(2).locator(`[data-planner-row-action="${action}"]`);
      assert.equal(await b.locator('kbd').count(), 1); assert.equal(await b.getAttribute('aria-keyshortcuts'), letter);
    }
  }
  await select(0); await row(0).press('s'); assert.equal(await page.locator('.modal').count(), 0);
  await row(0).press('k'); await unchanged();
  await select(2); assert(await row(2).locator('[data-planner-correct]').isDisabled());
  await row(2).press('r'); assert.equal(await page.locator('.modal').count(), 0); await unchanged();
  checks.push('S/R use the selected range; changing counts retains hints; disabled Shift/Correct and boundary Move remain unavailable');

  await select(1);
  const repeated = await row(1).evaluate(el => { const event = new KeyboardEvent('keydown', { key: 'd', repeat: true, bubbles: true, cancelable: true }); el.dispatchEvent(event); return event.defaultPrevented; });
  assert(repeated); await unchanged();
  await row(1).press('d'); await page.waitForFunction(() => document.querySelectorAll('.planner-row').length === 5);
  await select(1); await row(1).press('Control+z'); await waitText(text);
  await select(2); await row(2).press('k');
  await page.waitForFunction(path => !app.workspace.getLeavesOfType('thejaz-planner')[0].view.moving && app.plugins.plugins['thejaz-planner'].controller.days.get(path).entries[1].label === 'mdr', path);
  await page.keyboard.press('j'); await waitText(text);
  checks.push('D duplicates once and Undo restores exact text; held-key repeats do nothing; K/J move one place and restore original order');

  await select(1); await select(2, true); await row(2).press('x');
  assert.match(await page.locator('.modal-title').innerText(), /Delete 2 activities/i); await unchanged();
  await page.getByRole('button', { name: /^delete rows$/i }).click();
  await page.waitForFunction(() => document.querySelectorAll('.planner-row').length === 2);
  await command('undo'); await waitText(text); await command('redo');
  await page.waitForFunction(() => document.querySelectorAll('.planner-row').length === 2);
  await command('undo'); await waitText(text);
  checks.push('X previews selected deletion; confirmed deletion and exact Undo/Redo are preserved');

  const editable = await page.evaluate(() => {
    const root = document.querySelector('.view-content.planner'), field = document.createElement('div'); field.contentEditable = 'true';
    const child = document.createElement('span'); child.textContent = 'nested typing'; field.appendChild(child); root.appendChild(field);
    const ignored = [...'aesrdkjx'].every(key => { const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); child.dispatchEvent(e); return !e.defaultPrevented; });
    field.remove(); return ignored;
  });
  assert(editable); await unchanged();
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.switchMode('review'));
  await page.locator('.view-content.planner').focus();
  for (const key of 'aesrdkjx') await page.keyboard.press(key);
  assert.equal(await page.locator('.modal').count(), 0); await unchanged();
  await page.keyboard.press('?');
  const help = page.locator('.planner-help');
  for (const key of ['A', 'S', 'R', 'D', 'K', 'J', 'X', 'C']) assert(await help.locator('kbd').filter({ hasText: new RegExp(`^${key}$`) }).count());
  await page.keyboard.press('Escape');
  checks.push('Nested editable text and Report ignore row letters; Help includes all new keys and existing C context');
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.switchMode('day'));
  await select(1); await select(2, true);
  const originalTheme = await page.evaluate(() => document.body.className);
  for (const theme of ['theme-light', 'theme-dark']) {
    await page.evaluate(theme => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(theme); }, theme);
    for (const width of [1280, 650, 360]) {
      await page.setViewportSize({ width, height: 950 }); await page.waitForTimeout(250);
      const layout = await page.evaluate(() => {
        const el = document.querySelector('.view-content.planner'), strip = el.querySelector('.planner-row.is-current .planner-row-actions'), bounds = strip.getBoundingClientRect();
        return { fits: el.scrollWidth <= el.clientWidth + 1, items: [...strip.querySelectorAll('[data-planner-row-action]')].map(button => {
          const b = button.getBoundingClientRect(), key = button.querySelector('kbd'), k = key.getBoundingClientRect();
          return { height: b.height, keyWidth: k.width, centered: Math.abs(k.top + k.height / 2 - b.top - b.height / 2) < 1,
            labelSize: parseFloat(getComputedStyle(button).fontSize), keySize: parseFloat(getComputedStyle(key).fontSize), fits: b.left >= bounds.left - 1 && b.right <= bounds.right + 1 && button.scrollWidth <= button.clientWidth + 1 };
        }) };
      });
      assert(layout.fits && layout.items.length === 8, JSON.stringify(layout));
      for (const item of layout.items) assert(item.centered && item.fits && item.labelSize >= 12 && item.keySize >= 10.5 && item.keySize < item.labelSize && Math.abs(item.height - layout.items[0].height) < 1 && Math.abs(item.keyWidth - layout.items[0].keyWidth) < 1, JSON.stringify(item));
      await page.screenshot({ path: `artifacts/row-shortcuts-${theme}-${width}.png` });
    }
  }
  await page.evaluate(theme => { document.body.className = theme; }, originalTheme);
  checks.push('Light/dark at 1280/650/360px: uniform button heights, fixed readable centered key slots and no toolbar overflow');
  assert.deepEqual(errors, []); await writeFile('artifacts/row-shortcuts-native.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await browser.close(); }
