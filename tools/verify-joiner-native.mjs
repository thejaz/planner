// Read-only toward owner notes. Applies only to hidden copies in the test vault.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {WORKSPACE,TEST_VAULT,assertTestVault} from './paths.mjs';
const sourceReport=path.resolve(process.argv[2]??'artifacts/joiner-owner-preview.json');
const source=JSON.parse(await readFile(sourceReport,'utf8'));
const stageName='.joiner-owner-copy-'+randomUUID(),stage=path.join(TEST_VAULT,stageName);
const report=path.join(WORKSPACE,'artifacts',stageName+'.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const file of [...new Set([...source.changes.map(c=>c.name),...Object.keys(source.controls)])]) {
 const target=path.join(stage,file);await mkdir(path.dirname(target),{recursive:true});
 const original=path.join(source.root,file);
 assert.equal(hash(await readFile(original)),source.inventory[file]??source.controls[file]);
 await copyFile(original,target);
}
function run(args) {
 return execFileSync(process.execPath,['tools/migrate-joiner.mjs','--vault',stage,'--isolated','--codes-file',sourceReport,'--report',report,...args],{cwd:WORKSPACE,encoding:'utf8'});
}
run([]);run(['--apply','--expected-plan',report]);
const result=JSON.parse(await readFile(report,'utf8'));
const copyRows=result.changes.filter(c=>c.patches.length),sourceRows=source.changes.filter(c=>c.patches.length);
assert.deepEqual(copyRows,sourceRows,'Copied patches differ from owner preview');
const browser=await chromium.connectOverCDP('http://127.0.0.1:9237');
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/'));
assert(page,'No isolated Obsidian page');await assertTestVault(page);
let readbacks=0;
try {
 for(const file of copyRows) {
  const seen=await page.evaluate(async name=>app.vault.adapter.read(name),stageName+'/'+file.name);
  assert.equal(hash(Buffer.from(seen)),file.after,'Native adapter differs: '+file.name);readbacks++;
 }
} finally {await browser.close();}
run(['--rollback',result.backup]);
for(const file of source.changes)assert.equal(hash(await readFile(path.join(stage,file.name))),file.before,'Copy rollback differs');
const evidence={time:new Date().toISOString(),stage,readbacks,lines:source.lines,extraRows:source.extraRows,patchesMatch:true,rollbackExact:true,ownerWrites:false};
await writeFile(path.join(result.backup,'native-verification.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({...evidence,evidence:result.backup},null,2));
