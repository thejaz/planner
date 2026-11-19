import { assertTestVault } from './paths.mjs';
// Close the isolated test window normally so Obsidian saves its state (a forced
// kill can discard the vault trust).
import { chromium } from 'playwright';
const b = await chromium.connectOverCDP('http://127.0.0.1:9237');
const page = b.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
await assertTestVault(page);
await page.evaluate(() => { setTimeout(() => window.close(), 100); });
await new Promise(r => setTimeout(r, 1000));
await b.close().catch(() => {});
console.log('closed');
