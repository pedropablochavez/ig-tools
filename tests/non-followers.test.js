const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const path = require('node:path');

const read = (name) => readFileSync(path.join(__dirname, '..', name), 'utf8');
const content = read('content.js');
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const tick = () => new Promise((r) => setImmediate(r));
const plain = (v) => JSON.parse(JSON.stringify(v));

const ME = '44042210968';
const user = (pk, username = `user${pk}`) => ({ pk: String(pk), pk_id: String(pk), id: String(pk), username,
  full_name: `Name ${pk}`, profile_pic_url: `https://scontent.cdninstagram.com/p${pk}.jpg`, is_private: false,
  is_verified: false, fbid_v2: '1', strong_id__: String(pk) });

// Pages shaped like the ones observed on 2026-10-22: 12 users, an opaque cursor for followers and
// a numeric offset for following.
function pages(users, kind) {
  const out = [];
  for (let i = 0; i < users.length; i += 12) {
    const more = i + 12 < users.length;
    out.push({ users: users.slice(i, i + 12), big_list: true, page_size: 12, has_more: more,
      next_max_id: more ? (kind === 'followers' ? `QVFE${'x'.repeat(100)}${i}+/=` : String(i + 12)) : null,
      should_limit_list_of_followers: false, should_limit_list_of_followings: false, status: 'ok' });
  }
  return out;
}

// Followers: pks 1–30. Following: pks 21–46, so 31–46 do not follow back. pk 21 changed username
// (still a follower); pk 40 reuses a follower's username (still not a follower).
const followers = Array.from({ length: 30 }, (_, i) => user(i + 1));
const following = Array.from({ length: 26 }, (_, i) => user(i + 21));
following[0] = user(21, 'renamed.21');
following[19] = user(40, 'user5');

function interceptor({ path: pathname = '/me.user/', activation = true, counts = { follower_count: 30, following_count: 26 },
  respond: custom } = {}) {
  const messages = [], listeners = [], delays = [], requests = [];
  let inFlight = 0, maxInFlight = 0;
  const lists = { followers: pages(followers, 'followers'), following: pages(following, 'following') };
  const defaultRespond = (kind, index) => new Response(JSON.stringify(lists[kind][index]), { status: 200 });
  class XHR {
    constructor() { this.loads = []; this.responseType = ''; this.responseText = '{}'; }
    addEventListener(type, fn) { if (type === 'load') this.loads.push(fn); }
    open() {} setRequestHeader() {} send() {}
  }
  const window = {
    fetch: async (url, init) => {
      const u = new URL(url);
      const m = u.pathname.match(/^\/api\/v1\/friendships\/(\d+)\/(followers|following)\/$/);
      if (!m) return new Response('{}');
      const kind = m[2];
      const cursor = u.searchParams.get('max_id');
      const index = cursor == null ? 0 : lists[kind].findIndex((p) => p.next_max_id === cursor) + 1;
      requests.push({ url: String(url), kind, index, init });
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await tick();
      try {
        if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        return await (custom || defaultRespond)(kind, index, init, defaultRespond);
      } finally { inFlight--; }
    },
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
    postMessage: (msg) => messages.push(msg)
  };
  const context = vm.createContext({ window, XMLHttpRequest: XHR, URL, Request, Response, Headers,
    URLSearchParams, TextDecoder, AbortController, DOMException, clearTimeout,
    // Pauses between pages run immediately; their requested length is recorded.
    setTimeout: (fn, ms) => { delays.push(ms); return setTimeout(fn, ms >= 5000 ? 2 ** 31 - 1 : 0); },
    navigator: { userActivation: { isActive: activation } },
    document: { readyState: 'loading', cookie: `csrftoken=tok; ds_user_id=${ME}`, addEventListener() {}, querySelectorAll: () => [] },
    sessionStorage: { getItem: () => null }, console: { log() {}, table() {} },
    location: { origin: 'https://www.instagram.com', href: `https://www.instagram.com${pathname}`, pathname } });
  vm.runInContext(read('intercept.js'), context);
  const profile = (username, pk, extra = {}) => {
    const xhr = new XHR();
    xhr.open('POST', '/api/graphql');
    xhr.responseText = JSON.stringify({ data: { user: { username, pk, id: pk,
      profile_pic_url: 'https://s.cdninstagram.com/me.jpg', ...extra } } });
    xhr.loads.forEach((fn) => fn());
  };
  const post = (data) => listeners.forEach((fn) => fn({ source: window, origin: 'https://www.instagram.com', data }));
  const scanMessages = () => plain(messages.filter((m) => m.source === 'ighd-nf'));
  const last = () => scanMessages().at(-1);
  async function settle() {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      if (['done', 'stopped', 'cancelled', 'refused'].includes(last()?.state)) return last();
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error('scan did not finish');
  }
  profile('me.user', ME, counts);
  return { context, messages, delays, requests, post, profile, scanMessages, last, settle,
    maxInFlight: () => maxInFlight, start: (id = 'scan-1') => post({ source: 'ighd-nf-start', id }) };
}

