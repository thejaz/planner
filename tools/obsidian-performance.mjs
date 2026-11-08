import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const report = { measurements: {}, checks: [], errors: [] };
const percentile = (values, p = .95) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page);
  await assertTestVault(page);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.bringToFront();
  if (await page.locator('.modal').count()) await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    // Settled-update timing needs automatic totals; a preceding helper may have disabled them.
    c.settings.summaryPath = 'Planner performance summary.md'; c.settings.autoUpdate = true; await c.saveSettings();
    const store = async (path, content) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (file) await app.vault.modify(file, content); else await app.vault.create(path, content);
    };
    await store('2003-01-01.md', '## plan for 1 jan 03\n\n### morning\n\n- [x] 09:00 (n/a) : awake\n- [x] 09:30 (30) : chp\n\n### afternoon\n\n### evening\n\n---\n\nCHP = 30\nSUM = 30\n');
    await store(c.settings.summaryPath, '### Days\n2003-01-01 = 30 🦥\n\n### Projects\nCHP = 30\n\n### Results\nDays (2003-01-01 - 2003-01-01): 1d\n**Projected Sum:** 10h\n**Actual Sum:** 0.5h (0.50h/d)\n');
    await c.index();
    const v = await app.plugins.plugins['thejaz-planner'].open(); v.switchMode('day'); await v.navigate('2026-10-19');
  });
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner'].controller.timers.size === 0);
  await page.evaluate(async () => { await app.plugins.plugins['thejaz-planner'].controller.mutation; });

  const warm = await page.evaluate(async () => {
    const p = app.plugins.plugins['thejaz-planner'], v = await p.open(), values = [];
    for (let i = 0; i < 40; i++) {
      const started = performance.now(); await p.open(); await v.refresh(); values.push(performance.now() - started);
    }
    return values;
  });
  report.measurements.warmDay = { samples: warm.length, p95: percentile(warm), max: Math.max(...warm), values: warm };
  assert(Math.max(...warm) <= 150, `Warm Day exceeds 150ms: ${Math.max(...warm)}`);
  report.checks.push('Warm Day including reveal, read, parse, and render: all 40 opens <=150ms');

  await page.evaluate(() => {
    window.plannerBench = { keys: [], preview: [], calculation: [], longTasks: [] };
    const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view, original = v.keyboard;
    // Obsidian's scoped keymap consumes handled keys before DOM listeners.
    // Time the real handler through the next browser frame instead.
    v.keyboard = event => {
      const start = performance.now(); original.call(v, event);
      requestAnimationFrame(() => window.plannerBench.keys.push(performance.now() - start));
    };
    window.plannerBench.stopKeys = () => { v.keyboard = original; };
  });
  await page.locator('.planner-row').nth(1).focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press(i % 2 ? 'ArrowUp' : 'ArrowDown');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const local = await page.evaluate(() => {
    window.plannerBench.stopKeys();
    const c = app.plugins.plugins['thejaz-planner'].controller, v = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
    const source = c.days.get('2026-10-19.md').text, draft = v.draft;
    for (let i = 0; i < 100; i++) {
      let start = performance.now(); c.ingest('2026-10-19.md', source); window.plannerBench.calculation.push(performance.now() - start);
      v.draft = `22:25 chp & mdr ${i + 1}-${i + 1}/${2 * i + 2}`;
      start = performance.now(); v.updatePreview(); window.plannerBench.preview.push(performance.now() - start);
    }
    v.draft = draft; v.updatePreview();
    return { keys: window.plannerBench.keys, preview: window.plannerBench.preview, calculation: window.plannerBench.calculation };
  });
  for (const [name, values] of Object.entries(local)) {
    report.measurements[name] = { samples: values.length, p95: percentile(values), max: Math.max(...values) };
    assert(values.length >= 40, `${name} needs at least 40 measured samples`);
    assert(percentile(values) <= 50, `${name} exceeds p95 50ms`);
  }
  report.checks.push('40 native arrow-key actions and 100 preview/calculation samples each: p95 <=50ms');

  const saved = [];
  for (let i = 0; i < 12; i++) {
    const value = 31 + i;
    const elapsed = await page.evaluate(async value => {
      const c = app.plugins.plugins['thejaz-planner'].controller;
      const file = app.vault.getAbstractFileByPath('2003-01-01.md');
      const start = performance.now();
      await app.vault.process(file, text => text.replace(/\(\d+\) : chp/, `(${value}) : chp`));
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { stop(); reject(Error('Automatic totals timed out')); }, 4000);
        const stop = c.onChange(() => {
          const summary = c.summaries.get(c.settings.summaryPath);
          if (c.days.get('2003-01-01.md')?.recordedSum === value && summary?.projects[0]?.value === value) {
            clearTimeout(timeout); stop(); resolve(performance.now() - start);
          }
        });
      });
    }, value);
    saved.push(elapsed);
  }
  report.measurements.settledUpdates = { samples: saved.length, p95: percentile(saved), max: Math.max(...saved), includesDebounce: true, values: saved };
  assert(Math.max(...saved) <= 1000, `Saved edits exceed one second: ${Math.max(...saved)}`);
  report.checks.push('12 source-to-summary updates including debounce: all <=1000ms from final edit');

  const indexing = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    await c.saveCache();
    const old = await app.vault.adapter.read('.obsidian/plugins/thejaz-planner/index.json');
    const longTasks = [];
    const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration, name: e.name }))));
    observer.observe({ type: 'longtask', buffered: false });
    const begin = performance.now();
    c.performance.indexSlices = [];
    await app.vault.adapter.write('.obsidian/plugins/thejaz-planner/index.json', '{}');
    await c.index(); const coldEnd = performance.now();
    await c.saveCache(); await c.index(); const warmEnd = performance.now();
    // Let the PerformanceObserver deliver completed tasks from both index passes.
    await new Promise(resolve => setTimeout(resolve, 100));
    observer.disconnect();
    return { files: c.days.size + c.summaries.size, coldMs: coldEnd - begin, warmMs: warmEnd - coldEnd,
      slices: c.performance.indexSlices, longTasks: longTasks.filter(e => e.start >= begin && e.start <= warmEnd),
      priorCacheBytes: old.length };
  });
  report.measurements.indexing = { ...indexing, maxSlice: Math.max(...indexing.slices) };
  assert(Math.max(...indexing.slices) <= 50, 'Index slice exceeds 50ms');
  assert(!indexing.longTasks.some(e => e.duration > 50), 'Indexing causes a main-thread long task');
  report.checks.push('Cold and cached full-vault indexing: no observed main-thread task >50ms');

  const fallback = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.settings.summaryPath = '⌚.md'; c.settings.lastRoutine = ''; await c.saveSettings();
    const paths = app.vault.getMarkdownFiles().map(f => f.path), before = new Map();
    for (const path of paths) before.set(path, await app.vault.read(app.vault.getAbstractFileByPath(path)));
    window.plannerReadonlyBaseline = [...before];
    for (const leaf of app.workspace.getLeavesOfType('thejaz-planner')) leaf.detach();
    await app.plugins.disablePlugin('thejaz-planner');
    const changed = [];
    for (const [path, value] of before) if (await app.vault.read(app.vault.getAbstractFileByPath(path)) !== value) changed.push(path);
    const file = app.vault.getAbstractFileByPath('2003-01-01.md'), content = await app.vault.read(file);
    await app.vault.process(file, text => text + '\nEditable while Planner is disabled.\n');
    const editable = (await app.vault.read(file)).includes('Editable while Planner is disabled.');
    await app.vault.modify(file, content);
    await app.plugins.enablePlugin('thejaz-planner');
    return { changed, editable, files: paths.length };
  });
  assert.deepEqual(fallback.changed, []); assert(fallback.editable);
  await page.waitForFunction(() => app.plugins.plugins['thejaz-planner']?.controller.indexed);
  const startupChanges = await page.evaluate(async () => {
    const changed = [];
    for (const [path, text] of window.plannerReadonlyBaseline)
      if (await app.vault.read(app.vault.getAbstractFileByPath(path)) !== text) changed.push(path);
    delete window.plannerReadonlyBaseline;
    return changed;
  });
  assert.deepEqual(startupChanges, []);
  report.measurements.disableFallback = fallback;
  report.checks.push('Disable leaves every copied Markdown file byte-identical; ordinary editing works while disabled');
  report.checks.push('Re-enable and complete startup indexing leave all copied Markdown bytes unchanged');
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  await writeFile('artifacts/obsidian-performance.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, measurements: Object.fromEntries(Object.entries(report.measurements).map(([k, v]) => [k, { ...v, values: undefined, slices: undefined }])) }, null, 2));
} catch (error) {
  await writeFile('artifacts/obsidian-performance-failure.json', JSON.stringify({ ...report, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
