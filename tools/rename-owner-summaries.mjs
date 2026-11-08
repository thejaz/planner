import { ownerVault } from './paths.mjs';
// Explicit, bounded owner-vault migration. Default invocation is a read-only preflight.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, lstat, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const root = ownerVault();
const apply = process.argv.includes('--apply');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { outputFiles } = await build({ entryPoints: ['src/core/history.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { parseSummary } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
const dataPath = '.obsidian/plugins/thejaz-planner/data.json', dataBytes = await readFile(path.join(root, dataPath));
const settings = JSON.parse(dataBytes.toString('utf8'));
assert.equal(settings.summaryPath, '⌚.md', 'Expected original active summary; migration is not needed or the configuration changed.');
const names = (await readdir(path.join(root, 'zArchives ⚙'))).filter(name => /^⌚ - \d{2}-\d{2}-\d{2} -- \d{2}-\d{2}-\d{2}\.md$/.test(name));
assert.equal(names.length, 6, 'Review the archive inventory before changing the expected migration scope.');
const mappings = [{ from: '⌚.md', to: 'thejaz-summary-now.md' }, ...names.map(name => {
  const m = /^⌚ - (\d{2})-(\d{2})-(\d{2}) -- (\d{2})-(\d{2})-(\d{2})\.md$/.exec(name);
  return { from: `zArchives ⚙/${name}`, to: `zArchives ⚙/20${m[1]}-${m[2]}-${m[3]}--20${m[4]}-${m[5]}-${m[6]}-thejaz-summary.md` };
})];
const safe = relative => {
  const absolute = path.resolve(root, relative), within = path.relative(path.resolve(root), absolute);
  assert(within && !within.startsWith('..') && !path.isAbsolute(within), 'Path leaves the owner vault'); return absolute;
};
const sameSummary = summary => ({ start: summary.start, end: summary.end, rows: summary.rows, projects: summary.projects, thresholds: summary.thresholds });
for (const item of mappings) {
  const source = safe(item.from), target = safe(item.to);
  assert(!(await lstat(source)).isSymbolicLink());
  assert.equal(path.dirname(source), path.dirname(target));
  await assert.rejects(lstat(target), { code: 'ENOENT' });
  item.bytes = await readFile(source); item.sha256 = hash(item.bytes);
  const before = parseSummary(item.bytes.toString('utf8'), item.from), after = parseSummary(item.bytes.toString('utf8'), item.to);
  assert(before.start && before.end, `Missing period: ${item.from}`);
  assert.deepEqual(sameSummary(before), sameSummary(after), `Rename changes interpretation: ${item.from}`);
  item.period = [before.start, before.end]; item.rows = before.rows.length;
}
const mapped = target => {
  const item = mappings.find(item => [item.from, item.from.replace(/\.md$/, ''), path.basename(item.from), path.basename(item.from, '.md')].includes(target));
  if (!item) return null;
  const result = target.includes('/') ? item.to : path.basename(item.to);
  return target.endsWith('.md') ? result : result.replace(/\.md$/, '');
};
const edits = [];
async function walkNotes(relative = '') {
  for (const file of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (file.name.startsWith('.') || file.isSymbolicLink()) continue;
    const name = relative ? `${relative}/${file.name}` : file.name;
    if (file.isDirectory()) { await walkNotes(name); continue; }
    if (!file.name.endsWith('.md')) continue;
    const before = await readFile(safe(name)), text = before.toString('utf8');
    const after = text.replace(/(!?\[\[)([^\]\r\n]+)(\]\])/g, (whole, open, body, close) => {
      const cut = body.search(/[|#]/), target = cut < 0 ? body : body.slice(0, cut);
      const next = mapped(target); return next ? open + next + (cut < 0 ? '' : body.slice(cut)) + close : whole;
    }).replace(/(\]\()([^\s)]+)(\))/g, (whole, open, body, close) => {
      let target; try { target = decodeURIComponent(body); } catch { return whole; }
      const cut = target.indexOf('#'), file = cut < 0 ? target : target.slice(0, cut), next = mapped(file);
      if (!next) return whole;
      const replacement = next + (cut < 0 ? '' : target.slice(cut));
      return open + (body.includes('%') ? encodeURI(replacement) : replacement) + close;
    });
    if (after !== text) edits.push({ file: name, before, after: Buffer.from(after, 'utf8'), kind: 'note links' });
  }
}
await walkNotes();
// Keep saved bookmarks/workspace paths consistent, without touching other fields.
for (const file of await readdir(path.join(root, '.obsidian'))) {
  if (!file.endsWith('.json')) continue;
  const relative = `.obsidian/${file}`, before = await readFile(safe(relative));
  const text = before.toString('utf8');
  let changed = false;
  const after = text.replace(/"(?:[^"\\]|\\.)*"/g, token => {
    let value; try { value = JSON.parse(token); } catch { return token; }
    const next = typeof value === 'string' ? mappings.find(item => item.from === value)?.to : undefined;
    if (!next) return token; changed = true; return JSON.stringify(next);
  });
  if (changed) { JSON.parse(after); edits.push({ file: relative, before, after: Buffer.from(after), kind: 'saved note paths' }); }
}
const nextSettings = { ...settings, summaryPath: 'thejaz-summary-now.md' };
for (const item of mappings) if (settings.markerSourcePath === item.from) nextSettings.markerSourcePath = item.to;
edits.push({ file: dataPath, before: dataBytes, after: Buffer.from(JSON.stringify(nextSettings, null, 2)), kind: 'summary settings' });
const report = { applied: false, files: mappings.map(({ from, to, sha256, period, rows }) => ({ from, to, sha256, period, rows })), edits: edits.map(({ file, kind }) => ({ file, kind })) };
if (!apply) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
const evidence = process.argv[process.argv.indexOf('--evidence') + 1];
assert(process.argv.includes('--evidence') && evidence && path.isAbsolute(evidence), 'Specify an absolute new recovery evidence directory.');
await mkdir(evidence); // Refuse to overwrite recovery evidence.
for (const item of [...mappings.map(item => ({ file: item.from, before: item.bytes })), ...edits]) {
  const dest = path.join(evidence, 'before', item.file); await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, item.before, { flag: 'wx' }); assert.equal(hash(await readFile(dest)), hash(item.before));
}
for (const item of mappings) assert.equal(hash(await readFile(safe(item.from))), item.sha256, 'Summary changed since preflight');
for (const edit of edits) assert.equal(hash(await readFile(safe(edit.file))), hash(edit.before), 'Referenced file changed since preflight');
const moved = [], written = [];
try {
  for (const item of mappings) { await rename(safe(item.from), safe(item.to)); moved.push(item); }
  for (const edit of edits) {
    const file = mappings.find(item => item.from === edit.file)?.to ?? edit.file;
    assert.equal(hash(await readFile(safe(file))), hash(edit.before), 'Concurrent edit detected');
    await writeFile(safe(file), edit.after); written.push({ ...edit, target: file });
  }
  for (const item of mappings) {
    const edited = written.find(edit => edit.target === item.to);
    assert.equal(hash(await readFile(safe(item.to))), edited ? hash(edited.after) : item.sha256);
    await assert.rejects(lstat(safe(item.from)), { code: 'ENOENT' });
  }
  const saved = JSON.parse(await readFile(safe(dataPath), 'utf8'));
  assert.deepEqual(saved, nextSettings);
  for (const edit of written) assert.equal(hash(await readFile(safe(edit.target))), hash(edit.after), 'Saved references changed during migration');
  report.applied = true;
} catch (error) {
  for (const edit of written.reverse()) if (hash(await readFile(safe(edit.target))) === hash(edit.after)) await writeFile(safe(edit.target), edit.before);
  for (const item of moved.reverse()) {
    await assert.rejects(lstat(safe(item.from)), { code: 'ENOENT' });
    if (hash(await readFile(safe(item.to))) === item.sha256) await rename(safe(item.to), safe(item.from));
  }
  await writeFile(path.join(evidence, 'failure.txt'), String(error)); throw error;
}
await writeFile(path.join(evidence, 'migration.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