test('reads both lists with the website request, one page at a time, and compares by pk', async () => {
  const h = interceptor();
  assert.deepEqual(plain(h.messages.find((m) => m.source === 'ighd-viewer')),
    { source: 'ighd-viewer', username: 'me.user', followers: 30, following: 26 });
  h.start();
  const done = await h.settle();
  assert.equal(done.state, 'done');
  assert.deepEqual(h.requests.map((r) => `${r.kind}:${r.index}`),
    ['followers:0', 'followers:1', 'followers:2', 'following:0', 'following:1', 'following:2']);
  assert.equal(h.maxInFlight(), 1, 'never two requests at the same time');
  const urls = h.requests.map((r) => r.url);
  assert.equal(urls[0], `https://www.instagram.com/api/v1/friendships/${ME}/followers/?count=12&search_surface=follow_list_page`);
  const cursor = pages(followers, 'followers')[0].next_max_id;
  assert.equal(urls[1], `https://www.instagram.com/api/v1/friendships/${ME}/followers/?count=12&max_id=${encodeURIComponent(cursor)}&search_surface=follow_list_page`);
  assert.equal(urls[3], `https://www.instagram.com/api/v1/friendships/${ME}/following/?count=12`);
  assert.equal(urls[4], `https://www.instagram.com/api/v1/friendships/${ME}/following/?count=12&max_id=12`);
  const init = h.requests[0].init;
  assert.equal(init.credentials, 'include');
  assert.equal(init.headers['x-ig-app-id'], '936619743392459');
  assert.equal(init.headers['x-csrftoken'], 'tok');
  const pauses = h.delays.filter((ms) => ms < 5000);
  assert.equal(pauses.length, 5, 'a pause before every page after the first');
  assert.ok(pauses.every((ms) => ms >= 2000 && ms <= 4000), `pauses ${pauses}`);
  assert.deepEqual(done.users.map((u) => u.pk), Array.from({ length: 16 }, (_, i) => String(i + 31)));
  assert.equal(done.users.find((u) => u.pk === '40').username, 'user5');
  assert.equal(done.followers, 30);
  assert.equal(done.following, 26);
  const progress = h.scanMessages().filter((m) => m.state === 'running');
  assert.deepEqual(progress.at(-1), { source: 'ighd-nf', id: 'scan-1', state: 'running', list: 'following',
    followers: 30, following: 26, pages: 6, totals: { followers: 30, following: 26 } });
});

