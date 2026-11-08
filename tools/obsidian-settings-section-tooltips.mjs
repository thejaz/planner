import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
let page, appPage;
try {
  appPage = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(appPage);
  await appPage.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed && !app.plugins.plugins['thejaz-planner'].controller.indexing);
  await appPage.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.whenIdle());
  const snapshot = () => appPage.evaluate(async () => ({
    settings: await app.plugins.plugins['thejaz-planner'].loadData(),
    notes: Object.fromEntries(await Promise.all(app.vault.getMarkdownFiles().map(async f => [f.path, await app.vault.read(f)])))
  }));
  const before = await snapshot();
  await appPage.evaluate(() => { app.setting.open(); app.setting.openTabById('thejaz-planner'); });
  for (const candidate of browser.contexts().flatMap(c => c.pages())) if (await candidate.locator('.planner-settings').count()) page = candidate;
  assert(page); page.on('pageerror', error => errors.push(error.message));
  const settings = page.locator('.planner-settings');
  const nav = settings.getByRole('navigation', { name: 'Planner settings sections', exact: true });
  assert.equal(await nav.count(), 1);
  assert.equal(await nav.getAttribute('aria-label'), null);
  assert.equal(await nav.getAttribute('title'), null);
  for (const title of ['Daily setup', 'Activity entry', 'Reports & markers', 'Projects & groups', 'Maintenance & recovery']) {
    const section = settings.getByRole('region', { name: title, exact: true });
    assert.equal(await section.count(), 1, `Accessible name retained: ${title}`);
    assert.equal(await section.getAttribute('aria-label'), null);
    assert.equal(await section.getAttribute('title'), null);
    await nav.getByRole('link', { name: title, exact: true }).click();
    const heading = section.getByRole('heading', { name: title, exact: true });
    assert(await heading.evaluate(el => el === el.ownerDocument.activeElement));
    await page.mouse.move(0, 0);
    await page.locator('.tooltip').waitFor({ state: 'detached', timeout: 2000 });
    await heading.hover();
    assert.equal(await page.locator('.tooltip').waitFor({ state: 'visible', timeout: 900 }).then(() => true, () => false), false, `No section tooltip: ${title}`);
    checks.push(`${title}: no redundant hover tooltip; accessible region name and navigation focus retained`);
  }
  await nav.getByRole('link', { name: 'Daily setup', exact: true }).click();
  assert.equal(await settings.locator('[aria-label]').count(), 0, 'No Settings control produces an Obsidian label bubble');
  await nav.getByRole('link', { name: 'Projects & groups', exact: true }).click();
  const search = settings.getByRole('searchbox', { name: 'Search projects', exact: true });
  await search.fill('CHP');
  const emoji = settings.getByRole('button', { name: 'Emoji for CHP', exact: true });
  assert.equal(await emoji.getAttribute('title'), 'Change project emoji', 'Keep the smaller native hover hint');
  await page.mouse.move(0, 0); await emoji.hover();
  assert.equal(await page.locator('.tooltip').waitFor({ state: 'visible', timeout: 900 }).then(() => true, () => false), false, 'No black emoji bubble');
  const group = settings.getByRole('combobox', { name: 'Group for CHP', exact: true });
  await group.focus();
  await appPage.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.emit());
  assert(await group.evaluate(el => el === el.ownerDocument.activeElement), 'Project repaint restores focus by accessible name');
  assert.equal(await settings.locator('[aria-label]').count(), 0, 'Repainted controls remain quiet');
  await emoji.click();
  const emojiInput = page.getByRole('textbox', { name: 'Project emoji', exact: true });
  await emojiInput.waitFor(); assert.equal(await emojiInput.getAttribute('aria-label'), null);
  await emojiInput.hover();
  assert.equal(await page.locator('.tooltip').waitFor({ state: 'visible', timeout: 900 }).then(() => true, () => false), false, 'Settings dialog controls remain quiet');
  await page.getByRole('button', { name: 'cancel', exact: true }).click();
  await search.fill('');
  checks.push('Search, dynamic project controls and emoji dialog retain accessible names/focus; black bubbles removed, native title hints preserved');
  await page.screenshot({ path: 'artifacts/settings-section-tooltips.png' });
  assert.match(await settings.getByRole('button', { name: 'Sync summaries', exact: true }).getAttribute('title'), /missing project definitions/);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(errors, []);
  checks.push('Settings navigation remains named; meaningful action help retained; no settings or Markdown changed');
  await writeFile('artifacts/settings-section-tooltips.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (appPage) await appPage.evaluate(() => app.setting.close()).catch(() => {});
  await browser.close();
}
