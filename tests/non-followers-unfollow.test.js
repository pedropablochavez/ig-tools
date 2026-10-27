const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const path = require('node:path');
const source = readFileSync(path.join(__dirname, '..', 'intercept.js'), 'utf8');
const tick = () => new Promise(setImmediate);
const json = (data, init) => new Response(JSON.stringify(data), init);
const user = (pk) => ({ pk: String(pk), username: `user${pk}` });

function harness({ respond, tokens = true, holdBreak = false } = {}) {
  const messages = [], writes = [], delays = [], listeners = [], timers = new Set();
  let active = 0, peak = 0;
  class XHR {
    constructor() { this.events = []; this.responseType = ''; }
    open() {} setRequestHeader() {} send() {}
    addEventListener(type, fn) { if (type === 'load') this.events.push(fn); }
  }
  const success = (pk) => json({ data: { xdt_destroy_friendship: { user: { pk, friendship_status: { following: false } } } } });
  const window = {
    require: tokens ? (name) => ({ DTSGInitialData: { token: 'fixture-fb' }, LSD: { token: 'fixture-lsd' } })[name] : undefined,
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
    postMessage: (m) => messages.push(JSON.parse(JSON.stringify(m))),
    fetch: async (url, init) => {
      if (new URL(url).pathname !== '/api/graphql') return json({ status: 'ok', has_more: false,
        users: String(url).includes('/followers/') ? [user(1)] : Array.from({ length: 7 }, (_, i) => user(i + 1)) });
      const params = new URLSearchParams(init.body), pk = JSON.parse(params.get('variables')).target_user_id;
      writes.push({ url, init, params, pk });
      peak = Math.max(peak, ++active);
      try { return respond ? await respond(pk, init, success, writes.length) : success(pk); }
      finally { active--; }
    }
  };
  const context = vm.createContext({ window, XMLHttpRequest: XHR, URL, Request, Response, Headers, FormData,
    URLSearchParams, TextDecoder, AbortController, Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    navigator: { userActivation: { isActive: true } },
    document: { readyState: 'loading', cookie: 'ds_user_id=99; csrftoken=fixture-csrf', querySelectorAll: () => [], addEventListener() {} },
    sessionStorage: { getItem: () => null }, console: { log() {}, table() {} },
    location: { origin: 'https://www.instagram.com', href: 'https://www.instagram.com/me/', pathname: '/me/' },
    setTimeout: (fn, ms) => {
      if (ms !== 8000) delays.push(ms);
      const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms === 8000 || (holdBreak && ms > 300000) ? 2 ** 31 - 1 : 0);
      timers.add(timer); return timer;
    }, clearTimeout: (timer) => { timers.delete(timer); clearTimeout(timer); }
  });
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'window.testSerial = serial;})();'), context);
  const profile = new XHR(); profile.open('POST', '/api/graphql');
  profile.responseText = JSON.stringify({ data: { user: { pk: '99', username: 'me', profile_pic_url: 'https://s.cdninstagram.com/a.jpg', follower_count: 1, following_count: 7 } } });
  profile.events.forEach((fn) => fn());
  const post = (data) => listeners.forEach((fn) => fn({ source: window, origin: context.location.origin, data }));
  const last = (channel = 'ighd-nf-unfollow') => messages.filter((m) => m.source === channel).at(-1);
  const until = async (predicate) => {
    const end = Date.now() + 3000;
    while (!predicate() && Date.now() < end) await tick();
    assert.ok(predicate(), 'expected event before deadline');
  };
  const scan = async () => { post({ source: 'ighd-nf-start', id: 'scan' }); await until(() => last('ighd-nf')?.state === 'done'); };
  const start = (pks = ['2', '3', '4', '5', '6', '7'], id = 'batch') => post({ source: 'ighd-nf-unfollow-start', id, pks });
  const finished = async () => { await until(() => ['done', 'stopped', 'cancelled', 'refused'].includes(last()?.state)); return last(); };
  return { window, context, XHR, messages, writes, delays, scan, start, finished, post, last, until,
    peak: () => peak, dispose: () => timers.forEach(clearTimeout) };
}

test('selected unfollows use the website mutation, confirm each account, and keep reference pauses', async (t) => {
  const h = harness(); t.after(h.dispose);
  await h.scan(); h.delays.length = 0;
  h.start();
  const end = await h.finished();
  assert.equal(end.state, 'done'); assert.equal(end.completed, 6); assert.equal(h.peak(), 1);
  assert.deepEqual(h.writes.map((w) => w.pk), ['2', '3', '4', '5', '6', '7']);
  for (const w of h.writes) {
    assert.equal(w.url, 'https://www.instagram.com/api/graphql');
    assert.equal(w.init.method, 'POST');
    assert.equal(w.params.get('fb_api_req_friendly_name'), 'usePolarisUnfollowMutation');
    assert.equal(w.params.get('doc_id'), '27789106940691111');
    assert.equal(w.params.get('av'), '99');
    assert.equal(w.init.headers['x-csrftoken'], 'fixture-csrf');
    assert.equal(w.params.get('fb_dtsg'), 'fixture-fb');
  }
  assert.deepEqual(h.delays, [4400, 4400, 4400, 4400, 304400]);
  assert.equal(h.messages.filter((m) => m.removedPk).length, 6);
  h.start(['2'], 'repeat');
  assert.equal((await h.finished()).reason, 'invalid-selection', 'a confirmed removal cannot be submitted again');
});

