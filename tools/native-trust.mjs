import { assertTestVault } from './paths.mjs';
// Accept the vault trust prompt in the isolated test profile (it only holds the
// synthetic vault and this project's build), wait for Planner, and report whether
// dialogs open. On a fresh profile they don't until the window is closed normally
// and relaunched; tools/native-vault.ps1 does that.
import { chromium } from 'playwright';
const b = await chromium.connectOverCDP('http://127.0.0.1:9237');
try {
  const page = b.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page);
  await page.waitForTimeout(1000);
  if (await page.locator('.modal button', { hasText: /trust/i }).count()) {
    await page.locator('.modal button', { hasText: /trust/i }).first().click();
    await page.waitForTimeout(1500);
  }
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed, { timeout: 30000 });
  const palette = await page.evaluate(async () => {
    app.commands.executeCommandById('command-palette:open');
    await new Promise(r => setTimeout(r, 300));
    return document.querySelectorAll('.prompt').length;
  });
  await page.keyboard.press('Escape');
  console.log(JSON.stringify({ loaded: true, modalsWork: palette > 0 }));
} finally { await b.close(); }
