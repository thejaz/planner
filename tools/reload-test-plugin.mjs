import { TEST_VAULT } from './paths.mjs';
import { chromium } from 'playwright';
import { copyFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  if (!page) throw Error('Isolated Obsidian page not found');
  const vault = await page.evaluate(() => app.vault.adapter.getBasePath());
  if (vault.replaceAll('\\', '/') !== TEST_VAULT.replaceAll('\\', '/')) throw Error('Refusing to touch a non-test vault');
  await page.waitForFunction(() => !app.plugins.plugins['thejaz-planner']?.controller.timers.size);
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner']?.controller.mutation; });
  if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    for (const leaf of app.workspace.getLeavesOfType('thejaz-planner')) {
      if (leaf.view.scope) app.keymap.popScope(leaf.view.scope);
      leaf.detach();
    }
    await app.plugins.disablePlugin('thejaz-planner');
  });
  for (const name of ['main.js', 'manifest.json', 'styles.css'])
    await copyFile(`dist/${name}`, `.test-vault/.obsidian/plugins/thejaz-planner/${name}`);
  await page.evaluate(async () => { await app.plugins.enablePlugin('thejaz-planner'); });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed, { timeout: 30000 });
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].open(); });
  console.log('Reloaded Planner in isolated test vault.');
} finally { await browser.close(); }
