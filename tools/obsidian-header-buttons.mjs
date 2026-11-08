import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9237');
try {
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/'));
 await assertTestVault(page);
 const initial=await page.evaluate(()=>document.body.className);
 const checks=[];
 for(const theme of ['theme-light','theme-dark']) {
  await page.evaluate(theme=>{document.body.classList.remove('theme-light','theme-dark');document.body.classList.add(theme);},theme);
  const styles=await page.locator('.planner-header button').evaluateAll(es=>es.map(e=>({name:e.textContent,border:getComputedStyle(e).borderTopStyle,width:getComputedStyle(e).borderTopWidth,bg:getComputedStyle(e).backgroundColor,height:e.getBoundingClientRect().height})));
  // Activity/Report is one bordered segmented control; its segments sit inside it. The other four are bordered buttons.
  const toggle=await page.locator('.planner-header .planner-view-toggle').evaluate(e=>({border:getComputedStyle(e).borderTopStyle,width:getComputedStyle(e).borderTopWidth,bg:getComputedStyle(e).backgroundColor,height:e.getBoundingClientRect().height,pressed:[...e.querySelectorAll('button')].map(b=>b.getAttribute('aria-pressed'))}));
  assert.equal(styles.length,6);assert(toggle.border==='solid'&&toggle.width==='1px'&&toggle.bg!=='rgba(0, 0, 0, 0)'&&toggle.height===32);
  assert.deepEqual(toggle.pressed.slice().sort(),['false','true']);
  assert(styles.slice(2).every(s=>s.border==='solid'&&s.width==='1px'&&s.bg!=='rgba(0, 0, 0, 0)'&&s.height===32));
  const header=page.locator('.planner-header');await header.screenshot({path:`artifacts/planner-header-${theme}.png`});
  checks.push(`${theme}: the Activity/Report toggle and four buttons have visible borders, backgrounds and aligned 32px heights`);
 }
 await page.evaluate(()=>{document.body.classList.remove('theme-dark');document.body.classList.add('theme-light');});
 const today=page.getByRole('button',{name:'Today',exact:true});
 // Reach Today with the keyboard, so :focus-visible applies even after earlier mouse use.
 await today.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
 assert(await today.evaluate(e=>e===document.activeElement));
 assert.equal(await today.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
 
 await page.locator('.planner-header .previous').click();
 await page.locator('.planner-header .next').click();
 await today.click();
 assert.equal(await page.locator('.planner-date-navigation input').inputValue(),await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.now().date));
 checks.push('Visible keyboard focus and previous/next/Today navigation remain functional');
 await page.locator('.planner-shell').evaluate(e=>{e.style.width='300px';e.style.maxWidth='100%';});
 const fits=await page.locator('.planner-header').evaluate(e=>[...e.children].every(c=>c.getBoundingClientRect().right<=e.getBoundingClientRect().right+1));assert(fits);
 await page.locator('.planner-header').screenshot({path:'artifacts/planner-header-narrow.png'});
 checks.push('Header wraps within a 300px content column');
 await page.locator('.planner-shell').evaluate(e=>{e.style.removeProperty('width');e.style.removeProperty('max-width');});
 await page.evaluate(classes=>{document.body.className=classes;},initial);
 await writeFile('artifacts/planner-header-buttons.json',JSON.stringify({checks},null,2));console.log(checks.join('\n'));
}finally{await browser.close();}

