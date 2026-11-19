import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.version !== pkg.version) throw Error('Package and manifest versions differ');
const folder = path.resolve(`artifacts/package/thejaz-planner`);
await mkdir(path.join(folder, 'docs'), { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(`dist/${file}`, path.join(folder, file));
for (const file of ['README.md', 'LICENSE']) await copyFile(file, path.join(folder, file));
await copyFile('docs/maintaining.md', path.join(folder, 'docs/maintaining.md'));
const zip = path.resolve(`artifacts/thejaz-planner-${manifest.version}.zip`);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `Compress-Archive -LiteralPath ${quote(folder)} -DestinationPath ${quote(zip)} -Force`], { stdio: 'inherit' });
const sha256 = createHash('sha256').update(await readFile(zip)).digest('hex');
await writeFile(`${zip}.sha256`, `${sha256}  ${path.basename(zip)}\n`);
console.log(JSON.stringify({ archive: zip, sha256 }));
