const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const path = require('node:path');

const read = (name) => readFileSync(path.join(__dirname, '..', name), 'utf8');
const content = read('content.js');
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
const photo = { code: 'Sample123', display_url: 'https://s.cdninstagram.com/photo.jpg', user: { username: 'creator' } };

function interceptor(fetcher = async () => new Response(JSON.stringify(photo))) {
  const timers = new Map(), messages = [], listeners = new Map();
  let now = 0, sequence = 0;
  class XHR {
    constructor() { this.loads = []; this.responseType = ''; this.responseText = '{}'; }
    addEventListener(type, fn) { if (type === 'load') this.loads.push(fn); }
    open() {} setRequestHeader() {} send() {}
  }
  const window = { fetch: fetcher, addEventListener: (type, fn) => listeners.set(type, fn),
    postMessage: (msg) => messages.push(msg) };
  const context = vm.createContext({ window, XMLHttpRequest: XHR, URL, Request, Response, Headers,
    URLSearchParams, TextDecoder, AbortController,
    Date: class extends Date { static now() { return now; } },
    document: { readyState: 'loading', cookie: '', addEventListener() {}, querySelectorAll: () => [] },
    sessionStorage: { getItem: () => null }, console: { log() {}, table() {} },
    location: { origin: 'https://www.instagram.com', href: 'https://www.instagram.com/', pathname: '/' },
    setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id)
  });
  const source = read('intercept.js');
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, `window.testApi = {
    loadPostDetails, readResponseText, collect, parseAll,
    get jobs() { return detailJobs.size; }, get reads() { return passiveReads; }
  }; })();`), context);
  return { ...window.testApi, api: window.testApi, window, messages, XHR,
    expire: () => { now += 8001; for (const timer of [...timers.values()]) timer.fn(); },
    get timerCount() { return timers.size; } };
}

test('10,000 arriving posts, stories and profiles retain only 500 of each', () => {
  const listeners = [];
  const context = vm.createContext({
    window: { addEventListener: (_, fn) => listeners.push(fn) }, fromPage: () => true, queueScan() {}
  });
  vm.runInContext(`${between(content, '  function remember(', '  // ---------- Data ----------')}
    const detailsTried = new Set();
    ${between(content, '  const seen = new Map()', '  function interceptDiag(')}
    ${between(content, '  const mediaByCode = new Map()', '  // A real video file')}
    ${between(content, '  const itemScore', '  const POST_PATH')}
    ${between(content, '  const mediaByPk = new Map()', '  // The biggest photo or video')}
    globalThis.state = { seen, mediaByCode, mediaByPk };`, context);
  const dispatch = (data) => listeners.forEach((fn) => fn({ data }));
  for (let i = 0; i < 10000; i++) {
    dispatch({ source: 'ighd-pics', pics: [{ username: `u${i}`, url: `https://s.cdninstagram.com/${i}.jpg` }] });
    dispatch({ source: 'ighd-media', media: [{ code: `Post${i}`, items: [{ type: 'image' }] }] });
    dispatch({ source: 'ighd-items', items: [{ pk: String(i), url: `https://s.cdninstagram.com/${i}.jpg`, type: 'image' }] });
  }
  for (const cache of Object.values(context.state)) assert.equal(cache.size, 500);
  assert.equal(context.state.mediaByCode.has('Post9999'), true);
  assert.equal(context.state.mediaByCode.has('Post0'), false);
});

test('post-detail requests are serialized and duplicate requests share one network operation', async () => {
  const releases = []; let calls = 0, active = 0, peak = 0;
  const h = interceptor(async () => {
    calls++; peak = Math.max(peak, ++active);
    await new Promise((resolve) => releases.push(resolve));
    active--;
    return new Response(JSON.stringify(photo));
  });
  const a = h.api.loadPostDetails('AAAAAAA'), duplicate = h.api.loadPostDetails('AAAAAAA');
  const b = h.api.loadPostDetails('BBBBBBB');
  assert.equal(a, duplicate);
  await settle(); assert.equal(calls, 1);
  releases.shift()(); await a; await settle();
  assert.equal(calls, 2); releases.shift()(); await b; await settle();
  assert.equal(peak, 1); assert.equal(h.api.jobs, 0); assert.equal(h.timerCount, 0);
});

