import {describe, it, expect} from 'vitest';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

function fixture() {
  const id = randomUUID(), root = path.resolve('.test-vault', `.joiner-synthetic-${id}`);
  const report = path.resolve('artifacts', `joiner-synthetic-${id}.json`);
  mkdirSync(path.join(root, '.obsidian/plugins/thejaz-planner'), {recursive:true});
  writeFileSync(path.join(root,'.obsidian/plugins/thejaz-planner/data.json'), JSON.stringify({projectCodes:['FRM','CHP'], projectGroups:[]}));
  const enabled = '[\n  "other-plugin",\n  "thejaz-planner"\n]\n';
  writeFileSync(path.join(root,'.obsidian/community-plugins.json'), enabled);
  const original = '\uFEFF## plan for 1 jan 26\r\n- [x] 18:25 (45/120) : frm (+15 chp)\r\n- [ ] 00:00 (260) : free (+30 chp)\r\nFRM = 45\r\nCHP = 15\r\nSUM = 60\r\nprose & annotations';
  writeFileSync(path.join(root,'2026-01-01.md'),original);
  const run = (...args:string[]) => spawnSync(process.execPath, ['tools/migrate-joiner.mjs','--vault',root,'--isolated','--report',report,...args],{encoding:'utf8'});
  return {root,report,original,enabled,run};
}
describe('offline migration storage', () => {
  it('dry run is read-only; apply disables old parser; rollback restores exact bytes and refuses conflicts', () => {
    const f=fixture(), note=path.join(f.root,'2026-01-01.md');
    const preview=f.run();expect(preview.status,preview.stderr).toBe(0);
    expect(readFileSync(note,'utf8')).toBe(f.original);
    expect(readFileSync(path.join(f.root,'.obsidian/community-plugins.json'),'utf8')).toBe(f.enabled);
    const applied=f.run('--apply','--expected-plan',f.report);expect(applied.status,applied.stderr).toBe(0);
    const result=JSON.parse(readFileSync(f.report,'utf8'));
    const migrated=f.original.replace('45/120) : frm (+15 chp)','45-15/120) : frm & chp').replace('260) : free (+30 chp)','230-30/260) : free & chp');
    expect(readFileSync(note,'utf8')).toBe(migrated);
    expect(JSON.parse(readFileSync(path.join(f.root,'.obsidian/community-plugins.json'),'utf8'))).toEqual(['other-plugin']);
    writeFileSync(note,migrated+'\nconcurrent change');
    expect(f.run('--rollback',result.backup).status).not.toBe(0);
    expect(readFileSync(note,'utf8')).toBe(migrated+'\nconcurrent change');
    writeFileSync(note,migrated);
    const restored=f.run('--rollback',result.backup);expect(restored.status,restored.stderr).toBe(0);
    expect(readFileSync(note,'utf8')).toBe(f.original);
    expect(readFileSync(path.join(f.root,'.obsidian/community-plugins.json'),'utf8')).toBe(f.enabled);
  },30000);
  it('refuses a stale reviewed plan before writing any note or settings', () => {
    const f=fixture();expect(f.run().status).toBe(0);
    writeFileSync(path.join(f.root,'new.md'),'new source');
    expect(f.run('--apply','--expected-plan',f.report).status).not.toBe(0);
    expect(readFileSync(path.join(f.root,'2026-01-01.md'),'utf8')).toBe(f.original);
    expect(readFileSync(path.join(f.root,'.obsidian/community-plugins.json'),'utf8')).toBe(f.enabled);
  },30000);
});