test('Cancel stops the scan without further requests or a cooldown', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = interceptor({ respond: async (kind, index, init, def) => {
    if (kind === 'followers' && index === 1) await gate;
    return def(kind, index);
  } });
  h.start();
  while (h.requests.length < 2) await tick();
  h.post({ source: 'ighd-nf-cancel', id: 'other-scan' });
  h.post({ source: 'ighd-nf-cancel', id: 'scan-1' });
  release();
  const end = await h.settle();
  assert.equal(end.state, 'cancelled');
  assert.equal(end.retryAt, null);
  for (let i = 0; i < 50; i++) await tick();
  assert.equal(h.requests.length, 2);
  // A later Start (with a new click) is allowed.
  h.start('scan-2');
  assert.equal((await h.settle()).state, 'done');
});

test('HTTP 429 ends the scan, sets the shared cooldown and is never retried automatically', async () => {
  const h = interceptor({ respond: (kind, index, init, def) => (kind === 'followers' && index === 1
    ? new Response('{"message":"Please wait a few minutes before you try again.","status":"fail"}',
      { status: 429, headers: { 'retry-after': '120' } })
    : def(kind, index)) });
  h.start();
  const end = await h.settle();
  assert.equal(end.state, 'stopped');
  assert.equal(end.reason, 'rate-limit');
  assert.ok(end.retryAt >= Date.now() + 110000 && end.retryAt <= Date.now() + 121000);
  for (let i = 0; i < 50; i++) await tick();
  assert.equal(h.requests.length, 2, 'no automatic retry');
  h.start('scan-2');
  assert.deepEqual([h.last().state, h.last().reason], ['refused', 'cooldown']);
  h.post({ source: 'ighd-load-post', code: 'Cabcdef1234' });
  for (let i = 0; i < 10; i++) await tick();
  const detail = plain(h.messages.find((m) => m.source === 'ighd-load-post-result'));
  assert.equal(detail.reason, 'rate limit cooldown', 'post lookups share the cooldown');
  assert.equal(h.requests.length, 2);
});

test('blocks, server errors and network failures stop the scan', async () => {
  const cases = [
    [new Response('{"message":"checkpoint_required","status":"fail"}', { status: 400 }), 'blocked', 900000],
    [new Response('{"message":"feedback_required","spam":true,"status":"fail"}', { status: 200 }), 'blocked', 900000],
    [new Response('oops', { status: 500 }), 'error', 60000],
    [new Response('<html></html>', { status: 200 }), 'error', 60000],
    [new Error('Failed to fetch'), 'network', 60000]
  ];
  for (const [answer, reason, cool] of cases) {
    const h = interceptor({ respond: (kind, index, init, def) => {
      if (kind !== 'following') return def(kind, index);
      if (answer instanceof Error) throw answer;
      return answer.clone();
    } });
    h.start();
    const end = await h.settle();
    assert.deepEqual([end.state, end.reason], ['stopped', reason]);
    assert.equal(end.followers, 30);
    assert.ok(Math.abs(end.retryAt - (Date.now() + cool)) < 5000, `${reason} retry time`);
    for (let i = 0; i < 30; i++) await tick();
    assert.equal(h.requests.length, 4);
  }
});

test('only your own profile, only after a click, and never on its own', async () => {
  const idle = interceptor();
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(idle.requests.length, 0, 'loading data alone makes no list request');

  const other = interceptor({ path: '/someone.else/' });
  other.profile('someone.else', '777', { follower_count: 5, following_count: 5 });
  other.start();
  assert.deepEqual([other.last().state, other.last().reason], ['refused', 'not-own-profile']);

  const unknown = interceptor();
  unknown.context.document.cookie = 'csrftoken=tok';
  unknown.start();
  assert.equal(unknown.last().reason, 'not-own-profile');

  const noClick = interceptor({ activation: false });
  noClick.start();
  assert.deepEqual([noClick.last().state, noClick.last().reason], ['refused', 'no-click']);

  const tooLarge = interceptor({ counts: { follower_count: 2000, following_count: 1700 } });
  tooLarge.start();
  assert.deepEqual(plain(tooLarge.last()), { source: 'ighd-nf', id: 'scan-1', state: 'refused', reason: 'too-large',
    pages: 309, limit: 300 });

  for (const h of [other, unknown, noClick, tooLarge]) assert.equal(h.requests.length, 0);
  // Your own profile's lists are always the ones read, whatever page asked.
  const own = interceptor();
  own.start();
  await own.settle();
  assert.ok(own.requests.every((r) => r.url.includes(`/friendships/${ME}/`)));
});

