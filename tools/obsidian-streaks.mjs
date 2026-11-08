import { assertTestVault } from './paths.mjs';
import { setCriteria } from './criteria-note.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [];
const criteria = '### Criteria & Markers\n- 🔥 | >=9000m | renamed hot target\n';
const archive = 'streak-archive/thejaz-summary-streak-native.md';
const path = '2099-01-10.md';
let page;
try {
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page); page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(async ({ path, archive }) => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.__streakOriginal = { settings: structuredClone(c.settings), now: c.now, theme: document.body.className };
    c.settings.autoUpdate = false; await c.saveSettings();
    c.__streakDate = '2099-01-10'; c.now = () => ({ date: c.__streakDate, time: '12:00' });
    const put = async (path, text) => { const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text); };
    if (!app.vault.getAbstractFileByPath('streak-archive')) await app.vault.createFolder('streak-archive');
    await put(archive, '### Days\n' + [1, 2, 3, 4, 5].map(n => `2098-12-0${n} = 9000 ☁️`).join('\n') + '\n2099-01-10 = 9000 🔥\n2099-01-11 = 9000 🔥\n');
    for (const date of ['2099-01-08', '2099-01-09']) await put(`${date}.md`, `## recorded totals\nCHP = 9000\nSUM = 9000\n`);
    await put(path, '## plan for 10 jan 99\n### morning\n- [x] 09:00 (n/a) : awake\n- [ ] 10:00 (60) : chp\n### afternoon\n### evening\nCHP = 0\nSUM = 0\n');
    await c.index(); await c.whenIdle();
  }, { path, archive });
  await page.waitForFunction(() => { const c = app.plugins.plugins['thejaz-planner'].controller; return c.indexed && !c.indexing; });
  await setCriteria(page, criteria);
  await page.evaluate(async () => { const p = app.plugins.plugins['thejaz-planner']; p.controller.emit(); const v = await p.open(); await v.navigate('2099-01-10'); app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); });
  const state = () => page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.streak());
  const waitBadge = async (current, best) => {
    await page.waitForFunction(({ current, best }) => {
      const el = document.querySelector('.planner-streak');
      return el?.querySelector('.planner-streak-current')?.textContent === `🔥 ${current}d` && el.querySelector('.planner-streak-best')?.textContent === `best ${best}d`;
    }, { current, best });
  };
  await waitBadge(2, 5);
  await page.locator('.planner-streak').hover();
  assert.equal(await page.locator('.tooltip').waitFor({ state: 'visible', timeout: 800 }).then(() => true, () => false), false);
  checks.push('Archived numeric totals count without saved fire; daily literal zero beats the summary; planned credit and future days do not count');

  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    c.__streakNotes = Object.fromEntries(await Promise.all(app.vault.getMarkdownFiles().map(async f => [f.path, await app.vault.read(f)])));
    c.__streakJournal = JSON.stringify(c.journal.data); c.__streakCache = c.streak();
    const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
    await v.navigate('2026-10-20'); v.preset = '7days'; v.project = 'CHP'; await v.switchMode('review');
  });
  await waitBadge(2, 5);
  assert(await page.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; return c.streak() === c.__streakCache; }), 'View/date/filter changes reuse the cached result');
  await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller;
    if (JSON.stringify(c.journal.data) !== c.__streakJournal) throw Error('Read-only badge wrote to the journal');
    for (const [path, text] of Object.entries(c.__streakNotes)) if (await c.port.read(path) !== text) throw Error(`Badge changed ${path}`);
    const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view; await v.switchMode('day'); await v.navigate('2099-01-10');
  });
  checks.push('Both views show the same streak independent of displayed date and filters; redraws reuse the cache and change no Markdown or recovery data');

  await page.locator('.planner-row[data-index="1"] .planner-label').click();
  await page.locator('.planner-row[data-index="1"]').press('e');
  const edit = page.getByRole('textbox', { name: 'Edit activity input', exact: true });
  await edit.fill('10:00 60 keep my draft');
  await edit.evaluate(el => { el.setSelectionRange(4, 7); el.dataset.streakDraft = 'original'; });
  await page.evaluate(async archive => {
    const f = app.vault.getAbstractFileByPath(archive); await app.vault.modify(f, (await app.vault.read(f)).replace('2099-01-10 =', '2098-12-06 = 9000 🕶️\n2099-01-10 ='));
  }, archive);
  await waitBadge(2, 6);
  assert.equal(await edit.inputValue(), '10:00 60 keep my draft');
  assert.deepEqual(await edit.evaluate(el => [el.dataset.streakDraft, el.selectionStart, el.selectionEnd]), ['original', 4, 7]);
  await edit.press('Escape');
  checks.push('External archive changes refresh best while the same unsaved editor, text and selection remain intact');

  const before = await page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.port.read(path), path);
  await page.evaluate(async path => {
    const c = app.plugins.plugins['thejaz-planner'].controller, base = await c.port.read(path), start = base.indexOf('SUM = 0');
    await c.apply({ path, base, label: 'Native streak credited total', patches: [{ start, end: start + 7, before: 'SUM = 0', after: 'SUM = 9000' }] });
  }, path);
  await waitBadge(3, 6);
  for (const [action, current] of [['undo', 2], ['redo', 3], ['undo', 2]]) {
    await page.evaluate(async action => { const c = app.plugins.plugins['thejaz-planner'].controller; await c[action](); await c.whenIdle(); }, action);
    await waitBadge(current, 6);
  }
  assert.equal(await page.evaluate(path => app.plugins.plugins['thejaz-planner'].controller.port.read(path), path), before);
  checks.push('Credited-total writes invalidate the badge; exact Undo/Redo restores the streak and original Markdown');

  await page.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.__streakDate = '2099-01-13'; window.dispatchEvent(new Event('focus')); });
  await waitBadge(0, 6);
  await page.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.__streakDate = '2099-01-10'; document.dispatchEvent(new Event('visibilitychange')); });
  await waitBadge(2, 6);
  await page.evaluate(() => { app.plugins.plugins['thejaz-planner'].controller.__streakDate = '2099-01-13'; });
  await page.waitForFunction(() => document.querySelector('.planner-streak-current')?.textContent === '🔥 0d', null, { timeout: 18000 });
  await page.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.__streakDate = '2099-01-10'; window.dispatchEvent(new Event('focus')); });
  await waitBadge(2, 6);
  checks.push('Focus, visibility/wake and the 15-second clock check refresh a changed local date without note writes');

  const zones = await page.evaluate(async () => {
    const c = app.plugins.plugins['thejaz-planner'].controller, override = c.now;
    c.now = c.__streakOriginal.now;
    const dates = [];
    for (const timezone of ['Etc/GMT+12', 'Pacific/Kiritimati']) {
      await c.updateSettings({ timezone }); c.streak();
      if (c.streakCache.date !== c.now().date) throw Error('Stale local date after timezone change');
      dates.push(c.streakCache.date);
    }
    c.now = override; await c.updateSettings({ timezone: c.__streakOriginal.settings.timezone });
    return dates;
  });
  assert.notEqual(zones[0], zones[1]); await waitBadge(2, 6);
  await page.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.indexing = true; c.emit(); });
  await page.waitForFunction(() => document.querySelector('.planner-streak')?.textContent.includes('Loading planner history'));
  await page.evaluate(() => { const c = app.plugins.plugins['thejaz-planner'].controller; c.indexing = false; c.emit(); });
  await waitBadge(2, 6);
  checks.push('Real timezone setting changes invalidate the local-date cache; indexing shows loading instead of zero; the badge has no tooltip');

  await setCriteria(page, '### Criteria & Markers\n- ❄️ | 150-299m | cool\n');
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.emit());
  const unavailable = page.getByRole('button', { name: 'Hot-day streak unavailable. Show explanation', exact: true });
  await unavailable.click(); assert.match(await page.locator('.modal').innerText(), /Define one hot range/);
  await page.keyboard.press('Escape');
  await setCriteria(page, '### Criteria & Markers\n- 🔥 | 9000-8000m | bad range\n');
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.emit());
  assert.equal((await state()).available, false);
  await setCriteria(page, null); await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.emit());
  assert.equal((await state()).available, true, 'Absent criteria uses defaults');
  await setCriteria(page, criteria); await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.emit()); await waitBadge(2, 6);
  checks.push('Missing/invalid hot definitions show an actionable unavailable state; removing the criteria note enables defaults; restoring rules updates live');

  const layouts = [];
  for (const theme of ['theme-light', 'theme-dark']) {
    await page.evaluate(theme => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(theme); }, theme);
    for (const mode of ['day', 'review']) {
      await page.evaluate(mode => app.workspace.getLeavesOfType('thejaz-planner')[0].view.switchMode(mode), mode);
      for (const width of [1280, 760, 650, 360]) {
        await page.setViewportSize({ width, height: 850 }); await page.waitForTimeout(180);
        const layout = await page.evaluate(() => {
          const root = document.querySelector('.view-content.planner'), header = root.querySelector('.planner-header');
          const rect = selector => { const r = header.querySelector(selector)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
          return { tabs: rect('.planner-view-toggle'), streak: rect('.planner-streak'), nav: rect('.planner-date-navigation'), help: rect('.help'), fits: root.scrollWidth <= root.clientWidth + 1 };
        });
        const { tabs, streak, nav, help } = layout;
        assert(layout.fits && tabs.width > 0 && streak.width > 0 && streak.height >= 28, JSON.stringify(layout));
        const disjoint = (a, b) => a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1;
        for (const other of [tabs, nav, help].filter(Boolean)) assert(disjoint(streak, other), JSON.stringify(layout));
        if (width === 360) assert(Math.abs(help.y - tabs.y) < 1, JSON.stringify(layout));
        if (Math.abs(tabs.y - streak.y) < 8) assert(Math.abs(tabs.y + tabs.height / 2 - streak.y - streak.height / 2) < 1, JSON.stringify(layout));
        else assert(streak.y >= tabs.bottom - 1 && Math.abs(streak.x - tabs.x) < 1, JSON.stringify(layout));
        layouts.push({ theme, mode, width, ...layout });
        if (mode === 'day' && [1280, 360].includes(width)) await page.screenshot({ path: `artifacts/streaks-${theme}-${width}.png` });
      }
    }
  }
  checks.push('Light/dark, both views, 1280/760/650/360px: centered inline badge or clean wrap beneath tabs, no overlaps or horizontal overflow');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/streaks-native.json', JSON.stringify({ checks, errors, layouts }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  if (page) await page.evaluate(() => {
    const c = app.plugins.plugins['thejaz-planner']?.controller, saved = c?.__streakOriginal;
    if (saved) { c.now = saved.now; c.settings = saved.settings; document.body.className = saved.theme; c.emit(); }
  }).catch(() => {});
  await browser.close();
}