test('the detail queue is bounded and an aborted request frees its slot', async () => {
  let calls = 0;
  const h = interceptor((_url, options) => new Promise((_, reject) => {
    calls++;
    options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
  }));
  const jobs = Array.from({ length: 6 }, (_, i) => h.api.loadPostDetails(`Post00${i}`));
  const full = await h.api.loadPostDetails('Overflow');
  assert.equal(full.reason, 'queue full'); assert.equal(h.api.jobs, 6);
  for (let i = 0; i < jobs.length; i++) { await settle(); h.expire(); await jobs[i]; }
  await settle(); assert.equal(calls, 6); assert.equal(h.api.jobs, 0);
});

test('HTTP 429 stops subsequent detail traffic during the cooldown', async () => {
  let calls = 0;
  const h = interceptor(async () => { calls++; return new Response('{}', { status: 429 }); });
  await h.api.loadPostDetails('AAAAAAA');
  const result = await h.api.loadPostDetails('BBBBBBB');
  assert.equal(result.status, 429); assert.equal(calls, 1);
});

test('passive inspection skips oversized declared responses and preserves the original', async () => {
  const original = new Response('original', { headers: { 'content-length': String(5 * 1024 * 1024) } });
  let clones = 0; original.clone = () => { clones++; throw Error('Should not clone'); };
  const h = interceptor(async () => original);
  const result = await h.window.fetch('/api/v1/feed/timeline/');
  assert.equal(result, original); assert.equal(clones, 0); assert.equal(await result.text(), 'original');
});

test('streamed JSON exceeding 4 MiB is cancelled without parsing it', async () => {
  let chunks = 0, cancelled = false;
  const h = interceptor();
  const response = new Response(new ReadableStream({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; }
  }));
  assert.equal(await h.api.readResponseText(response), null);
  assert.equal(cancelled, true); assert.ok(chunks <= 6);
});

test('cancelling an oversized response copy leaves the complete site response readable', async () => {
  const original = new Response(new Uint8Array(5 * 1024 * 1024));
  const h = interceptor(async () => original);
  const response = await h.window.fetch('/api/v1/feed/');
  assert.equal((await response.arrayBuffer()).byteLength, 5 * 1024 * 1024);
  await settle(); assert.equal(h.api.reads, 0);
});

test('at most two response clones are inspected at once', async () => {
  let clones = 0;
  const originals = [];
  const h = interceptor(async () => {
    const original = new Response('untouched'); originals.push(original);
    original.clone = () => { clones++; return new Response(new ReadableStream({ start() {} })); };
    return original;
  });
  await Promise.all(Array.from({ length: 20 }, () => h.window.fetch('/api/v1/feed/')));
  assert.equal(clones, 2); assert.equal(h.api.reads, 2);
  h.expire(); await settle(); assert.equal(h.api.reads, 0);
  for (const original of originals) assert.equal(await original.text(), 'untouched');
});

test('large JSON object traversal stops at its node / field budget', () => {
  const h = interceptor(); let visited = 0;
  const node = { get username() { visited++; return undefined; }, child: {} };
  h.api.collect(Array(100000).fill(node), { pics: [], media: [], items: [] }, 0);
  assert.ok(visited > 0 && visited < 20000);
});

test('newline-delimited JSON is limited to 100 documents per response', () => {
  const h = interceptor();
  assert.equal(h.api.parseAll(Array(10000).fill('{}').join('\n')).length, 100);
});

test('reopening an XMLHttpRequest does not accumulate load listeners', () => {
  const h = interceptor(); const request = new h.XHR();
  for (let i = 0; i < 1000; i++) request.open('GET', '/api/v1/feed/');
  assert.equal(request.loads.length, 1);
});

