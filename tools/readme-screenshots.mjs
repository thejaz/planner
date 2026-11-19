// README screenshots from synthetic notes only. Run against a fresh isolated test vault
// (powershell -File tools/native-vault.ps1): this moves the vault's other dated notes to
// Obsidian's trash so the pictures show one tidy example week. Writes artifacts/readme-*.png;
// tools/compress-screenshots.py then writes the small copies in docs/images.
import { chromium } from 'playwright';
import { assertTestVault } from './paths.mjs';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
await assertTestVault(page);
const week = {
  '2026-03-02': ['STD = 150\nPRJ = 90', '- [x] 09:30 (150) : std\n- [x] 11:00 (90) : prj'],
  '2026-03-03': ['STD = 200\nGYM = 45', '- [x] 10:20 (200) : std\n- [x] 11:05 (45) : gym'],
  '2026-03-04': ['PRJ = 180', '- [x] 10:00 (180) : prj'],
  '2026-03-05': ['STD = 120\nPRJ = 60\nGYM = 30', '- [x] 09:00 (120) : std\n- [x] 10:00 (60) : prj\n- [x] 10:30 (30) : gym'],
  '2026-03-06': ['STD = 90', '- [x] 08:30 (90) : std']
};
const day = (title, footer, morning, afternoon = '', evening = '') =>
  `## plan for ${title}\n\n### morning\n${morning}\n\n### afternoon\n${afternoon}\n\n### evening\n${evening}\n\n---\n\n${footer}\n`;
await page.evaluate(async ({ week, today }) => {
  const c = app.plugins.plugins['thejaz-planner'].controller; await c.whenIdle();
  for (const f of app.vault.getMarkdownFiles().filter(f => /\d{4}-\d{2}-\d{2}/.test(f.basename) || /thejaz-criteria|thejaz-summary/i.test(f.path))) await app.vault.trash(f, false);
  Object.assign(c.settings, { autoUpdate: false, showMarkerCounts: false, projectCodes: ['STD', 'PRJ', 'GYM'],
    projectEmojis: { STD: '📚', PRJ: '🧭', GYM: '🏋️' }, projectGroups: [{ name: 'Study & work', projects: ['STD', 'PRJ'] }, { name: 'Health', projects: ['GYM'] }] });
  await c.saveSettings();
  for (const [date, [footer, rows]] of Object.entries(week)) await app.vault.create(`${date}.md`, `## plan for x\n\n### morning\n- [x] 07:00 (n/a) : awake\n${rows}\n\n---\n\n${footer}\nSUM = ${footer.match(/\d+/g).reduce((a, b) => a + Number(b), 0)}\n`);
  await app.vault.create('2026-03-07.md', today);
  // A summary with day markers, so Day records shows them beside each credit.
  await app.vault.create('thejaz-summary-now.md', ['### Days', '2026-03-02 = 240 ❄️', '2026-03-03 = 245 ❄️', '2026-03-04 = 180 ❄️ ☁️',
    '2026-03-05 = 210 ❄️', '2026-03-06 = 90 🦥 🕶️', '2026-03-07 = 340 🔥 ==new record==', '', '### Projects', 'STD = 800', 'PRJ = 430', 'GYM = 75', '',
    'Days (2026-03-01 - 2026-03-31)', ''].join('\n'));
  c.settings.summaryPath = 'thejaz-summary-now.md';
  c.now = () => ({ date: '2026-03-07', time: '15:10' });
  await c.index(); await c.whenIdle();
  app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
}, { week, today: day('7 mar 26', 'STD = 240\nPRJ = 100\nSUM = 340',
  '- [x] 06:30 (n/a) : awake\n- [x] 06:50 (20) : breakfast & news\n- [x] 09:20 (150) : std (chapter 4)\n- [x] 09:35 (15) : break\n- [x] 11:40 (100-25/125) : prj & email',
  '- [x] 12:30 (50) : lunch\n- [x] 14:00 (90) : std\n- [ ] 15:15 (75) : walk\n- [ ] 16:00 (45) : gym',
  '- [ ] 17:00 (60) : pottery\n- [ ] 18:30 (90) : prj') });
await page.setViewportSize({ width: 700, height: 1600 });
await page.evaluate(async () => {
  const v = await app.plugins.plugins['thejaz-planner'].open(); v.switchMode('day'); await v.navigate('2026-03-07');
  v.selected = -1; v.clearRowSelection(); v.paintSelection();
});
await page.waitForTimeout(400);
await page.evaluate(() => document.activeElement?.blur());
// Header to the end of the main view: the attention panel below is about this test vault, not the feature.
const capture = async path => {
  await page.mouse.move(0, 0); await page.waitForTimeout(600);
  const box = await page.evaluate(() => {
    const s = document.querySelector('.planner-shell').getBoundingClientRect(), m = document.querySelector('.planner-shell > main').getBoundingClientRect();
    return { x: s.x, y: s.y, width: s.width, height: m.bottom - s.y + 8 };
  });
  await page.screenshot({ path, clip: box });
};
await capture('artifacts/readme-activity.png');
await page.evaluate(() => {
  const v = app.workspace.getLeavesOfType('thejaz-planner')[0].view;
  v.preset = 'custom'; v.rangeStart = '2026-03-02'; v.rangeEnd = '2026-03-07'; v.recordsOpen = true; v.switchMode('review');
});
await page.waitForTimeout(400);
await capture('artifacts/readme-report.png');
await browser.close();
console.log('artifacts/readme-activity.png artifacts/readme-report.png');
