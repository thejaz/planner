import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
// Project dialogs never show a greyed-out apply button without saying why; nothing is applied here.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [];
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await assertTestVault(page);
  await page.bringToFront();
  if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
  const code = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    const v = await app.plugins.plugins['thejaz-planner'].open(); v.switchMode('day');
    const code = c.projectCodes()[0]; v.manageProject(code); return code;
  });
  const modal = page.locator('.modal').last(), hint = modal.locator('.planner-apply-hint');
  // A disabled apply always carries its reason, visibly and as its tooltip; an enabled one carries none.
  const consistent = async (apply, label) => {
    const disabled = await apply.isDisabled(), text = (await hint.innerText()).trim(), title = await apply.getAttribute('title');
    assert.equal(disabled, text.length > 0, `${label}: disabled=${disabled}, hint="${text}"`);
    assert.equal(title ?? '', text, `${label}: tooltip matches the hint`);
    return text;
  };
  const removeApply = modal.getByRole('button', { name: 'Apply changes', exact: true });
  assert((await consistent(removeApply, 'removal before preview')).includes('Preview first'));
  await modal.getByRole('button', { name: 'Preview changes', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.modal:last-of-type button[type=submit]')?.disabled);
  const removal = await consistent(removeApply, 'removal after preview');
  assert(removal === '' || removal.includes('Fix the problems'), removal);
  await modal.getByRole('combobox', { name: 'Project removal action', exact: true }).selectOption('delete');
  assert((await consistent(removeApply, 'removal after changing the action')).includes('Preview first'));
  checks.push('Remove project: apply explains it needs a preview, and is explained or enabled after one');

  await modal.getByRole('button', { name: 'rename or merge', exact: true }).click();
  const transfer = page.locator('.modal').last(), transferHint = transfer.locator('.planner-apply-hint');
  const apply = transfer.getByRole('button', { name: 'apply rename', exact: true });
  const state = async label => {
    const disabled = await apply.isDisabled(), text = (await transferHint.innerText()).trim();
    assert.equal(disabled, text.length > 0, `${label}: disabled=${disabled}, hint="${text}"`);
    assert.equal((await apply.getAttribute('title')) ?? '', text);
    return text;
  };
  assert((await state('rename before preview')).includes('Preview first'));
  const newCode = transfer.getByRole('textbox', { name: 'New project code', exact: true });
  await newCode.fill('ZQX'); await newCode.press('Enter');
  await page.waitForFunction(() => document.querySelector('.planner-project-transfer-preview')?.textContent.length > 0);
  const renamed = await state('rename after preview');
  assert(renamed === '' || renamed.includes('Fix the problems'), renamed);
  await newCode.fill(code); await newCode.press('Enter');
  await page.waitForFunction(() => document.querySelector('.planner-project-transfer-preview')?.textContent.includes('already the project code'));
  assert((await state('rename to the same code')).includes('Nothing to apply'));
  await newCode.fill('ZQY');
  assert((await state('rename after editing the code')).includes('Preview first'));
  checks.push('Rename/merge: apply explains a missing preview, an unchanged code and blocking problems, and the reason clears when apply is possible');
  await transfer.getByRole('button', { name: 'cancel', exact: true }).click();
  assert(await page.evaluate(c => app.plugins.plugins['thejaz-planner'].controller.projectCodes().includes(c), code));
  await writeFile('artifacts/apply-hints-native.json', JSON.stringify({ checks, removal, renamed }, null, 2));
  console.log(JSON.stringify({ checks, removal, renamed }, null, 2));
} finally { await browser.close(); }
