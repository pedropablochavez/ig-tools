// Render the shipped result panel with fictional data, without Instagram requests.
// Requires Node 22+ and the local design-taste-frontend CDP helper used for site QA.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const helper = process.argv[2];
if (!helper) throw new Error('Usage: node scripts/prepare_nonfollowers_asset.mjs <absolute path to cdp.mjs>');
const { Browser } = await import(pathToFileURL(resolve(helper)));
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist', 'site-fixtures');
mkdirSync(out, { recursive: true });
let content = readFileSync(join(root, 'content.js'), 'utf8');
content = content.replace(/\}\)\(\);\s*$/, `window.fixtureNf = () => {
  viewer = { pk: '1000', username: 'sample.creator', followers: 24, following: 27 };
  nf.state = 'done'; nf.view = 'results';
  nf.result = { followers: 24, following: 27, totals: { followers: 24, following: 27 }, users: [
    {pk:'1001',username:'sample.traveler',fullName:'Sample traveler'},
    {pk:'1002',username:'sample.studio',fullName:'Sample studio'},
    {pk:'1003',username:'sample.weekends',fullName:'Sample weekends'}
  ]};
  document.body.append(nfPanel); renderNf();
};})();`);
const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">
<style>${readFileSync(join(root, 'content.css'), 'utf8')}
body { margin:0; background:#1c1c1c; color:#f2f2f2; font:14px/1.5 'Segoe UI',sans-serif; }
.profile { padding:28px 44px 22px; } .profile strong { font-size:20px; font-weight:500; }
.profile p { margin:5px 0 0; color:#b0b0b0; }
#ighd-nf { position:relative; inset:auto; margin:0 auto; box-shadow:none; width:380px; max-height:none; }
#ighd-btn, #ighd-nf-btn { display:none; }
.sample-note { margin:18px 44px 0; color:#b0b0b0; font-size:13px; }
</style><body><div class="profile"><strong>sample.creator</strong><p>24 followers &nbsp; 27 following</p></div>
<script>window.chrome={runtime:{getManifest:()=>({version:'demo'}),sendMessage:(_m,fn)=>fn?.({ok:true})},storage:{local:{get:(_k,fn)=>fn({}),set:()=>{}},onChanged:{addListener:()=>{}}}};
window.fetch=()=>Promise.reject(new Error('Network disabled in fixture'));
{const location={origin:'https://www.instagram.com',pathname:'/sample.creator/'};${content}}
fixtureNf();</script><p class="sample-note">Illustrative results · fictional accounts<br>Actual bundled IG Tools controls</p></body></html>`;
const fixture = join(out, 'nonfollowers.html');
writeFileSync(fixture, html);
const browser = await Browser.launch();
try {
  const page = await browser.newPage({ width: 500, height: 520 });
  await page.goto(pathToFileURL(fixture).href);
  if (page.consoleErrors.length) throw new Error(page.consoleErrors.join('\n'));
  if (!await page.eval(() => document.querySelector('#ighd-nf .ighd-nf-summary')?.textContent.startsWith('3 accounts'))) throw new Error('Shipped result panel did not render');
  await page.screenshot({ path: join(root, 'site/assets/nonfollowers-demo.png'), format: 'png' });
  console.log('Rendered fictional non-followers results using bundled content.js and content.css; network blocked by CSP.');
} finally { await browser.close(); }
