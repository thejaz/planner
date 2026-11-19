// Machine-specific paths for the development tools. Personal values live in the
// gitignored planner.local.json at the repository root (see planner.local.example.json);
// everything else is derived from this repository or the standard Obsidian install.
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_VAULT = path.join(WORKSPACE, '.test-vault');
export const TEST_PROFILE = path.join(WORKSPACE, '.test-profile');
const localFile = path.join(WORKSPACE, 'planner.local.json');
const local = existsSync(localFile) ? JSON.parse(readFileSync(localFile, 'utf8')) : {};

/** The working vault that owner tools read or update; never guessed. */
export function ownerVault() {
  if (!local.vault) throw Error(`Set "vault" in ${localFile} (see planner.local.example.json).`);
  return path.resolve(local.vault);
}
/** Where owner tools keep backups before changing notes or the installed plugin. */
export const BACKUPS = path.resolve(local.backups ?? path.join(os.homedir(), '.planner-backups'));
export const OBSIDIAN_EXE = local.obsidianExe ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Obsidian', 'Obsidian.exe');
export const OBSIDIAN_CONFIG = local.obsidianConfig ?? path.join(process.env.APPDATA ?? '', 'obsidian');

const slashes = value => value.replaceAll('\\', '/');
/** Native helpers only run against the isolated test vault. */
export async function assertTestVault(page) {
  const base = await page.evaluate(() => app.vault.adapter.getBasePath());
  if (slashes(base) !== slashes(TEST_VAULT)) throw Error(`Refusing a non-test vault: ${base}`);
}
