// One-time move of an installed plugin from the `plain-planner` ID to `thejaz-planner`.
// Usage: node tools/migrate-plugin-id.mjs [--vault <path>] [--backups <dir>] [--dry-run]
// Obsidian must not have the vault open. Everything touched is backed up first; the old
// folder goes to the Recycle Bin only after every copied file has been verified.
import { BACKUPS, OBSIDIAN_CONFIG, ownerVault } from './paths.mjs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OLD = 'plain-planner', NEW = 'thejaz-planner', RUNTIME = ['main.js', 'manifest.json', 'styles.css'];
const CONFIG_FILES = ['community-plugins.json', 'workspace.json', 'workspace-mobile.json', 'hotkeys.json'];
const args = process.argv.slice(2), dryRun = args.includes('--dry-run');
const option = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const vault = path.resolve(option('--vault') ?? ownerVault()), backups = path.resolve(option('--backups') ?? BACKUPS);
const config = path.join(vault, '.obsidian'), oldDir = path.join(config, 'plugins', OLD), newDir = path.join(config, 'plugins', NEW);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = text => { console.error(`Stopped, nothing changed: ${text}`); process.exit(1); };

async function files(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(full, base)); else out.push(path.relative(base, full));
  }
  return out;
}
/** Vault folders open in a running Obsidian, read from each running profile's vault list. */
function openVaults() {
  let lines = '';
  try {
    lines = execFileSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name = 'Obsidian.exe'\" | ForEach-Object { $_.CommandLine }"], { encoding: 'utf8' });
  } catch { fail('could not list running Obsidian windows to make sure the vault is closed.'); }
  const profiles = new Set();
  for (const line of lines.split(/\r?\n/).filter(Boolean)) {
    const dir = /--user-data-dir=("?)([^"]+?)\1(?:\s|$)/.exec(line)?.[2];
    profiles.add(path.resolve(dir ?? OBSIDIAN_CONFIG));
  }
  const open = [];
  for (const profile of profiles) {
    try {
      const vaults = JSON.parse(readFileSync(path.join(profile, 'obsidian.json'), 'utf8')).vaults ?? {};
      for (const entry of Object.values(vaults)) if (entry.open) open.push(path.resolve(entry.path));
    } catch { /* A profile without a vault list has no open vault. */ }
  }
  return open;
}
/** Rename the plugin in a JSON value: the ID itself, `ID:command` strings and keys. */
function renamed(value) {
  if (typeof value === 'string') return value === OLD ? NEW : value.startsWith(`${OLD}:`) ? NEW + value.slice(OLD.length) : value;
  if (Array.isArray(value)) return value.map(renamed);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [renamed(key), renamed(item)]));
  return value;
}

if (!existsSync(config)) fail(`${vault} has no .obsidian folder.`);
if (!existsSync(oldDir)) { if (existsSync(newDir)) { console.log(`Already moved: ${newDir} exists and ${OLD} does not.`); process.exit(0); } fail(`no ${OLD} plugin folder in ${vault}.`); }
if (existsSync(newDir)) fail(`both ${OLD} and ${NEW} folders exist; compare them by hand first.`);
const dist = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
if (dist.id !== NEW) fail(`dist/manifest.json has ID ${dist.id}; build the ${NEW} release first.`);
// A dry run changes nothing, so it may look while Obsidian is open; the real move may not.
const vaultOpen = openVaults().some(open => open.toLowerCase() === vault.toLowerCase());
if (vaultOpen && !dryRun) fail('Obsidian has this vault open. Close it and run again.');

const pluginFiles = await files(oldDir), carried = pluginFiles.filter(file => !RUNTIME.includes(file));
const configFiles = [];
for (const name of CONFIG_FILES) {
  const file = path.join(config, name);
  if (existsSync(file) && (await readFile(file, 'utf8')).includes(OLD)) configFiles.push(name);
}
const plan = { vault, from: oldDir, to: newDir, carried, runtime: RUNTIME.map(f => `dist/${f}`), rewrite: configFiles };
console.log(JSON.stringify({ plan, dryRun, obsidianOpen: vaultOpen }, null, 2));
if (dryRun && vaultOpen) console.log('Obsidian has this vault open: close it before the real move.');
if (dryRun) process.exit(0);

// 1. Back up the old folder and every settings file that will change, and verify the copies.
const backup = path.join(backups, `planner-id-migration-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const originals = new Map();
for (const file of pluginFiles) {
  const from = path.join(oldDir, file), to = path.join(backup, 'plugins', OLD, file), bytes = await readFile(from);
  await mkdir(path.dirname(to), { recursive: true }); await copyFile(from, to);
  if (hash(await readFile(to)) !== hash(bytes)) fail(`backup of ${file} does not match.`);
  originals.set(file, hash(bytes));
}
for (const name of configFiles) {
  const to = path.join(backup, 'config', name); await mkdir(path.dirname(to), { recursive: true });
  await copyFile(path.join(config, name), to);
  if (hash(await readFile(to)) !== hash(await readFile(path.join(config, name)))) fail(`backup of ${name} does not match.`);
}
// 2. Settings, recovery records and the index move unchanged; the runtime comes from the new build.
for (const file of carried) {
  const to = path.join(newDir, file); await mkdir(path.dirname(to), { recursive: true });
  await copyFile(path.join(oldDir, file), to);
  if (hash(await readFile(to)) !== originals.get(file)) fail(`copy of ${file} does not match; the old folder is untouched.`);
}
for (const file of RUNTIME) await copyFile(path.join('dist', file), path.join(newDir, file));
// 3. Obsidian's lists: enabled plugins, open tabs, hotkeys.
for (const name of configFiles) {
  const file = path.join(config, name), text = await readFile(file, 'utf8');
  const indent = /^[\t ]+/m.exec(text.split(/\r?\n/)[1] ?? '')?.[0] ?? '  ';
  const next = JSON.stringify(renamed(JSON.parse(text)), null, indent);
  if (next.includes(`"${OLD}`)) fail(`${name} still names ${OLD} after rewriting.`);
  await writeFile(file, next);
}
// 4. Only now retire the old folder, to the Recycle Bin so it can still be restored.
execFileSync('powershell', ['-NoProfile', '-Command',
  `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${oldDir.replace(/'/g, "''")}', 'OnlyErrorDialogs', 'SendToRecycleBin')`]);
if (existsSync(oldDir)) fail(`could not move ${oldDir} to the Recycle Bin; ${newDir} is ready, so remove the old folder by hand.`);
const report = { ...plan, backup, verified: carried.length, recycled: oldDir };
await mkdir('artifacts', { recursive: true });
await writeFile(`artifacts/plugin-id-migration-${path.basename(backup)}.json`, JSON.stringify(report, null, 2));
console.log(`Moved to ${NEW}. Backup: ${backup}`);
