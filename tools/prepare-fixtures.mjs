// Synthetic examples only. This helper never reads an owner's vault.
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('tests/fixtures', { recursive: true });
const cases = {
  '2026-10-15': { NVE: 5, FRM: 10, CHP: 15, JIB: 20, ORG: 25, ZOT: 30 },
  '2026-10-16': { NVE: 30 },
  '2026-10-17': { MDR: 10, FRM: 20, CHP: 30, JIB: 40 },
  '2026-10-18': { CHP: 15, JIB: 45 },
  '2026-10-19': { MDR: 20, CHP: 40 }
};
for (const [date, projects] of Object.entries(cases)) {
  let clock = 480;
  const rows = [`## plan for ${+date.slice(8)} oct 26`, '', 'Synthetic planning example.', '', '### morning', '- [x] 08:00 (n/a) : example start'];
  for (const [code, amount] of Object.entries(projects)) {
    clock += amount;
    const time = `${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}`;
    rows.push(`- [x] ${time} (${amount}) : ${code.toLowerCase()}`);
  }
  while (rows.filter(row => row.startsWith('- [')).length < 6) rows.push('- [ ] ?');
  rows.push('', '### afternoon', '', '### evening', '', '---', '');
  for (const [code, amount] of Object.entries(projects)) rows.push(`${code} = ${amount}`);
  rows.push(`SUM = ${Object.values(projects).reduce((a, b) => a + b, 0)}`, '');
  await writeFile(`tests/fixtures/${date}.md`, rows.join('\n'));
}
await writeFile('tests/fixtures/2026-10-20.md', '## plan for 20 oct 26\n\nSynthetic split/plan example.\n\n### morning\n- [x] 08:00 (n/a) : example start\n- [x] 08:20 (20) : chp\n- [ ] 11:30 (95-95/190) : chp & mdr\n\n**CHP = 20**\nSUM = 20\n');
await writeFile('tests/fixtures/2025-01-05.md', '# Synthetic historical example\n- [x] **09:00 - 09:20 (20m)**: CHP\nTotal CHP Time: 20m\nTotal IRP Time: 205m\nTotal Time: 225m\n');
await writeFile('tests/fixtures/2024-06-21.md', '# Synthetic aggregate-only example\n- [x] **09:00 - 09:30 (30m)**: Example activity\nTotal Study Time: 175m\n');
await writeFile('tests/fixtures/2025-02-26.md', '# Synthetic named-total example\nTotal CHP Time: 70m\n');
console.log('Generated nine synthetic fixtures; no personal notes were read.');
