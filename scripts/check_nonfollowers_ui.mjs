// Headless regression fixture. No Instagram session or network; all accounts are fictional.
// Usage: node scripts/check_nonfollowers_ui.mjs <playwright/index.mjs> [browser executable]
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])));
const root = resolve(import.meta.dirname, '..');
const content = readFileSync(join(root, 'content.js'), 'utf8');
const between = (a, b) => content.slice(content.indexOf(a), content.indexOf(b));
const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'">
<style>${readFileSync(join(root, 'content.css'), 'utf8')} body{background:#202020;margin:0;color:white;font-family:system-ui} .demo{padding:32px;color:#bbb}</style>
<body><p class="demo">IG Tools · fictional accounts · offline UI check</p><script>
{
 const location={origin:'https://www.instagram.com',pathname:'/sample.creator/'};
 let fixtureId=0;const crypto={randomUUID:()=>'fixture-'+(++fixtureId)};
 const fromPage=()=>true, toast=()=>{}, download=()=>{};
 const stored={}, changeListeners=[];
 const chrome={storage:{local:{get:(_k,fn)=>setTimeout(()=>fn(stored),0),set:(data)=>{Object.assign(stored,data);setTimeout(()=>changeListeners.forEach(fn=>fn({nfWhitelist:{}},'local')),0)}},onChanged:{addListener:fn=>changeListeners.push(fn)}}};
 window.posted=[];window.postMessage=(m)=>window.posted.push(m);
 ${between('  // First URL segments', '  // Messages come from intercept.js')}
 ${between('  // ---------- Non-followers scan', '  // The site is a single-page app')}
 window.fixture={
  load:()=>{whitelist.clear();nf.selected.clear();nf.unfollow=null;showVerified=false;viewer={username:'sample.creator',followers:100,following:300};
   nf.state='done';nf.view='results';nf.result={followers:100,following:300,totals:{followers:100,following:300},users:Array.from({length:200},(_,i)=>({pk:String(i+1),username:'sample.account.'+(i+1),fullName:'Fictional account '+(i+1),isVerified:i===199}))};
   document.body.appendChild(nfPanel);renderNf();},
  receive:(data)=>window.dispatchEvent(new MessageEvent('message',{data})),
  scroll:()=>nfBody.scrollTop,
  state:()=>({selected:[...nf.selected],whitelist:[...whitelist],unfollow:nf.unfollow}),
  ready:()=>new Promise(r=>setTimeout(r,20))
 };
}
</script></body></html>`;
const out = join(root, 'dist', 'ui-checks'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [], requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => { requests.push(route.request().url()); return route.abort(); });
    await page.setContent(html);
    await page.evaluate(async () => { await fixture.ready(); fixture.load(); });
    const panel = page.locator('#ighd-nf'), body = page.locator('.ighd-nf-body');
    const row = panel.locator('li').filter({ hasText: '@sample.account.100' });
    await row.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => fixture.scroll());
    assert.ok(before > 1000, 'fixture is well down the list');
    await row.getByRole('button', { name: 'Add @sample.account.100 to whitelist', exact: true }).click();
    await page.evaluate(() => fixture.ready());
    assert.ok(Math.abs(await page.evaluate(() => fixture.scroll()) - before) < 2, 'Add to whitelist and storage reload retain scroll');
    assert.equal(await panel.locator('li').filter({ hasText: '@sample.account.100' }).count(), 0);

    const check = panel.getByRole('checkbox', { name: 'Select @sample.account.101', exact: true });
    await check.check();
    assert.equal(await check.isChecked(), true);
    assert.ok(Math.abs(await page.evaluate(() => fixture.scroll()) - before) < 2, 'selecting retains scroll');
    await panel.getByRole('checkbox', { name: 'Select @sample.account.102', exact: true }).check();
    await panel.locator('.ighd-nf-bulk').getByRole('button', { name: 'Add to whitelist', exact: true }).click();
    await page.evaluate(() => fixture.ready());
    assert.equal(await panel.locator('li').count(), 196);
    assert.equal((await page.evaluate(() => fixture.state())).whitelist.length, 3);
    assert.ok(await page.evaluate(() => fixture.scroll()) > 1000, 'bulk Add to whitelist does not jump to top');

    await panel.getByRole('checkbox', { name: 'Select @sample.account.103', exact: true }).check();
    await panel.getByRole('button', { name: 'Unfollow selected', exact: true }).click();
    assert.equal(await panel.getByRole('button', { name: 'Confirm unfollow (1)', exact: true }).count(), 1);
    assert.equal((await page.evaluate(() => window.posted)).filter((m) => m.source === 'ighd-nf-unfollow-start').length, 0);
    await page.screenshot({ path: join(out, `unfollow-confirm-${width}.png`) });
    // Confirmation sends only to the fixture's message recorder, never to Instagram.
    await panel.getByRole('button', { name: 'Confirm unfollow (1)', exact: true }).click();
    const start = (await page.evaluate(() => window.posted)).at(-1);
    assert.equal(start.source, 'ighd-nf-unfollow-start'); assert.deepEqual(start.pks, ['103']);
    await page.evaluate((id) => fixture.receive({ source: 'ighd-nf-unfollow', id, state: 'running', completed: 1, removedPk: '103' }), start.id);
    await page.evaluate((id) => fixture.receive({ source: 'ighd-nf-unfollow', id, state: 'done', completed: 1 }), start.id);
    assert.equal(await panel.locator('li').filter({ hasText: '@sample.account.103' }).count(), 0);
    const geometry = await panel.evaluate((el) => {
      const r = el.getBoundingClientRect(), footer = el.querySelector('.ighd-nf-actions').getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, footerBottom: footer.bottom,
        overflow: el.scrollWidth > el.clientWidth, bodyScrollable: el.querySelector('.ighd-nf-body').scrollHeight > el.querySelector('.ighd-nf-body').clientHeight };
    });
    assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.top >= 0 && geometry.bottom <= height);
    assert.ok(geometry.footerBottom <= geometry.bottom && !geometry.overflow && geometry.bodyScrollable);
    await panel.getByRole('checkbox', { name: 'Select @sample.account.104', exact: true }).check();
    await page.screenshot({ path: join(out, `non-followers-${width}.png`) });
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    console.log(`${width}px: Add to whitelist scroll, async storage, checkbox scroll, bulk whitelist, explicit unfollow confirmation, confirmed removal, layout passed; zero network requests`);
    await page.close();
  }
} finally { await browser.close(); }
