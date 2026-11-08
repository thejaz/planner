import { OBSIDIAN_EXE, TEST_PROFILE, TEST_VAULT } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const endpoint = 'http://127.0.0.1:9237', expected = TEST_VAULT.replaceAll('\\', '/');
let browser = await chromium.connectOverCDP(endpoint);
let page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
const checks = [];
try {
  if (!process.argv.includes('--resume')) {
  assert.equal((await page.evaluate(() => app.vault.adapter.getBasePath())).replaceAll('\\', '/'), expected);
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.settings.summaryPath = 'Planner restart summary.md'; await c.saveSettings();
    const store = async (path, text) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (file) await app.vault.modify(file, text); else await app.vault.create(path, text);
    };
    const before = '## plan for 1 jan 04\n\n### morning\n- [x] 09:00 (n/a) : awake\n- [x] 09:30 (30) : chp\n\n---\nCHP = 30\nSUM = 30\n';
    await store('2004-01-01.md', before);
    await store(c.settings.summaryPath, '### Days\n2004-01-01 = 30 🦥\n### Projects\nCHP = 30\n### Results\nDays (2004-01-01 - 2004-01-01): 1d\n**Actual Sum:** 0.5h (0.50h/d)\n');
    await c.index();
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    await c.mutation;
    const before = await c.port.read('2004-01-01.md');
    const after = before.replace('(30) : chp', '(40) : chp').replaceAll('= 30', '= 40');
    const op = await c.journal.perform([{ path: '2004-01-01.md', base: before,
      patches: [{ start: 0, end: before.length, before, after }], label: 'Restart gap verification' }], 'Restart gap verification', true);
    // Persist the state at the gap between source save and summary save.
    op.state = 'pending'; await c.journal.save();
    c.ingest('2004-01-01.md', after);
  });
  await browser.close();
  browser = undefined;
  // Native PowerShell verifies the exact isolated profile before stopping its main process.
  // No original Obsidian process or working-vault window is selected.
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    $testProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'Obsidian.exe'" | Where-Object {
      $_.CommandLine -like '*--user-data-dir=${TEST_PROFILE}*' -and $_.CommandLine -notlike '*--type=*'
    })
    if ($testProcesses.Count -ne 1) { throw 'Expected exactly one isolated Obsidian main process' }
    Stop-Process -Id $testProcesses[0].ProcessId -Force
    Start-Process -FilePath '${OBSIDIAN_EXE}' -ArgumentList '--user-data-dir=${TEST_PROFILE}','--remote-debugging-port=9237' -WindowStyle Hidden
  `], { stdio: 'inherit' });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      browser = await chromium.connectOverCDP(endpoint, { timeout: 1000 });
      page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
      if (page) break;
      await browser.close(); browser = undefined;
    } catch { /* The known isolated process is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert(page && browser, 'Isolated app did not restart');
  }
  await page.waitForFunction(() => typeof app !== 'undefined' && app.vault);
  assert.equal((await page.evaluate(() => app.vault.adapter.getBasePath())).replaceAll('\\', '/'), expected);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  const pending = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    return { source: await c.port.read('2004-01-01.md'), summary: await c.port.read(c.settings.summaryPath),
      state: c.journal.data.operations.filter(o => o.label === 'Restart gap verification').at(-1)?.state,
      recovery: c.issues.has('recovery') };
  });
  assert(pending.source.includes('SUM = 40'));
  assert(pending.summary.includes('CHP = 30'));
  assert.equal(pending.state, 'interrupted'); assert(pending.recovery);
  checks.push('Full process restart detects the interrupted gap and leaves both notes unchanged on startup');
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.recover(); });
  assert(await page.evaluate(async () => (await app.plugins.plugins['thejaz-planner'].controller.port.read('Planner restart summary.md')).includes('CHP = 40')));
  checks.push('Explicit recovery completes the pending summary from durable source data');
  await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], c = p.controller;
    c.settings.summaryPath = '⌚.md'; c.settings.lastRoutine = ''; await c.saveSettings();
    const v = await p.open(); v.switchMode('day'); await v.navigate('2026-10-19');
  });
  await writeFile('artifacts/obsidian-restart.json', JSON.stringify({ checks }, null, 2));
  console.log(JSON.stringify({ checks }, null, 2));
} finally { if (browser) await browser.close(); }