test('a list that never ends stops at the page limit', async () => {
  let n = 0;
  const h = interceptor({ counts: {}, respond: () => { n++; return new Response(JSON.stringify({ users: [user(n + 1000)],
    has_more: true, next_max_id: String(n), status: 'ok' })); } });
  h.start();
  const end = await h.settle();
  assert.deepEqual([end.state, end.reason, end.pages], ['stopped', 'limit', 300]);
  assert.equal(h.requests.length, 300);
});

// ---------- content.js panel ----------

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.kids = []; this.parentElement = null; this.attrs = {};
    this.text = ''; this.handlers = {};
  }
  get isConnected() { for (let e = this; e; e = e.parentElement) if (e.tagName === 'BODY') return true; return false; }
  get textContent() { return this.text + this.kids.map((k) => k.textContent).join(''); }
  set textContent(v) { this.text = String(v); this.kids = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
  click(isTrusted = true) { (this.handlers.click || []).forEach((fn) => fn({ isTrusted })); }
  change() { (this.handlers.change || []).forEach((fn) => fn({ isTrusted: true })); }
  append(...nodes) { for (const n of nodes) { if (typeof n === 'string') continue; n.remove(); n.parentElement = this; this.kids.push(n); } }
  appendChild(n) { this.append(n); return n; }
  replaceChildren(...nodes) { for (const k of [...this.kids]) k.remove(); this.append(...nodes); }
  remove() { const p = this.parentElement; if (p) { p.kids.splice(p.kids.indexOf(this), 1); this.parentElement = null; } }
  *all() { for (const k of this.kids) { yield k; yield* k.all(); } }
  find(fn) { return [...this.all()].find(fn); }
  button(text) { return this.find((e) => e.tagName === 'BUTTON' && e.textContent === text); }
}

function panel({ path: pathname = '/me.user/', stored = {} } = {}) {
  const posted = [], listeners = [], downloads = [], changeListeners = [];
  const body = new El('body');
  // chrome.storage.local with asynchronous callbacks, like the real API.
  const store = plain(stored);
  const chrome = { storage: {
    local: {
      get: (keys, cb) => setImmediate(() => cb(Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, plain(store[k])])))),
      set: (items) => {
        Object.assign(store, plain(items));
        setImmediate(() => changeListeners.forEach((fn) => fn(Object.fromEntries(Object.keys(items).map((k) => [k, {}])), 'local')));
      }
    },
    onChanged: { addListener: (fn) => changeListeners.push(fn) }
  } };
  const context = vm.createContext({
    window: { addEventListener: (type, fn) => listeners.push(fn), postMessage: (msg) => posted.push(msg) },
    location: { pathname, origin: 'https://www.instagram.com' },
    document: { createElement: (tag) => new El(tag), body },
    crypto: { randomUUID: () => `id-${posted.length}` },
    chrome,
    fromPage: () => true,
    toast() {},
    download: async (url, filename) => { downloads.push({ url, filename }); return true; }
  });
  vm.runInContext(`${between(content, '  // First URL segments', '  // Messages come from intercept.js')}
    ${between(content, '  // ---------- Non-followers scan', '  // The site is a single-page app')}
    globalThis.api = { updateNfButton, nfBtn, nfPanel, nfCsv, nf };`, context);
  const receive = (data) => listeners.forEach((fn) => fn({ data }));
  return { context, body, posted, downloads, receive, store, api: context.api };
}

