import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('./lint/node_modules/eslint/bin/eslint.js', import.meta.url));
if (!existsSync(checker)) {
  console.error('Install the official checker with npm run setup:lint, then rerun npm run check.');
  process.exit(1);
}
const run = spawnSync(process.execPath, [checker, 'src', ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit'
});
if (run.error) throw run.error;
process.exit(run.status ?? 1);
