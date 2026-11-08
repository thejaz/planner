import { ownerVault } from './paths.mjs';
import { build } from 'esbuild';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
await mkdir('artifacts', { recursive: true });
await build({ entryPoints: ['src/core/reader.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'artifacts/reader-audit.mjs' });
const { parseDay, calculate, effectiveTotals } = await import('../artifacts/reader-audit.mjs?time=' + Date.now());
// --vault <dir> audits another copy; --out <file> names the report (default artifacts/vault-audit.json).
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const root = arg('--vault') ?? ownerVault(), out = arg('--out') ?? 'artifacts/vault-audit.json';
const records = [], kinds = {}, conflicts = [], blockages = [], hashChanges = [];
// The hash baseline is optional; without it no file is reported as changed.
const baseline = await readFile('artifacts/original-vault-baseline.json', 'utf8').then(JSON.parse, () => null);
const hashMap = new Map((baseline ?? []).map(r => [r.path.replaceAll('\\', '/'), r.sha256]));
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (entry.name.endsWith('.md')) {
      const bytes = await readFile(file), raw = bytes.toString('utf8');
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (baseline && hashMap.get(file.replaceAll('\\', '/')) !== hash) hashChanges.push(path.relative(root, file));
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name)) continue;
      const day = parseDay(raw, path.relative(root, file)), effective = effectiveTotals(day);
      if (day.text !== raw) throw Error('Reader changed original text');
      for (const diagnostic of day.diagnostics) {
        kinds[diagnostic.code] = (kinds[diagnostic.code] ?? 0) + 1;
        if (diagnostic.blocks) blockages.push({ date: day.date, ...diagnostic });
        if (diagnostic.code === 'total-conflict') conflicts.push({ date: day.date, message: diagnostic.message });
      }
      records.push({ date: day.date, path: day.path, projects: effective.projects, total: effective.sum,
        computed: calculate(day).sum, unallocated: effective.unallocated, legacy: day.legacy });
    }
  }
}
await scan(root);
records.sort((a, b) => a.date.localeCompare(b.date));
const counts = new Map();
for (const record of records) counts.set(record.date, (counts.get(record.date) ?? 0) + 1);
const output = {
  files: records.length, first: records[0].date, last: records.at(-1).date,
  legacyFiles: records.filter(r => r.legacy).length,
  duplicateDates: [...counts].filter(([, count]) => count > 1),
  originalFilesChangedSinceBaseline: hashChanges,
  originalPlanningFilesChangedSinceBaseline: hashChanges.filter(p =>
    /^\d{4}-\d{2}-\d{2}\.md$/.test(path.basename(p)) || p === '⌚.md' || p.startsWith('_Codes') || p.startsWith('zArchives ')),
  chpMinutes: records.reduce((sum, r) => sum + (r.projects.CHP ?? 0), 0),
  unknownDayTotals: records.filter(r => r.total === null).map(r => r.date),
  diagnostics: kinds, blockages, conflicts, records
};
await writeFile(out, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ ...output, records: undefined, blockages: blockages.slice(0, 12), conflicts: conflicts.slice(0, 5) }, null, 2));