test('the button only appears on your own profile and Start needs a real click', () => {
  const p = panel();
  assert.deepEqual(plain(p.posted), [{ source: 'ighd-viewer-request' }]);
  assert.equal(p.api.nfBtn.isConnected, false, 'nothing before the profile data arrives');
  p.receive({ source: 'ighd-viewer', username: 'me.user', followers: 879, following: 1074 });
  assert.equal(p.api.nfBtn.isConnected, true);
  p.api.nfBtn.click();
  assert.equal(p.api.nfPanel.isConnected, true);
  assert.match(p.api.nfPanel.textContent, /about 164 requests and 9 min/);
  assert.match(p.api.nfPanel.textContent, /may limit or block accounts/);
  assert.equal(p.posted.length, 1, 'opening the panel sends nothing');
  p.api.nfPanel.button('Start scan').click(false);
  assert.equal(p.posted.length, 1, 'a synthetic click does not start');
  p.api.nfPanel.button('Start scan').click(true);
  assert.deepEqual(plain(p.posted.at(-1)), { source: 'ighd-nf-start', id: 'id-1' });
  p.receive({ source: 'ighd-nf', id: 'id-1', state: 'running', list: 'following', followers: 879, following: 340 });
  assert.match(p.api.nfPanel.textContent, /Followers 879 \/ 879Following 340 \/ 1,074/);
  p.api.nfPanel.button('Cancel').click();
  assert.deepEqual(plain(p.posted.at(-1)), { source: 'ighd-nf-cancel', id: 'id-1' });
  p.receive({ source: 'ighd-nf', id: 'id-1', state: 'done', users: [] });
  assert.match(p.api.nfPanel.textContent, /Scan cancelled\./, 'late messages of a cancelled scan are ignored');

  const other = panel({ path: '/someone.else/' });
  other.receive({ source: 'ighd-viewer', username: 'me.user', followers: 1, following: 1 });
  assert.equal(other.api.nfBtn.isConnected, false);
});

