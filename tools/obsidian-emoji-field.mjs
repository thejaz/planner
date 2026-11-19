import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
// Project emoji fields hold exactly one emoji, typed or picked; other text is refused with a hint.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [];
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await assertTestVault(page);
  await page.bringToFront();
  await page.evaluate(() => { app.setting.open(); app.setting.openTabById('thejaz-planner'); });
  // Settings may open in its own window.
  let settings = page;
  for (let i = 0; i < 50 && !(await settings.locator('.planner-project-settings').count()); i++) {
    for (const candidate of browser.contexts().flatMap(c => c.pages())) if (await candidate.locator('.planner-project-settings').count()) settings = candidate;
    await page.waitForTimeout(100);
  }
  const section = settings.locator('.planner-project-settings'); await section.waitFor();
  const field = section.getByRole('textbox', { name: 'New project emoji', exact: true });
  const hint = section.locator('.planner-project-add-form .planner-emoji-hint');
  await field.fill(''); await field.focus();
  // The Windows emoji panel inserts text like this.
  await settings.keyboard.insertText('🦉');
  assert.equal(await field.inputValue(), '🦉');
  await settings.keyboard.insertText('🌱');
  assert.equal(await field.inputValue(), '🌱');
  checks.push('Picking a second emoji replaces the first; the field never holds two');
  await settings.keyboard.type('ab');
  assert.equal(await field.inputValue(), '🌱');
  assert((await hint.innerText()).includes('One emoji only'));
  checks.push('Typed letters are refused with a visible hint, keeping the chosen emoji');
  await settings.keyboard.insertText('👩‍💻');
  assert.equal(await field.inputValue(), '👩‍💻'); assert.equal(await hint.innerText(), '');
  await settings.keyboard.press('Backspace');
  assert.equal(await field.inputValue(), '');
  checks.push('A joined emoji counts as one; the hint clears; Backspace leaves it blank for a random emoji');
  await settings.keyboard.press('Escape');
  await writeFile('artifacts/emoji-field-native.json', JSON.stringify({ checks }, null, 2));
  console.log(JSON.stringify({ checks }, null, 2));
} finally { await browser.close(); }