test('timed-out content requests remove all retained waiter callbacks', () => {
  const timers = new Map(); let next = 0;
  const context = vm.createContext({ fromPage: () => true,
    window: { addEventListener() {}, postMessage() {} }, location: { origin: 'https://www.instagram.com' },
    setTimeout: (fn) => { const id = ++next; timers.set(id, fn); return id; }, clearTimeout: (id) => timers.delete(id)
  });
  vm.runInContext(`${between(content, '  const detailsWaiters', '  function requestPrefetch(')}
    globalThis.api = { loadPostDetails, detailsWaiters };`, context);
  for (let i = 0; i < 1000; i++) context.api.loadPostDetails(`Post${i}`);
  for (const fn of [...timers.values()]) fn();
  assert.equal(context.api.detailsWaiters.size, 0); assert.equal(timers.size, 0);
});

function downloader(fetcher, fixer = () => null) {
  const downloads = []; let fetches = 0;
  const context = vm.createContext({ AbortController, Uint8Array, setTimeout, clearTimeout,
    fetch: (...args) => { fetches++; return fetcher(...args); }, igtFixLowFpsMp4: fixer,
    toDataUrl: async (buffer) => `data:video/mp4;base64,${Buffer.from(buffer).toString('base64')}`,
    download: async (url) => { downloads.push(url); return true; }
  });
  vm.runInContext(`${between(content, '  const MAX_REPAIR_BYTES', '  const fileKey')}
    globalThis.downloadMedia = downloadMedia;`, context);
  return { downloads, run: (repair = false) => context.downloadMedia({ type: 'video', url: 'https://s.cdninstagram.com/a.mp4' }, 'a.mp4', repair),
    get fetches() { return fetches; } };
}

test('ordinary video downloads go directly to the downloader without a buffered fetch', async () => {
  const h = downloader(() => { throw Error('Unexpected fetch'); });
  assert.equal(await h.run(), true); assert.equal(h.fetches, 0); assert.match(h.downloads[0], /^https:/);
});

test('a small story not requiring repair reuses its bytes instead of downloading twice', async () => {
  const h = downloader(async () => new Response('video', { headers: { 'content-length': '5' } }));
  assert.equal(await h.run(true), true); assert.equal(h.fetches, 1); assert.match(h.downloads[0], /^data:/);
});

test('large or unknown-size stories bypass in-memory processing', async () => {
  for (const size of [null, String(9 * 1024 * 1024)]) {
    let signal;
    const h = downloader(async (_url, options) => {
      signal = options.signal;
      return new Response(new ReadableStream({ start() {} }), { headers: size ? { 'content-length': size } : {} });
    });
    assert.equal(await h.run(true), true); assert.match(h.downloads[0], /^https:/);
    // The abort signal closes a real fetch body; no stream read or allocation is attempted here.
    assert.equal(h.fetches, 1);
    assert.equal(signal.aborted, true);
  }
});

test('a story exceeding its advertised size cannot grow the repair buffer past 8 MiB', async () => {
  let cancelled = false, fixes = 0;
  const h = downloader(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(9 * 1024 * 1024)); },
    cancel() { cancelled = true; }
  }), { headers: { 'content-length': '1' } }), () => { fixes++; });
  await h.run(true);
  assert.equal(cancelled, true); assert.equal(fixes, 0); assert.match(h.downloads[0], /^https:/);
});

test('only one story is buffered at a time', async () => {
  let release;
  const h = downloader(() => new Promise((resolve) => { release = resolve; }));
  const first = h.run(true); await h.run(true);
  assert.equal(h.fetches, 1); assert.match(h.downloads[0], /^https:/);
  release(new Response('video', { headers: { 'content-length': '5' } })); await first;
  assert.equal(h.downloads.length, 2);
});

test('unchanged music icons do not create a mutation / rescan loop', () => {
  let writes = 0;
  const b = { dataset: {}, set innerHTML(_) { writes++; } };
  const context = vm.createContext({ document: { querySelectorAll: () => [b] }, playing: null,
    player: { paused: true }, MUSIC_ICON: '<svg/>', PAUSE_ICON: '<svg/>' });
  vm.runInContext(between(content, '  function refreshMusicIcons(', "  player.addEventListener('play'"), context);
  for (let i = 0; i < 1000; i++) vm.runInContext('refreshMusicIcons()', context);
  assert.equal(writes, 1);
});

