// Publish the current version to GitHub: `npm run release` (or `-- --dry-run` to check only).
// Local work never depends on this; it is the one deliberate step that pushes `main` and
// creates the GitHub release Obsidian installs from (main.js, manifest.json, styles.css).
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dryRun = process.argv.includes('--dry-run');
// Output shown in the terminal (stdio: 'inherit') is not returned, so it reads as ''.
const run = (cmd, args, options = {}) => (execFileSync(cmd, args, { encoding: 'utf8', ...options }) ?? '').trim();
const git = (...args) => run('git', args);
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const step = text => console.log(`- ${text}`);

// 1. A clean, committed main that agrees on one version.
assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'Release from main.');
assert.equal(git('status', '--porcelain'), '', 'Commit or set aside every change first; a release is exactly a commit.');
const manifest = json('manifest.json'), version = manifest.version;
assert.equal(json('package.json').version, version, 'package.json and manifest.json versions differ.');
assert.equal(json('package-lock.json').version, version, 'package-lock.json and manifest.json versions differ.');
assert.equal(json('versions.json')[version], manifest.minAppVersion, `versions.json needs "${version}": "${manifest.minAppVersion}".`);
step(`main is clean at ${git('rev-parse', '--short', 'HEAD')}; version ${version} agrees everywhere`);

// 2. A GitHub remote, and a version not released before.
let remote;
try { remote = git('remote', 'get-url', 'origin'); } catch { throw Error('No GitHub remote named origin. See docs/public-release.md.'); }
assert.equal(git('tag', '--list', version), '', `Tag ${version} already exists locally; bump the version first.`);
assert.equal(git('ls-remote', '--tags', 'origin', `refs/tags/${version}`), '', `${version} is already on GitHub; bump the version first.`);
step(`origin is ${remote}; ${version} is new`);

// 3. Lint, typecheck, tests and build, then the exact native-tested runtime.
execSync('npm run check', { stdio: 'inherit' });
const tested = '.test-vault/.obsidian/plugins/thejaz-planner/main.js';
assert(existsSync(tested), 'No native-tested build in .test-vault; run the isolated native checks first.');
assert.equal(hash('dist/main.js'), hash(tested), 'dist/main.js differs from the native-tested build; rerun the native checks on this build.');
for (const file of ['manifest.json', 'styles.css']) assert.equal(hash(`dist/${file}`), hash(file), `dist/${file} differs from source.`);
step('checks pass; dist/main.js is the build verified in the isolated vault');

// 4. Notes: the commit subjects since the previous release.
let previous = '';
try { previous = run('git', ['describe', '--tags', '--abbrev=0'], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* first release: no tag yet */ }
const subjects = git('log', '--format=- %s', previous ? `${previous}..HEAD` : 'HEAD');
const notes = previous ? `Changes since ${previous}:\n\n${subjects}\n` : `First public release.\n\n${subjects}\n`;
if (dryRun) { console.log(`\nDry run: would push main, tag ${version} and release it with these notes:\n\n${notes}`); process.exit(0); }

// 5. Push, tag and release.
run('git', ['push', 'origin', 'main'], { stdio: 'inherit' });
run('git', ['tag', '-a', version, '-m', `Planner ${version}`]);
run('git', ['push', 'origin', `refs/tags/${version}`], { stdio: 'inherit' });
const folder = mkdtempSync(path.join(os.tmpdir(), 'planner-release-')), notesFile = path.join(folder, 'notes.md');
try {
  writeFileSync(notesFile, notes);
  const url = run('gh', ['release', 'create', version, 'dist/main.js', 'dist/manifest.json', 'dist/styles.css',
    '--verify-tag', '--title', version, '--notes-file', notesFile]);
  step(`released ${url}`);
} finally { rmSync(folder, { recursive: true, force: true }); }
