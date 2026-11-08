import * as esbuild from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
const options = {
  entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian'],
  format: 'cjs', platform: 'browser', target: 'es2022', outfile: 'dist/main.js',
  minify: !process.argv.includes('--watch'), sourcemap: false,
  logLevel: 'info'
};
for (const file of ['manifest.json', 'styles.css']) await copyFile(file, `dist/${file}`);
if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else await esbuild.build(options);