test('detached posts and media are unobserved and released on a scan', () => {
  const scope = { isConnected: false }, box = { isConnected: false };
  const unobserved = [];
  const context = vm.createContext({
    watchedPosts: new Set([scope]), observedMusicBoxes: new Set([box]), musicPosts: new Map([[scope, { box }]]),
    dwellTimers: new WeakMap(), clearTimeout() {}, location: { pathname: '/stories/example/' },
    prefetchObserver: { unobserve: (node) => unobserved.push(node) }, musicVisibility: { unobserve: (node) => unobserved.push(node) }
  });
  vm.runInContext(`${between(content, '  function addPostButtons(', '  let scanQueued')}
    addPostButtons();`, context);
  assert.equal(context.watchedPosts.size, 0); assert.equal(context.observedMusicBoxes.size, 0);
  assert.equal(context.musicPosts.size, 0); assert.equal(unobserved.length, 2);
});

function mp4Box(type, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(8); header.writeUInt32BE(payload.length + 8); header.write(type, 4);
  return Buffer.concat([header, payload]);
}
function musicStory() {
  const mdhd = Buffer.alloc(20); mdhd.writeUInt32BE(1000, 12);
  const hdlr = Buffer.alloc(12); hdlr.write('vide', 8);
  const stts = Buffer.alloc(16); stts.writeUInt32BE(1, 4); stts.writeUInt32BE(30, 8); stts.writeUInt32BE(1000, 12);
  const stco = Buffer.alloc(12); stco.writeUInt32BE(1, 4);
  const build = () => mp4Box('moov', mp4Box('trak', mp4Box('mdia', Buffer.concat([
    mp4Box('mdhd', mdhd), mp4Box('hdlr', hdlr), mp4Box('minf', mp4Box('stbl', Buffer.concat([mp4Box('stts', stts), mp4Box('stco', stco)])))
  ]))));
  const before = build(); stco.writeUInt32BE(before.length + 8, 8);
  const file = Buffer.concat([build(), mp4Box('mdat', Buffer.from('unchanged video / audio data'))]);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.length);
}

test('bounded MP4 repair preserves duration, media bytes and adjusted chunk offsets', () => {
  const { fixLowFpsMp4 } = require('../mp4fix.js');
  const original = Buffer.from(musicStory()); const fixed = Buffer.from(fixLowFpsMp4(musicStory()));
  assert.equal(fixed.length, original.length + 8);
  const at = fixed.indexOf('stts'), entries = fixed.readUInt32BE(at + 8); let total = 0;
  for (let i = 0; i < entries; i++) total += fixed.readUInt32BE(at + 12 + i * 8) * fixed.readUInt32BE(at + 16 + i * 8);
  assert.equal(total, 30000);
  assert.ok(fixed.subarray(-27).equals(original.subarray(-27)));
  const oldOffset = original.readUInt32BE(original.indexOf('stco') + 12);
  assert.equal(fixed.readUInt32BE(fixed.indexOf('stco') + 12), oldOffset + 8);
});

test('malformed MP4 nesting and timing tables terminate without unbounded work', () => {
  const { fixLowFpsMp4 } = require('../mp4fix.js');
  let nested = Buffer.alloc(0);
  for (let i = 0; i < 20; i++) nested = mp4Box('moov', nested);
  assert.throws(() => fixLowFpsMp4(nested.buffer.slice(nested.byteOffset, nested.byteOffset + nested.length)), /nesting limit/);
  const malformed = Buffer.from(musicStory()); malformed.writeUInt32BE(0xffffffff, malformed.indexOf('stts') + 8);
  assert.equal(fixLowFpsMp4(malformed.buffer.slice(malformed.byteOffset, malformed.byteOffset + malformed.length)), null);
});
