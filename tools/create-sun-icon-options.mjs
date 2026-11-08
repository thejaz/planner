import { mkdir, readdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setDefaultResultOrder } from 'node:dns';
import { chromium } from 'playwright';

// Review assets only. This tool never changes the installed plugin or notes.
setDefaultResultOrder('ipv4first');
const folder = resolve('design/icon-options/sun');
const desktop = process.argv[2];
if (!desktop) throw Error('Pass the explicit Desktop output folder.');
await mkdir(join(folder, 'reference'), { recursive: true });
try { await mkdir(desktop, { recursive: false }); }
catch (error) { if (error.code !== 'EEXIST' || (await readdir(desktop)).length) throw error; }
const sourceURL = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Sun%20with%20face/High%20Contrast/sun_with_face_high_contrast.svg';
const licenseURL = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/LICENSE';
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`${response.status}: ${url}`);
  return response.text();
}
const [original, license] = await Promise.all([download(sourceURL), download(licenseURL)]);
await writeFile(join(folder, 'reference/microsoft-sun-with-face.svg'), original);
const paths = [...original.matchAll(/<path\s+d="([^"]+)"/g)].map(m => m[1]);
if (paths.length !== 6) throw Error('Microsoft source changed; inspect it before adapting.');

const star = (points, outer, inner) => Array.from({ length: points * 2 }, (_, i) => {
  const a = -Math.PI / 2 + i * Math.PI / points, radius = i % 2 ? inner : outer;
  return `${i ? 'L' : 'M'}${(12 + Math.cos(a) * radius).toFixed(3)} ${(12 + Math.sin(a) * radius).toFixed(3)}`;
}).join(' ') + ' Z';
const svg = (name, body, notice = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${name}">\n  <title>${name}</title>\n${notice}${body}\n</svg>\n`;
const face = `<circle cx="10.15" cy="11.15" r="0.58" fill="currentColor" stroke="none"/>\n  <circle cx="13.85" cy="11.15" r="0.58" fill="currentColor" stroke="none"/>\n  <path d="M10.05 13.25 Q12 15.3 13.95 13.25" stroke-width="1.25"/>`;
const rays = Array.from({ length: 8 }, (_, i) => {
  const a = i * Math.PI / 4;
  return `M${(12 + Math.cos(a) * 8.15).toFixed(3)} ${(12 + Math.sin(a) * 8.15).toFixed(3)} L${(12 + Math.cos(a) * 10).toFixed(3)} ${(12 + Math.sin(a) * 10).toFixed(3)}`;
}).join(' ');
const icons = [
  { name: '01-classic-sun.svg', title: 'Classic', subtitle: 'Closest to your Windows reference', body: svg('Classic smiling sun', `  <path d="${star(12, 10, 7.7)}"/>\n  <circle cx="12" cy="12" r="5.5"/>\n  ${face}`) },
  { name: '02-minimal-sun.svg', title: 'Minimal', subtitle: 'Open rays · light, familiar outline', body: svg('Minimal smiling sun', `  <path d="${rays}" stroke-width="1.75"/>\n  <circle cx="12" cy="12" r="5.75" stroke-width="1.65"/>\n  ${face}`) },
  { name: '03-microsoft-sun.svg', title: 'Soft', subtitle: 'Refined Microsoft monochrome sun', body: svg('Soft smiling sun adapted from Microsoft Fluent Emoji', `  <g data-source="microsoft" fill="currentColor" stroke="none">\n${[paths[1], paths[3], paths[4], paths[5]].map(d => `    <path d="${d}"/>`).join('\n')}\n  </g>`, '  <!-- Adapted from Microsoft Fluent Emoji. Copyright Microsoft Corporation; MIT. See Microsoft-LICENSE.txt. -->\n') }
];
// Normalize actual painted bounds, including stroke width, to a centered 21px
// square. This leaves safe padding at every ribbon and tab icon size.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 900 }, deviceScaleFactor: 2 });
  const metrics = [];
  for (const icon of icons) {
    await page.setContent(icon.body);
    const bounds = await page.locator('svg').evaluate(svg => {
      const els = [...svg.querySelectorAll('path,circle')];
      const all = els.map(el => {
        const b = el.getBBox(), stroke = getComputedStyle(el).stroke === 'none' ? 0 : parseFloat(getComputedStyle(el).strokeWidth) / 2;
        return { x: b.x - stroke, y: b.y - stroke, right: b.x + b.width + stroke, bottom: b.y + b.height + stroke };
      });
      return { x: Math.min(...all.map(b => b.x)), y: Math.min(...all.map(b => b.y)), right: Math.max(...all.map(b => b.right)), bottom: Math.max(...all.map(b => b.bottom)) };
    });
    // Each design is centered from its true geometry, including the asymmetric
    // Microsoft source. Uniform scaling preserves its intended proportions.
    const scale = 21 / Math.max(bounds.right - bounds.x, bounds.bottom - bounds.y);
    const tx = 12 - (bounds.x + bounds.right) * scale / 2;
    const ty = 12 - (bounds.y + bounds.bottom) * scale / 2;
    icon.body = icon.body.replace(/(<title>[^<]+<\/title>\n)/, `$1  <g transform="translate(${tx.toFixed(6)} ${ty.toFixed(6)}) scale(${scale.toFixed(6)})">\n`).replace('</svg>', '  </g>\n</svg>');
    // data-source is authoring information, unnecessary in the delivered icon.
    icon.body = icon.body.replace(' data-source="microsoft"', '');
    await writeFile(join(folder, icon.name), icon.body);
    await copyFile(join(folder, icon.name), join(desktop, icon.name));
    metrics.push({ file: icon.name, bounds, scale, center: [12, 12], paintedSize: 21 });
  }
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sun icon alternatives</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f4f5;color:#24232a;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}.page{max-width:1100px;margin:0 auto;padding:44px 42px 34px}header{margin-bottom:28px}h1{font-size:27px;letter-spacing:-.7px;margin:0 0 6px;font-weight:650}p{margin:0;color:#696771}.options{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.option{background:#fff;border:1px solid #e3e2e7;border-radius:14px;overflow:hidden}.name{padding:19px 20px 10px}h2{margin:0 0 2px;font-size:17px;font-weight:650}.subtitle{font-size:12px;color:#73717b;min-height:36px}.large{height:124px;display:flex;align-items:center;justify-content:center}.large svg{width:84px;height:84px}.sizes{display:flex;align-items:center;justify-content:center;gap:25px;padding:10px 15px 18px}.sample{text-align:center}.sample span{display:block;color:#817e89;font-size:10px;margin-top:7px}.sample svg{display:block;margin:auto}.dark{background:#25242b;color:#e7e5ed;padding:18px 16px}.dark .sizes{padding:0}.dark .sample span{color:#b0aab9}.filename{padding:12px 18px;border-top:1px solid #eeedf1;font:11px/1.4 ui-monospace,Consolas,monospace;color:#64616f;overflow-wrap:anywhere}footer{margin-top:22px;color:#75717f;font-size:12px}a{color:inherit;text-underline-offset:3px}svg{flex-shrink:0}@media(max-width:760px){.page{padding:25px 18px}.options{grid-template-columns:1fr}.subtitle{min-height:0}}
  </style><div class="page"><header><h1>Three sun icons</h1><p>Centered, monochrome SVG · transparent background · light and dark previews</p></header><div class="options">${icons.map((icon, i) => `<article class="option"><div class="name"><h2>0${i + 1} / ${icon.title}</h2><div class="subtitle">${icon.subtitle}</div></div><div class="large">${icon.body}</div>${['light', 'dark'].map(theme => `<div class="${theme}"><div class="sizes">${[16, 20, 24, 32].map(size => `<div class="sample">${icon.body.replace('width="24" height="24"', `width="${size}" height="${size}"`)}<span>${size}px</span></div>`).join('')}</div></div>`).join('')}<div class="filename"><a href="${icon.name}">${icon.name}</a></div></article>`).join('')}</div><footer>Review concepts for THEJAZ Planner. Options 01 and 02 are original vector drawings; option 03 adapts Microsoft's <a href="https://github.com/microsoft/fluentui-emoji/tree/main/assets/Sun%20with%20face">Fluent Emoji sun</a> (MIT), with eyebrows removed, theme-aware color and centered geometry. The current plugin icon is unchanged.</footer></div></html>`;
  await writeFile(join(folder, 'Preview.html'), html);
  await writeFile(join(folder, 'Microsoft-LICENSE.txt'), license);
  await writeFile(join(folder, 'README.md'), `# Sun SVG alternatives\n\nOpen Preview.html to compare 16, 20, 24 and 32 pixel rendering on light and dark backgrounds.\n\n- 01-classic-sun.svg: an original twelve-point sun inspired by the supplied Windows emoji reference.\n- 02-minimal-sun.svg: an original circular face with eight separate rays.\n- 03-microsoft-sun.svg: Microsoft's Fluent Emoji High Contrast sun, with eyebrows removed, normalized painted bounds and currentColor. This is a later Microsoft design, not the exact Windows 10 emoji.\n\nAll three use a 24 by 24 viewBox, centered painted geometry, transparent background and currentColor. Standalone files render black by default; when embedded inline in Obsidian they inherit the interface color. No fonts, raster images, scripts or external resources are required by the SVG files.\n\nMicrosoft source: ${sourceURL}\nLicense: ${licenseURL} (full notice in Microsoft-LICENSE.txt).\n\nThese are review assets only. The plugin and vault notes were not modified.\n`);
  for (const name of ['Preview.html', 'Microsoft-LICENSE.txt', 'README.md']) await copyFile(join(folder, name), join(desktop, name));
  await page.setContent(html);
  await page.screenshot({ path: join(folder, 'comparison.png'), fullPage: true });
  await writeFile(join(folder, 'geometry.json'), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify({ folder, desktop, files: icons.map(i => i.name), metrics }, null, 2));
} finally { await browser.close(); }
