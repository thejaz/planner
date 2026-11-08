import { OBSIDIAN_CONFIG, TEST_PROFILE, TEST_VAULT, ownerVault } from './paths.mjs';
import { mkdir, readdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const source = process.argv.includes('--copy-personal-vault') ? ownerVault() : null;
const target = TEST_VAULT, profile = TEST_PROFILE;
await mkdir(target, { recursive: true });
await mkdir(profile, { recursive: true });
async function copyDirectory(dir) {
  for (const entry of await readdir(path.join(source, dir), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir || /^(Ω |zArchives | _Codes$)/.test(entry.name) || entry.name === '_Codes') await copyDirectory(relative);
    } else if (/^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name) || relative.startsWith('_Codes') || relative.startsWith('zArchives ') || entry.name === '⌚.md') {
      const dest = path.join(target, relative);
      await mkdir(path.dirname(dest), { recursive: true });
      // Preserve ongoing test edits when the helper is rerun.
      try { await writeFile(dest, await readFile(path.join(source, relative)), { flag: 'wx' }); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
  }
}
if (process.argv.includes('--copy-personal-vault')) await copyDirectory('');
else {
  for (const name of await readdir('tests/fixtures')) if (name.endsWith('.md'))
    await writeFile(path.join(target, name), await readFile(path.join('tests/fixtures', name)));
  await mkdir(path.join(target, '_Codes'), { recursive: true });
  await writeFile(path.join(target, '_Codes/🌞 today is.md'), '## plan for {{date}}\n### morning\n- [ ] 09:00 (30) : chp\n### afternoon\n### evening\nCHP = 0\nSUM = 0\n');
  await writeFile(path.join(target, '⌚.md'), '### Days (2026-01-01 - 2026-12-31)\n### Projects\n🦉 CHP = 0\n🌍 MDR = 0\n### Bookmarks\nSynthetic test vault.\n');
}
const config = path.join(target, '.obsidian');
const plugin = path.join(config, 'plugins/thejaz-planner');
await mkdir(plugin, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css']) await copyFile(`dist/${name}`, path.join(plugin, name));
for (const [name, data] of Object.entries({
  'community-plugins.json': ['thejaz-planner'],
  'core-plugins.json': { 'file-explorer': true, 'command-palette': true, 'file-recovery': true },
  'app.json': { 'alwaysUpdateLinks': true },
  'appearance.json': { theme: 'moonstone', baseFontSize: 15 }
})) {
  try { await writeFile(path.join(config, name), JSON.stringify(data), { flag: 'wx' }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
}
const runtimeFolder = OBSIDIAN_CONFIG;
const runtime = (await readdir(runtimeFolder)).filter(name => /^obsidian-\d+\.\d+\.\d+\.asar$/.test(name))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1);
if (!runtime) throw new Error('No installed Obsidian runtime archive found.');
await copyFile(path.join(runtimeFolder, runtime), path.join(profile, runtime));
await writeFile(path.join(profile, 'obsidian.json'), JSON.stringify({
  vaults: { 'af1a2be3c4d5e678': { path: target, ts: Date.now(), open: true } }
}));
console.log(JSON.stringify({ vault: target, profile, plugin }));
