// Release gate. Usage: node tools/release-audit.mjs [--private] [--package]
//   --private  require the read-only owner-vault audits (vault-audit, reference-audit).
//   --package  also create and verify the installable ZIP; only when the owner asked for one.
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const args = new Set(process.argv.slice(2));
const hash = value => createHash('sha256').update(value).digest('hex');
const exists = file => access(file).then(() => true, () => false);
const checks = [];
await mkdir('artifacts', { recursive: true });

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(manifest.version, pkg.version, 'Package and manifest versions differ');
assert.equal(lock.version, pkg.version, 'Lockfile version differs');
checks.push(`package.json, package-lock.json and manifest.json agree on ${manifest.version}`);
const versions = JSON.parse(await readFile('versions.json', 'utf8'));
assert.equal(versions[manifest.version], manifest.minAppVersion, 'versions.json lacks the current version and minAppVersion');
checks.push(`versions.json maps ${manifest.version} to Obsidian ${manifest.minAppVersion}`);

execFileSync(process.execPath, ['tools/lint.mjs'], { stdio: 'pipe' });
checks.push('Official Obsidian recommended lint checks pass; reviewed advisory warnings are documented in docs/debug-checks.md');

const before = hash(await readFile('dist/main.js'));
execFileSync(process.execPath, ['tools/build.mjs'], { stdio: 'pipe' });
const rebuilt = hash(await readFile('dist/main.js'));
assert.equal(before, rebuilt, 'Repeated build differs');
for (const file of ['manifest.json', 'styles.css'])
  assert.equal(hash(await readFile(`dist/${file}`)), hash(await readFile(file)), `dist/${file} differs from source`);
checks.push('Repeated production builds are byte-identical; dist manifest and styles match source');
assert.equal(rebuilt, hash(await readFile('.test-vault/.obsidian/plugins/thejaz-planner/main.js')), 'Native-tested build differs');
checks.push('Built JavaScript matches the build installed in the isolated native vault');

execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json', '--outputFile=artifacts/unit-tests.json'], { stdio: 'pipe' });
const unit = JSON.parse(await readFile('artifacts/unit-tests.json', 'utf8'));
assert(unit.success && unit.numFailedTests === 0 && unit.numTotalTests > 0, 'Unit tests failed');
checks.push(`${unit.numPassedTests} of ${unit.numTotalTests} automated tests pass in ${unit.numTotalTestSuites ?? unit.testResults.length} files`);

const required = ['obsidian-smoke', 'obsidian-interactions', 'obsidian-reliability', 'obsidian-performance', 'obsidian-restart', 'obsidian-release-check'];
const present = (await readdir('artifacts')).filter(name => /^obsidian-.*\.json$/.test(name) && !name.endsWith('-failure.json')).map(name => name.slice(0, -5));
for (const name of required) assert(present.includes(name), `Native report artifacts/${name}.json is missing`);
for (const name of present) {
  const report = JSON.parse(await readFile(`artifacts/${name}.json`, 'utf8'));
  assert(!report.errors?.length, `${name} has errors`);
  assert((report.checks ?? report.passed)?.length, `${name} has no verified cases`);
}
checks.push(`${present.length} native evidence reports have verified cases and no reported errors`);

const privateAudits = args.has('--private') || await exists('artifacts/vault-audit.json');
if (privateAudits) {
  const vault = JSON.parse(await readFile('artifacts/vault-audit.json', 'utf8'));
  assert(vault.files > 0, 'Vault audit read no daily notes');
  assert.deepEqual(vault.originalPlanningFilesChangedSinceBaseline, []);
  const reference = JSON.parse(await readFile('artifacts/reference-audit.json', 'utf8'));
  assert.deepEqual(reference.differences, []);
  checks.push(`Owner-vault audit: ${vault.files} daily notes read, planning files match their baseline hashes, reference calculation matches`);
} else checks.push('Owner-vault audits not run (pass --private to require them)');

let archive = null, archiveSha256 = null, packaged = null;
if (args.has('--package')) {
  execFileSync(process.execPath, ['tools/package.mjs'], { stdio: 'pipe' });
  archive = `artifacts/thejaz-planner-${manifest.version}.zip`;
  packaged = JSON.parse(execFileSync('python', ['-I', '-c', `
import zipfile, hashlib, json, pathlib, sys
with zipfile.ZipFile(sys.argv[1]) as z:
    names = [n for n in z.namelist() if not n.endswith('/')]
    expected = {'thejaz-planner/' + n for n in ['main.js','manifest.json','styles.css','README.md','LICENSE','docs/maintaining.md']}
    assert set(names) == expected, names
    checks = {}
    for name in names:
        short = name.removeprefix('thejaz-planner/')
        source = pathlib.Path('dist' if short in ['main.js','manifest.json','styles.css'] else '.') / short
        assert z.read(name) == source.read_bytes(), name
        checks[name] = hashlib.sha256(z.read(name)).hexdigest()
    assert z.testzip() is None
    print(json.dumps(checks))
`, archive], { encoding: 'utf8' }));
  archiveSha256 = hash(await readFile(archive));
  checks.push('ZIP passes CRC validation and contains exactly six approved non-personal files');
} else checks.push('No archive created (pass --package when an installable ZIP was requested)');

const sourceFiles = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await walk(file);
    else sourceFiles.push({ file, sha256: hash(await readFile(file)) });
  }
}
await walk('src');
const report = { created: new Date().toISOString(), version: manifest.version, sourceFiles, checks,
  mainSha256: rebuilt, archive, archiveSha256, packaged };
await writeFile('artifacts/release-audit.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
