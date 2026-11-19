import { assertTestVault } from './paths.mjs';
import { plannerUI } from './planner-ui.mjs';
import { chooseCapture } from './capture-choice.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks = [], errors = [], date = '2005-01-01';
try {
  const page = plannerUI(browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')));
  assert(page, 'Isolated Obsidian is required');
  await assertTestVault(page);
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(async date => {
    const p = app.plugins.plugins['thejaz-planner'];
    p.controller.settings.autoUpdate = false;
    const text = '## plan for 1 jan 05\n\n### morning\n\n- [x] 09:45 (n/a) : awake\n- [ ] 14:30 (95-95/200) : chp & mdr\n- [ ] 15:00 (0) : chp\n\n### afternoon\n\n### evening\n\n---\n\nCHP = 0\nMDR = 0\nSUM = 0\n\nPersonal annotation **keep me**.\n';
    const file = app.vault.getAbstractFileByPath(`${date}.md`);
    if (file) await app.vault.modify(file, text); else await app.vault.create(`${date}.md`, text);
    const view = await p.open(); view.mode = 'day'; await view.navigate(date);
  }, date);
  await page.waitForFunction(date => app.plugins.plugins['thejaz-planner'].controller.days.get(`${date}.md`)?.entries.length === 3, date);
  const raw = () => page.evaluate(date => app.vault.read(app.vault.getAbstractFileByPath(`${date}.md`)), date);
  const initial = await raw();
  const edit = async (index, value) => {
    const row = page.locator('.planner-row').nth(index); await row.focus(); await row.press('Enter');
    const input = page.getByRole('textbox', { name: 'Edit activity input', exact: true }); await input.fill(value); return input;
  };
  const waitText = text => page.waitForFunction(({ date, text }) =>
    app.plugins.plugins['thejaz-planner'].controller.days.get(`${date}.md`)?.text.includes(text), { date, text });
  let editing = await edit(1, '14:30 95-95/0 chp & mdr');
  // The editor explains the calculation instead of echoing the raw duration.
  const explained = await page.locator('.planner-edit-preview').innerText();
  assert(explained.includes('285m after') && explained.includes('CHP 95m + MDR 95m = 190m'), explained);
  await editing.press('Enter'); await page.locator('.planner-activity-editor').waitFor({ state: 'detached' });
  assert.equal(await raw(), initial.replace('95-95/200','95-95/285'));
  checks.push('Compact edit /0 preserves split credit and surrounding Markdown');
  editing = await edit(2, '15:00 0 chp (unchanged zero)'); await editing.press('Enter'); await waitText('(0) : chp (unchanged zero)');
  editing = await edit(2, '15:00 0 chp (unchanged zero)');
  // Minutes follow the end time: select that zero and type it again.
  await editing.evaluate(el => { const at = el.value.indexOf(' 0 ') + 1; el.setSelectionRange(at, at + 1); });
  await editing.press('Backspace'); await editing.press('0'); await editing.press('Enter'); await waitText('(30) : chp (unchanged zero)');
  checks.push('Label edits preserve literal zero; deliberate zero recalculates duration');
  const beforeErrors = await raw();
  editing = await edit(0,'09:45 0 awake'); assert((await page.locator('.planner-activity-editor [role=alert]').innerText()).includes('previous activity'));
  assert.equal(await raw(),beforeErrors); await editing.press('Escape');
  editing = await edit(1,'14:30 0 chp & mdr'); assert((await page.locator('.planner-activity-editor [role=alert]').innerText()).includes('divide credit'));
  assert.equal(await raw(),beforeErrors); await editing.press('Escape');
  checks.push('Missing anchor and split allocations cannot save');
  editing = await edit(1,'14:30 0 chp & mdr');
  const split = page.locator('.planner-activity-editor .planner-split-choice');
  assert.equal(await split.count(), 1); { const text = (await split.innerText()).toLowerCase(); assert(text.startsWith('split equally') && text.includes('chp 143m') && text.includes('mdr 142m'), text); }
  await split.click(); assert.equal(await editing.inputValue(), '14:30 143-142/0 chp & mdr'); assert.equal(await raw(), beforeErrors);
  assert((await page.locator('.planner-activity-editor .planner-edit-preview').first().innerText()).includes('CHP 143m + MDR 142m'));
  await editing.press('Escape'); await page.locator('.planner-activity-editor').waitFor({ state: 'detached' }); assert.equal(await raw(), beforeErrors);
  editing = await edit(1,'14:30 0 chp & mdr'); await page.locator('.planner-activity-editor .planner-split-choice').click();
  await editing.press('Enter'); await waitText('(143-142/285) : chp & mdr');
  await page.evaluate(() => app.plugins.plugins['thejaz-planner'].controller.undo()); assert.equal(await raw(), beforeErrors);
  checks.push('The activity editor offers Split equally as a draft only: choosing it fills 143-142/0 and previews credits, Cancel writes nothing, Save writes it and Undo restores exact bytes');

  await page.locator('.planner-row').nth(2).focus();
  const quick = page.getByRole('textbox', { name: 'Quick entry', exact: true });
  await page.evaluate(() => app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
  await chooseCapture(page, 'Entry mode', 'log');
  await quick.fill('15:30 0 chp\n16:00 10-15/0 chp & mdr');
  const preview = await page.locator('.planner-preview').innerText();
  assert(preview.includes('(30) : chp') && preview.includes('(10-15/30) : chp & mdr'));
  await quick.press('Enter'); await waitText('16:00 (10-15/30)');
  checks.push('Multiline quick entry resolves zero and /0 sequentially using keyboard submission');
  await page.locator('.planner-row').last().focus();
  await page.locator('.planner-row').last().press('Control+z');
  await page.waitForFunction(date => app.plugins.plugins['thejaz-planner'].controller.days.get(`${date}.md`)?.entries.length === 3, date);
  assert.equal(await raw(), beforeErrors);
  checks.push('Keyboard undo restores the exact preceding Markdown');
  await page.evaluate(() => { app.plugins.plugins['thejaz-planner'].controller.settings.autoUpdate = true; });
  await page.locator('.planner-row').nth(2).focus();
  await page.locator('.planner-row').nth(2).press('Space');
  await waitText('SUM = 30');
  assert((await raw()).includes('CHP = 30'));
  checks.push('Calculated bare-zero credit participates in normal completed totals');

  await page.evaluate(async () => {
    const view = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
    await view.navigate('2026-10-20'); view.selected = -1; view.paintSelection();
    view.contentEl.scrollTop = 0;
    document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light');
  });
  await page.mouse.move(1, 1);
  await page.evaluate(() => document.activeElement?.blur());
  const dayStyles = await page.locator('.planner').evaluate(el => {
    const row = el.querySelector('.planner-row'), capture = el.querySelector('.planner-capture');
    return {
      rowHeight: row.getBoundingClientRect().height,
      headingSize: parseFloat(getComputedStyle(el.querySelector('h3')).fontSize),
      headingWeight: getComputedStyle(el.querySelector('h3')).fontWeight,
      captureTopBorder: getComputedStyle(capture).borderTopWidth,
      chipCount: el.querySelectorAll('.planner-totals .planner-project-chip').length,
      collapsedProjects: !!el.querySelector('.planner-project-totals')?.closest('details'),
      projectWeight: getComputedStyle(el.querySelector('.planner-project-name')).fontWeight
    };
  });
  assert(dayStyles.rowHeight <= 28 && dayStyles.rowHeight >= 24);
  assert(dayStyles.headingSize >= 18 && Number(dayStyles.headingWeight) >= 600);
  assert(dayStyles.captureTopBorder === '1px' && dayStyles.chipCount >= 1 && !dayStyles.collapsedProjects);
  assert(Number(dayStyles.projectWeight) >= 700);
  await page.screenshot({ path: 'artifacts/planner-0.2-day.png' });
  await page.locator('.planner-totals').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/planner-0.2-totals.png' });
  checks.push('Compact native-sized rows and headings, subtle capture outline, bold project names, always-visible chips');

  const contrasts = [];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => {
      document.body.classList.remove('theme-dark', 'theme-light'); document.body.classList.add(`theme-${theme}`);
    }, theme);
    const minContrast = await page.locator('.planner-project-totals').first().evaluate(el => {
      const luminance = color => {
        const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => x / 255)
          .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      return Math.min(...[...el.querySelectorAll('.planner-project-chip')].map(chip => {
        const s = getComputedStyle(chip), a = luminance(s.color), b = luminance(s.backgroundColor);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      }));
    });
    assert(minContrast >= 4.5, `Project chip contrast in ${theme}: ${minContrast}`);
    contrasts.push({ theme, minContrast });
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    await page.getByLabel('Review period', { exact: true }).selectOption('30days');
    await page.getByLabel('Project filter', { exact: true }).selectOption('');
    const reviewStyle = await page.locator('.planner-review-table').evaluate(el => ({
      fontSize: parseFloat(getComputedStyle(el).fontSize),
      color: getComputedStyle(el).color,
      expected: getComputedStyle(el.closest('.planner')).color
    }));
    assert(reviewStyle.fontSize >= 15 && reviewStyle.color === reviewStyle.expected);
    await page.screenshot({ path: `artifacts/planner-0.2-review-${theme}.png` });
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
  }
  checks.push('Review uses readable body-colored 15px text; pastel chips exceed 4.5:1 contrast in both themes');
  await page.evaluate(() => { document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light'); });
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 700, height: 800 });
  for (const mode of ['Activity', 'Report']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    const layout = await page.locator('.planner').evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
    assert(layout.content <= layout.width + 1, `${mode} overflows: ${JSON.stringify(layout)}`);
  }
  await page.screenshot({ path: 'artifacts/planner-0.2-narrow.png' });
  await page.setViewportSize(viewport ?? { width: 1024, height: 800 });
  checks.push('Day and Review fit a narrow pane without horizontal overflow');
  assert.deepEqual(errors, []);
  const report = { version: '0.2.49', checks, dayStyles, contrasts, errors };
  await writeFile('artifacts/planner-0.2-native-checks.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
