import { ownerVault } from './paths.mjs';
// Local development install: require the exact build exercised in the isolated vault.
import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
const root = ownerVault(), installed = `${root}/.obsidian/plugins/thejaz-planner`;
const runtime = ['main.js', 'manifest.json', 'styles.css'];
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const version = manifest.version;
assert.equal(manifest.id, 'thejaz-planner');
assert.equal(JSON.parse(await readFile(`${installed}/manifest.json`, 'utf8')).id, manifest.id);
assert.equal(version, JSON.parse(await readFile('package.json', 'utf8')).version);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const file of runtime) assert.equal(hash(await readFile(`dist/${file}`)), hash(await readFile(`.test-vault/.obsidian/plugins/thejaz-planner/${file}`)));
// A local update does not require creating a release archive. Verify it if present.
const zipPath = `artifacts/thejaz-planner-${version}.zip`;
const zipCheck = existsSync(zipPath) ? execFileSync('python', ['-c', `
import zipfile,pathlib,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 names={n for n in z.namelist() if not n.endswith('/')}
 assert names=={'thejaz-planner/'+n for n in ['main.js','manifest.json','styles.css','README.md','LICENSE','docs/maintaining.md']}
 for name in names:
  rel=name.removeprefix('thejaz-planner/')
  assert z.read(name)==(pathlib.Path('dist' if rel in ['main.js','manifest.json','styles.css'] else '.')/rel).read_bytes()
print('ZIP CRC, allowlist and byte comparisons passed')
`, zipPath], { encoding: 'utf8' }).trim() : 'No release ZIP requested; exact native-tested runtime verified directly';
const settings = JSON.parse(await readFile(`${installed}/data.json`, 'utf8'));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
const summaryPath = path.resolve(root, settings.summaryPath || 'thejaz-summary-now.md');
assert(summaryPath.toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep));
const protectedFiles = (await readdir(installed, { withFileTypes: true })).filter(file => file.isFile() && !runtime.includes(file.name)).map(file => `${installed}/${file.name}`);
protectedFiles.push(summaryPath);
for (const date of [today, yesterday.toISOString().slice(0, 10)]) {
 const file = `${root}/${date}.md`;
 try { await readFile(file); protectedFiles.push(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const before = new Map(await Promise.all(protectedFiles.map(async file => [file, hash(await readFile(file))])));
const backup = `artifacts/installed-backup-before-${version}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(backup, { recursive: true });
for (const file of runtime) await copyFile(`${installed}/${file}`, `${backup}/${file}`);
for (const file of runtime) await copyFile(`dist/${file}`, `${installed}/${file}`);
for (const file of runtime) assert.equal(hash(await readFile(`dist/${file}`)), hash(await readFile(`${installed}/${file}`)));
for (const [file, digest] of before) assert.equal(hash(await readFile(file)), digest, `Unexpected change: ${file}`);
const report = { version, backup, zipCheck, checkedUnchangedFiles: before.size, runtime: Object.fromEntries(await Promise.all(runtime.map(async file => [file, hash(await readFile(`${installed}/${file}`))]))), activation: 'Toggle THEJAZ Planner off/on; working app not reloaded here.' };
await writeFile(`artifacts/planner-${version}-install.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