test('unfollow refuses missing scans, untrusted starts, changed accounts and non-result targets', async (t) => {
  const h = harness(); t.after(h.dispose);
  h.start(); assert.equal((await h.finished()).reason, 'account-changed');
  await h.scan();
  for (const pks of [[], ['1'], ['999'], ['2', '2'], [2]]) {
    h.start(pks); assert.equal((await h.finished()).reason, 'invalid-selection');
  }
  h.context.navigator.userActivation.isActive = false;
  h.start(['2']); assert.equal((await h.finished()).reason, 'no-click');
  h.context.navigator.userActivation.isActive = true;
  h.context.document.cookie = 'ds_user_id=100';
  h.start(['2']); assert.equal((await h.finished()).reason, 'account-changed');
  assert.equal(h.writes.length, 0);
});

test('missing session tokens send no mutation; passive same-origin tokens and operation can be reused', async (t) => {
  const h = harness({ tokens: false }); t.after(h.dispose);
  await h.scan(); h.start(['2']);
  assert.equal((await h.finished()).reason, 'session-unavailable'); assert.equal(h.writes.length, 0);
  const native = new h.XHR(); native.open('POST', '/api/graphql');
  const body = new URLSearchParams({ fb_dtsg: 'fixture-fb', lsd: 'fixture-lsd',
    fb_api_req_friendly_name: 'usePolarisUnfollowMutation', doc_id: '123456789' });
  native.send(body);
  h.start(['2'], 'second'); assert.equal((await h.finished()).state, 'done');
  assert.equal(h.writes[0].params.get('doc_id'), '123456789');
});

test('rate limits, blocks, invalid responses and uncertain outcomes stop without retries or false success', async (t) => {
  const cases = [
    [() => json({ message: 'Please wait' }, { status: 429, headers: { 'retry-after': '120' } }), 'rate-limit'],
    [() => json({ errors: [{ message: 'feedback_required' }] }), 'blocked'],
    [() => new Response('<html>login</html>'), 'blocked'],
    [() => json({ errors: [{ message: 'invalid operation' }] }), 'error'],
    [() => json({ data: { user: { friendship_status: { following: true } } } }), 'unconfirmed'],
    [() => json({ data: { success: true } }), 'unconfirmed'],
    [() => json({ data: { user: { pk: '999', friendship_status: { following: false } } } }), 'unconfirmed'],
    [() => { throw new Error('Network failed'); }, 'network'],
    [() => new Response('oops', { status: 500 }), 'error']
  ];
  for (const [respond, reason] of cases) {
    const h = harness({ respond }); t.after(h.dispose);
    await h.scan(); h.start();
    const end = await h.finished();
    assert.equal(end.state, 'stopped'); assert.equal(end.reason, reason); assert.equal(end.completed, 0);
    for (let i = 0; i < 10; i++) await tick();
    assert.equal(h.writes.length, 1); assert.ok(end.retryAt > Date.now());
    h.start(['3'], 'again'); assert.equal((await h.finished()).reason, 'cooldown');
    h.post({ source: 'ighd-load-post', code: 'Cabcdef1234' });
    await h.until(() => h.messages.some((m) => m.source === 'ighd-load-post-result'));
    assert.equal(h.messages.find((m) => m.source === 'ighd-load-post-result').reason, 'rate limit cooldown');
    assert.equal(h.messages.filter((m) => m.removedPk).length, 0);
  }
});

test('Cancel during an in-flight write reports its result and stops remaining accounts', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ respond: async (pk, init, success) => { await gate; return success(pk); } }); t.after(h.dispose);
  await h.scan(); h.start(); await h.until(() => h.writes.length === 1);
  h.post({ source: 'ighd-nf-unfollow-cancel', id: 'batch' });
  assert.equal(h.writes[0].init.signal.aborted, false, 'an already sent write is allowed to finish');
  release();
  const end = await h.finished();
  assert.equal(end.state, 'cancelled'); assert.equal(end.completed, 1); assert.equal(h.writes.length, 1);
});

test('Cancel interrupts the five-minute break and a queued write checks cancellation again', async (t) => {
  const h = harness({ holdBreak: true }); t.after(h.dispose);
  await h.scan(); h.start(); await h.until(() => h.delays.includes(304400));
  h.post({ source: 'ighd-nf-unfollow-cancel', id: 'batch' });
  assert.equal((await h.finished()).state, 'cancelled'); assert.equal(h.writes.length, 5);

  const queued = harness(); t.after(queued.dispose);
  await queued.scan();
  let release;
  queued.window.testSerial(() => new Promise((r) => { release = r; }));
  await queued.until(() => !!release);
  queued.start();
  queued.post({ source: 'ighd-nf-unfollow-cancel', id: 'batch' }); release();
  assert.equal((await queued.finished()).state, 'cancelled'); assert.equal(queued.writes.length, 0);
});