test('a running scan continues while you browse elsewhere and its result waits for you', () => {
  const p = panel();
  p.receive({ source: 'ighd-viewer', username: 'me.user', followers: 30, following: 26 });
  p.api.nfBtn.click();
  p.api.nfPanel.button('Start scan').click();
  p.api.nfPanel.button('✕').click();
  p.context.location.pathname = '/explore/';
  p.api.updateNfButton();
  assert.equal(p.posted.at(-1).source, 'ighd-nf-start', 'leaving the profile does not cancel');
  assert.equal(p.api.nfBtn.isConnected, true, 'progress stays visible');
  p.receive({ source: 'ighd-nf', id: 'id-1', state: 'running', list: 'following', followers: 30, following: 12 });
  assert.equal(p.api.nfBtn.textContent, 'Scanning… 75%');
  assert.equal(p.api.nfPanel.button('Start scan'), undefined);
  p.receive({ source: 'ighd-nf', id: 'id-1', state: 'done', followers: 30, following: 26,
    users: [{ pk: '31', username: 'user31', fullName: '', pic: '' }] });
  p.api.updateNfButton();
  assert.equal(p.api.nfBtn.textContent, 'Non-followers ready');
  assert.equal(p.api.nfBtn.isConnected, true);
  p.api.nfBtn.click();
  assert.match(p.api.nfPanel.textContent, /1 account you follow doesn't follow you back\./);
  assert.ok(!p.api.nfPanel.button('Start scan'), 'a new scan cannot start away from your profile');
  p.api.nfPanel.button('✕').click();
  p.api.updateNfButton();
  assert.equal(p.api.nfBtn.isConnected, false, 'gone once the result was seen and closed');
});

test('stops and results are shown safely', async () => {
  const p = panel();
  p.receive({ source: 'ighd-viewer', username: 'me.user', followers: 30, following: 26 });
  p.api.nfBtn.click();
  p.api.nfPanel.button('Start scan').click();
  const id = p.posted.at(-1).id;
  p.receive({ source: 'ighd-nf', id, state: 'stopped', reason: 'rate-limit', pages: 3, followers: 30, following: 0,
    retryAt: Date.now() + 600000 });
  assert.match(p.api.nfPanel.textContent, /HTTP 429.*Try again after/);
  assert.ok(p.api.nfPanel.button('Start scan'));

  p.api.nfPanel.button('Start scan').click();
  const id2 = p.posted.at(-1).id;
  p.receive({ source: 'ighd-nf', id: id2, state: 'done', followers: 29, following: 26, users: [
    { pk: '31', username: 'user31', fullName: '<img src=x onerror=alert(1)>', pic: 'https://scontent.cdninstagram.com/a.jpg' },
    { pk: '32', username: 'bad"name', fullName: '', pic: '' },
    { pk: '33', username: 'user33', fullName: '=HYPERLINK("x")', pic: 'javascript:alert(1)' }] });
  const text = p.api.nfPanel.textContent;
  assert.match(text, /2 accounts you follow don't follow you back\./);
  assert.match(text, /returned 29 followers/);
  const links = [...p.api.nfPanel.all()].filter((e) => e.tagName === 'A');
  assert.deepEqual(links.map((a) => a.attrs.href), ['/user31/', '/user33/']);
  const imgs = [...p.api.nfPanel.all()].filter((e) => e.tagName === 'IMG');
  assert.deepEqual(imgs.map((i) => i.attrs.src), ['https://scontent.cdninstagram.com/a.jpg']);
  assert.ok(!p.api.nfPanel.find((e) => e.tagName === 'SCRIPT'));

  p.api.nfPanel.button('Export CSV').click();
  await tick();
  const [file] = p.downloads;
  assert.match(file.filename, /^me\.user_non-followers_\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = decodeURIComponent(file.url.replace('data:text/csv;charset=utf-8,', ''));
  assert.equal(csv, '﻿"pk","username","full_name","profile_url","is_private","is_verified"\r\n'
    + '"31","user31","<img src=x onerror=alert(1)>","https://www.instagram.com/user31/","false","false"\r\n'
    + '"33","user33","\'=HYPERLINK(""x"")","https://www.instagram.com/user33/","false","false"');
});

// Result for the whitelist / verified tests, as intercept.js reports it.
const result = (id) => ({ source: 'ighd-nf', id, state: 'done', followers: 30, following: 26, users: [
  { pk: '31', username: 'friend.31', fullName: 'Friend', pic: '', isVerified: false },
  { pk: '32', username: 'brand', fullName: 'Brand', pic: '', isVerified: true },
  { pk: '33', username: 'user33', fullName: '', pic: '', isVerified: false }] });
const usernames = (p) => [...p.api.nfPanel.all()].filter((e) => e.tagName === 'A').map((a) => a.attrs.href);
async function scanned(options) {
  const p = panel(options);
  await tick();
  p.receive({ source: 'ighd-viewer', username: 'me.user', followers: 30, following: 26 });
  p.api.nfBtn.click();
  p.api.nfPanel.button('Start scan').click();
  p.receive(result(p.posted.at(-1).id));
  return p;
}

test('Keep adds an account to the saved whitelist, which hides it from results until removed', async () => {
  const p = await scanned();
  assert.deepEqual(usernames(p), ['/friend.31/', '/user33/'], 'verified accounts are left out by default');
  const row = p.api.nfPanel.find((e) => e.tagName === 'LI' && e.textContent.includes('@friend.31'));
  row.button('Keep').click();
  assert.deepEqual(usernames(p), ['/user33/']);
  assert.match(p.api.nfPanel.textContent, /1 account you follow doesn't follow you back\.Not shown: 1 whitelisted, 1 verified\./);
  assert.deepEqual(p.store.nfWhitelist, { 31: 'friend.31' });
  p.api.nfPanel.button('Whitelist (1)').click();
  assert.deepEqual(usernames(p), ['/friend.31/']);
  p.api.nfPanel.button('Remove').click();
  assert.deepEqual(p.store.nfWhitelist, {});
  assert.match(p.api.nfPanel.textContent, /No accounts yet/);
  p.api.nfPanel.button('Back').click();
  assert.deepEqual(usernames(p), ['/friend.31/', '/user33/']);
});

test('a saved whitelist applies by pk on the next page load, and bad entries are ignored', async () => {
  // The account was renamed since it was whitelisted: the pk still matches.
  const p = await scanned({ stored: { nfWhitelist: { 31: 'old.name', 'x': 'bad', 99: '<b>' }, nfShowVerified: true } });
  await tick();
  assert.deepEqual(usernames(p), ['/brand/', '/user33/']);
  p.api.nfPanel.button('Whitelist (1)').click();
  assert.deepEqual(usernames(p), ['/old.name/']);
  // The idle panel offers the whitelist too, on your profile.
  p.api.nfPanel.button('Back').click();
  p.api.nfPanel.button('New scan').click();
  assert.ok(p.api.nfPanel.button('Whitelist (1)'));
  assert.ok(p.api.nfPanel.button('Start scan'));
});

test('Show verified accounts sits next to Start scan before a scan, filters results and CSV, and is remembered', async () => {
  const p = panel();
  await tick();
  p.receive({ source: 'ighd-viewer', username: 'me.user', followers: 30, following: 26 });
  p.api.nfBtn.click();
  const actions = p.api.nfPanel.find((e) => e.attrs.class === 'ighd-nf-actions');
  assert.deepEqual(actions.kids.map((k) => k.textContent), ['Whitelist (0)', 'Show verified accounts', 'Start scan'],
    'the whitelist and the verified choice are available before the first scan');
  const box = actions.find((e) => e.tagName === 'INPUT');
  assert.equal(box.checked, false);
  box.checked = true;
  box.change();
  assert.equal(p.store.nfShowVerified, true);
  p.api.nfPanel.button('Whitelist (0)').click();
  assert.match(p.api.nfPanel.textContent, /No accounts yet\. After a scan, press Keep/);
  p.api.nfPanel.button('Back').click();
  p.api.nfPanel.button('Start scan').click();
  p.receive(result(p.posted.at(-1).id));
  assert.deepEqual(usernames(p), ['/friend.31/', '/brand/', '/user33/']);
  assert.match(p.api.nfPanel.textContent, /@brandVerified/);
  const inResults = p.api.nfPanel.find((e) => e.tagName === 'INPUT');
  assert.equal(inResults.checked, true);
  inResults.checked = false;
  inResults.change();
  assert.deepEqual(usernames(p), ['/friend.31/', '/user33/']);
  assert.match(p.api.nfPanel.textContent, /Not shown: 1 verified\./);
  assert.equal(p.store.nfShowVerified, false);
  p.api.nfPanel.find((e) => e.tagName === 'LI' && e.textContent.includes('@user33')).button('Keep').click();
  assert.match(p.api.nfPanel.textContent, /Not shown: 1 whitelisted, 1 verified\./);
  p.api.nfPanel.button('Export CSV').click();
  await tick();
  const csv = decodeURIComponent(p.downloads[0].url.replace('data:text/csv;charset=utf-8,', ''));
  assert.deepEqual(csv.split('\r\n').slice(1).map((line) => line.split(',')[1]), ['"friend.31"'], 'exports what is shown');

  const next = await scanned({ stored: { ...plain(p.store), nfShowVerified: true } });
  await tick();
  assert.equal(next.api.nfPanel.find((e) => e.tagName === 'INPUT').checked, true);
  assert.deepEqual(usernames(next), ['/friend.31/', '/brand/']);
});
