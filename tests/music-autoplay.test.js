const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const path = require('node:path');

// Run the shipped music controller and visibility calculation, without starting the rest
// of the content script or contacting Instagram. No test hooks are added to the extension.
const source = readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const music = source.slice(source.indexOf('  const MUSIC_ICON'), source.indexOf('  // Hovering a post'));
const visibility = source.slice(source.indexOf('  function visibleArea('), source.indexOf('  // Index from the carousel'));
const prefetch = source.slice(source.indexOf('  function prefetchEntries('), source.indexOf('  // Asks the site'));
const watch = source.slice(source.indexOf('  function watchPost('), source.indexOf('  // The box that shows'));

function events(target = {}) {
  const listeners = new Map();
  target.addEventListener = (type, callback) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(callback);
  };
  target.emit = (type, data = {}) => {
    for (const callback of listeners.get(type) || []) callback({ type, ...data });
  };
  return target;
}

function harness() {
  const buttons = [];
  const frames = [];
  const notices = [];
  const logs = [];
  const observers = [];
  const timers = [];
  const dwell = new Map();
  const prefetched = [];
  const messages = [];
  const nativeMedia = [];
  const posts = new Map();
  const document = events({ hidden: false, dialog: null });
  document.body = {};
  document.documentElement = {};
  document.querySelectorAll = (selector) => {
    if (selector === '.ighd-music') return buttons.filter((b) => b.isConnected);
    if (selector === '[role="dialog"], dialog[open]') return document.dialog ? [document.dialog] : [];
    if (selector === 'video, audio') return nativeMedia;
    return [];
  };
  document.querySelector = (selector) => {
    if (selector === '[role="dialog"]') return document.dialog;
    if (selector === '.ighd-music') return buttons.find((b) => b.isConnected);
    return buttons.find((b) => b.isConnected && selector.includes(`"${b.dataset.code}"`));
  };
  class Audio {
    constructor() {
      events(this);
      this.paused = true;
      this.src = '';
      this.currentTime = 0;
      this.readyState = 0;
      this.calls = 0;
      this.behavior = 'success';
    }
    play() {
      this.calls++;
      if (this.behavior === 'blocked' || this.behavior === 'error') {
        return Promise.reject(Object.assign(new Error(), {
          name: this.behavior === 'blocked' ? 'NotAllowedError' : 'NotSupportedError'
        }));
      }
      this.paused = false;
      this.emit('play');
      if (this.behavior === 'pending') {
        return new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
      }
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
      if (this.pending) {
        this.pending.reject(Object.assign(new Error(), { name: 'AbortError' }));
        this.pending = null;
      }
      this.emit('pause');
    }
  }
  const window = events();
  window.postMessage = (message, origin) => messages.push({ message, origin });
  const origin = 'https://www.instagram.com';
  const location = { origin, pathname: '/' };
  const context = vm.createContext({
    Audio, document, window, innerWidth: 1000, innerHeight: 1000,
    getComputedStyle: (el) => ({ overflowX: 'visible', overflowY: 'visible', visibility: 'visible', ...el.style }),
    localStorage: { getItem: () => null },
    mediaByCode: posts,
    toast: (...args) => notices.push(args), songLog: (text) => logs.push(text),
    requestAnimationFrame: (callback) => frames.push(callback),
    setInterval: (callback) => timers.push(callback),
    setTimeout: (callback) => { const id = {}; dwell.set(id, callback); return id; },
    clearTimeout: (id) => dwell.delete(id),
    dwellTimers: new WeakMap(), requestPrefetch: (scope) => prefetched.push(scope),
    watchHover: () => {}, codeFor: (group) => group.code, mediaBox: (scope) => scope.box,
    location, fromPage: (e) => e.source === window && e.origin === origin,
    IntersectionObserver: class {
      constructor(callback) { observers.push(callback); }
      observe() {}
    }
  });
  const api = vm.runInContext(`${visibility}\n${music}\n${prefetch}\n${watch}\n({ player, startMusic, toggleMusic, updateFocusPlay, focusedMusicButton, watchPost });`, context);
  function add(code, top = 0, height = 500) {
    const box = {
      top, isConnected: true,
      getBoundingClientRect() {
        return { left: 0, right: 500, top: this.top, bottom: this.top + height, width: 500, height };
      }
    };
    const wrap = { parentElement: box };
    const button = {
      dataset: { code }, isConnected: true, box,
      closest: (selector) => selector === '.ighd-music-wrap' ? wrap : null
    };
    buttons.push(button);
    posts.set(code, { items: [{ type: 'image' }], music: { url: `https://media.example/${code}.m4a`, start: 12000, duration: 15000 } });
    return button;
  }
  function flush() { while (frames.length) frames.shift()(); }
  function silent(code, top = 0, height = 1000, type = 'image') {
    const b = add(code, top, height);
    b.isConnected = false;
    posts.set(code, { items: [{ type }] });
    const scope = { isConnected: true, dataset: {}, box: b.box };
    api.watchPost({ code, closest: () => scope });
    return b;
  }
  function native(top, height = 1000) {
    const media = { top, tagName: 'VIDEO', paused: false, muted: false, volume: 1,
      getBoundingClientRect() {
        return { left: 0, right: 500, top: this.top, bottom: this.top + height, width: 500, height };
      }
    };
    nativeMedia.push(media);
    return media;
  }
  return { ...api, document, window, add, flush, notices, logs, observers, timers,
    dwell, prefetched, messages, origin, posts, silent, native, location };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a photo taller than the viewport can autoplay while filling the screen', async () => {
  const h = harness(); const b = h.add('Tall', 0, 1800);
  assert.equal(h.focusedMusicButton(), b);
  h.updateFocusPlay(); h.flush(); await settle();
  assert.equal(h.player.calls, 1);
  assert.equal(h.player.paused, false);
});

test('scrolling the document does not clip visible posts to the displaced body box', async () => {
  const h = harness(); const b = h.add('A');
  Object.assign(h.document.body, {
    style: { overflowX: 'hidden', overflowY: 'auto' },
    parentElement: h.document.documentElement,
    getBoundingClientRect: () => ({ left: 0, top: -1600, right: 1000, bottom: -600, width: 1000, height: 1000 })
  });
  Object.assign(h.document.documentElement, {
    style: { overflowX: 'visible', overflowY: 'visible' },
    getBoundingClientRect: () => ({ left: 0, top: -1600, right: 1000, bottom: -600, width: 1000, height: 1000 })
  });
  b.box.parentElement = h.document.body;
  assert.equal(h.focusedMusicButton(), b, 'root overflow is applied to the viewport, not the displaced root box');
  h.window.emit('scroll'); h.flush(); await settle();
  assert.equal(h.player.calls, 1);
});

test('a real nested scrolling container still clips its offscreen content', () => {
  const h = harness(); const b = h.add('A', 0, 1000);
  b.box.parentElement = {
    style: { overflowX: 'hidden', overflowY: 'auto' },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 500, bottom: 400, width: 500, height: 400 })
  };
  assert.equal(h.focusedMusicButton(), null);
});

test('display:contents wrappers have no box that can clip the photo', () => {
  const h = harness(); const b = h.add('A');
  b.box.parentElement = {
    style: { display: 'contents', overflowX: 'hidden', overflowY: 'auto' },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 })
  };
  assert.equal(h.focusedMusicButton(), b);
});

test('horizontal-only clipping does not hide a vertically overflowing photo', () => {
  const h = harness(); const b = h.add('A');
  b.box.parentElement = {
    style: { overflowX: 'clip', overflowY: 'visible' },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 500, bottom: 0, width: 500, height: 0 })
  };
  assert.equal(h.focusedMusicButton(), b);
});

test('a carousel still clips a slide shifted outside its horizontal window', () => {
  const h = harness(); const b = h.add('A');
  b.box.getBoundingClientRect = () => ({ left: 500, top: 0, right: 1000, bottom: 500, width: 500, height: 500 });
  b.box.parentElement = {
    style: { overflowX: 'clip', overflowY: 'visible' },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 500, bottom: 0, width: 500, height: 0 })
  };
  assert.equal(h.focusedMusicButton(), null);
});

test('the dominant photo wins over a smaller fully visible neighbor', () => {
  const h = harness(); h.add('Small', 0, 200); const b = h.add('Main', 220, 780);
  assert.equal(h.focusedMusicButton(), b);
});

test('hidden dialog containers do not exclude all feed posts', async () => {
  const h = harness(); const b = h.add('A');
  h.document.dialog = {
    contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 })
  };
  assert.equal(h.focusedMusicButton(), b);
  h.updateFocusPlay(); h.flush(); await settle();
  assert.equal(h.player.paused, false);
});

test('a settled layout can start music even without another scroll event', async () => {
  const h = harness(); const b = h.add('A', 1000);
  h.updateFocusPlay(); h.flush(); await settle();
  b.box.top = 0;
  for (const tick of h.timers) tick();
  h.flush(); await settle();
  assert.equal(h.player.calls, 1);
});

test('layout checks do not repeatedly retry a failed file or run in a hidden tab', async () => {
  const h = harness(); h.add('A'); h.player.behavior = 'error';
  h.updateFocusPlay(); h.flush(); await settle();
  for (let i = 0; i < 3; i++) {
    for (const tick of h.timers) tick();
    h.flush(); await settle();
  }
  assert.equal(h.player.calls, 1);
  h.document.hidden = true;
  for (const tick of h.timers) tick();
  h.flush();
  assert.equal(h.player.calls, 1);
});

test('a failed post can be retried after a different post takes focus', async () => {
  const h = harness(); const a = h.add('A'); const b = h.add('B', 1000);
  h.player.behavior = 'error'; h.updateFocusPlay(); h.flush(); await settle();
  a.box.top = -500; b.box.top = 0;
  h.player.behavior = 'success';
  await h.startMusic(b, 'B', true);
  h.updateFocusPlay(); h.flush(); await settle();
  a.box.top = 0; b.box.top = 1000;
  h.updateFocusPlay(); h.flush(); await settle();
  assert.equal(h.player.calls, 3);
  assert.match(h.player.src, /A\.m4a$/);
});

test('photo observer changes update focus without an explicit scroll', async () => {
  const h = harness(); h.add('A');
  h.observers[0]([]); h.flush(); await settle();
  assert.equal(h.player.calls, 1);
});

test('posts ask for their song as soon as they come near the screen, without dwelling', () => {
  const h = harness(); const a = h.add('Near', 1200); const b = h.add('Far', 3000);
  h.observers[1]([{ target: a.box, isIntersecting: true }, { target: b.box, isIntersecting: false }]);
  assert.equal(h.dwell.size, 0, 'no waiting timer');
  assert.deepEqual(h.prefetched, [a.box]);
});

// The details queue: the post on screen first, then the next one; far posts can be asked again.
function detailsHarness() {
  const remember = source.slice(source.indexOf('  function remember('), source.indexOf('  // ---------- Data ----------'));
  const distance = source.slice(source.indexOf('  // How far a post is'), source.indexOf('  // Asks the site'));
  const state = source.slice(source.indexOf('  let detailsBusy = false;'), source.indexOf('  const logged = new Set();'));
  const queue = source.slice(source.indexOf('  function requestPrefetch('), source.indexOf('  function watchPost('));
  const requested = [];
  const later = [];
  const clock = { now: 0 };
  const context = vm.createContext({
    document: { hidden: false }, innerHeight: 1000, mediaByCode: new Map(), songLog() {},
    codeFor: (group) => group.code, Date: { now: () => clock.now },
    setTimeout: (fn, ms) => later.push(Object.assign(fn, { ms })),
    loadPostDetails: (code) => { requested.push(code); return Promise.resolve({ ok: true }); }
  });
  const api = vm.runInContext(`${remember}
    const detailsTried = new Set(); const detailsQueue = [];
    ${state}\n${distance}\n${queue}\n({ requestPrefetch, detailsTried });`, context);
  const post = (code, top) => ({ isConnected: true, __igtGroup: { code }, querySelector: () => null,
    getBoundingClientRect: () => ({ top, bottom: top + 800 }) });
  // Runs the 800 ms gap after a lookup, leaving any budget retry timer in place.
  const next = async () => { await settle(); later.splice(later.findIndex((fn) => fn.ms === 800), 1)[0](); };
  return { ...api, post, requested, next, later, clock };
}

test('the lookup budget keeps fast scrolling to the post on screen, then waits for the minute', async () => {
  const h = detailsHarness();
  for (let i = 0; i < 20; i++) { h.requestPrefetch(h.post(`Ahead${i}`, 1300)); await h.next(); }
  assert.equal(h.requested.length, 20);
  const held = h.post('Held', 1300);
  h.requestPrefetch(held);
  assert.equal(h.requested.length, 20, 'no more look-ahead after 20 lookups in a minute');
  for (let i = 0; i < 10; i++) { h.requestPrefetch(h.post(`Screen${i}`, 0)); await h.next(); }
  assert.equal(h.requested.length, 30, 'the post on screen is still looked up');
  held.getBoundingClientRect = () => ({ top: 0, bottom: 800 });
  h.requestPrefetch(held); // reaches the screen, but the minute is full
  assert.equal(h.requested.length, 30);
  assert.equal(h.later.length, 1);
  assert.equal(h.later[0].ms, 60000);
  h.clock.now = 60000;
  h.later.shift()();
  assert.deepEqual(h.requested.slice(-1), ['Held']);
});

test('song lookups go to the post on screen before the one ahead', async () => {
  const h = detailsHarness();
  const onScreen = h.post('OnScreen', 100); const ahead = h.post('Ahead', 1300);
  h.requestPrefetch(h.post('First', 0));
  h.requestPrefetch(ahead); h.requestPrefetch(onScreen);
  assert.deepEqual(h.requested, ['First'], 'one request at a time');
  await h.next();
  assert.deepEqual(h.requested, ['First', 'OnScreen']);
  await h.next();
  assert.deepEqual(h.requested, ['First', 'OnScreen', 'Ahead']);
});

test('a queued post scrolled far away is dropped and can be asked for again', async () => {
  const h = detailsHarness();
  const passed = h.post('Passed', 1300);
  h.requestPrefetch(h.post('First', 0)); h.requestPrefetch(passed);
  passed.getBoundingClientRect = () => ({ top: -3000, bottom: -2200 });
  await h.next();
  assert.deepEqual(h.requested, ['First']);
  assert.equal(h.detailsTried.has('Passed'), false);
  passed.getBoundingClientRect = () => ({ top: 1300, bottom: 2100 });
  h.requestPrefetch(passed);
  await h.next();
  assert.deepEqual(h.requested, ['First', 'Passed']);
});

test('a song arriving adds the ♪ button right away instead of after the scroll debounce', () => {
  const scan = source.slice(source.indexOf('  let scanQueued'), source.indexOf('  new MutationObserver(queueScan)'));
  const timers = [];
  let scans = 0;
  const context = vm.createContext({
    document: { hidden: false }, addPostButtons: () => scans++,
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }
  });
  const api = vm.runInContext(`${scan}\n({ queueScan, scanSoon });`, context);
  api.queueScan();
  assert.deepEqual(timers.map((t) => t.ms), [400]);
  api.scanSoon();
  assert.deepEqual(timers.map((t) => t.ms), [0], 'replaces the pending debounce');
  timers.shift().fn();
  assert.equal(scans, 1);
  api.queueScan();
  assert.deepEqual(timers.map((t) => t.ms), [400], 'normal debouncing continues afterwards');
});

test('focus diagnostic reports visibility and block state only to the same page', () => {
  const h = harness(); h.add('Tall', 0, 1800);
  const data = { source: 'ighd-music-status' };
  h.window.emit('message', { source: {}, origin: h.origin, data });
  h.window.emit('message', { source: h.window, origin: 'https://example.com', data });
  assert.equal(h.messages.length, 0);
  h.window.emit('message', { source: h.window, origin: h.origin, data });
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].origin, h.origin);
  const status = JSON.parse(h.messages[0].message.text);
  assert.equal(status.focused, 'Tall');
  assert.equal(status.viewport, '1000x1000');
  assert.equal(status.candidates[0].visible, 100);
  assert.equal(status.blocked, false);
});

test('starts before metadata arrives, at the selected clip offset', async () => {
  const h = harness();
  const b = h.add('A');
  const result = h.startMusic(b, 'A', true);
  assert.equal(h.player.readyState, 0);
  assert.equal(h.player.calls, 1, 'play must run synchronously inside the gesture');
  assert.equal(h.player.currentTime, 12);
  await result;
  assert.equal(h.player.paused, false);
  h.player.currentTime = 28;
  h.player.emit('timeupdate');
  assert.equal(h.player.currentTime, 12, 'loop only the selected clip');
});

test('a song started with the button keeps playing through small scrolls and switches at 60%', async () => {
  const h = harness(); const a = h.add('A', 0, 1000); const b = h.add('B', 1100, 1000);
  await h.startMusic(a, 'A', true);
  a.box.top = -500; b.box.top = 600; // neither post fills 60% of the screen
  h.window.emit('scroll'); h.flush(); await settle();
  assert.equal(h.player.paused, false);
  assert.match(h.player.src, /A\.m4a$/);
  assert.equal(h.player.calls, 1, 'no pause / resume on every scroll');
  a.box.top = -700; b.box.top = 400; // the next post reaches 60%
  h.window.emit('scroll'); h.flush(); await settle();
  assert.equal(h.player.paused, false);
  assert.match(h.player.src, /B\.m4a$/);
  assert.equal(h.player.calls, 2);
  a.box.top = -500; b.box.top = 600; // scrolling back into the gap does not undo the handoff
  h.window.emit('scroll'); h.flush(); await settle();
  assert.match(h.player.src, /B\.m4a$/);
  assert.equal(h.player.calls, 2);
});

test('one page click during a gap clears the old autoplay block for the next post', async () => {
  const h = harness(); const a = h.add('A', 0, 1000); const b = h.add('B', 1100, 1000);
  h.player.behavior = 'blocked'; h.updateFocusPlay(); h.flush(); await settle();
  a.box.top = -500; b.box.top = 600;
  h.window.emit('scroll'); h.flush();
  h.player.behavior = 'success'; h.document.emit('click', { isTrusted: true });
  assert.equal(h.player.calls, 1, 'no song meets the takeover threshold during this click');
  a.box.top = -700; b.box.top = 400;
  h.window.emit('scroll'); h.flush(); await settle();
  assert.equal(h.player.calls, 2);
  assert.match(h.player.src, /B\.m4a$/);
  assert.equal(h.player.paused, false);
});

test('scrolling to the next post before manual playback finishes loading does not keep the old block', async () => {
  const h = harness(); const a = h.add('A', 0, 1000); const b = h.add('B', 1100, 1000);
  h.player.behavior = 'blocked'; h.updateFocusPlay(); h.flush(); await settle();
  h.player.behavior = 'pending'; h.toggleMusic(a, 'A');
  a.box.top = -700; b.box.top = 400;
  h.player.behavior = 'success'; h.updateFocusPlay(); h.flush(); await settle();
  assert.equal(h.player.calls, 3, 'the first autoplay, manual retry, then automatic handoff');
  assert.match(h.player.src, /B\.m4a$/);
  assert.equal(h.player.paused, false);
});

test('a new dominant post pauses the previous song while its details load', async () => {
  const h = harness(); const a = h.add('A', 0, 1000); const b = h.silent('B', 1100);
  await h.startMusic(a, 'A', true);
  a.box.top = -700; b.box.top = 400;
  h.updateFocusPlay(); h.flush(); await settle();
  assert.equal(h.player.paused, true, 'the previous song must not carry over the new post');
  h.window.emit('message', { source: h.window, origin: h.origin,
    data: { source: 'ighd-load-post-result', code: 'B', ok: true } });
  h.flush(); await settle();
  assert.equal(h.player.paused, true);
});

test('late song details switch automatically when the new button appears', async () => {
  const h = harness(); const a = h.add('A', 0, 1000); const b = h.silent('B', 1100);
  await h.startMusic(a, 'A', true);
  a.box.top = -700; b.box.top = 400;
  h.posts.get('B').music = { url: 'https://media.example/B.m4a', start: 5000, duration: 12000 };
  h.window.emit('message', { source: h.window, origin: h.origin,
    data: { source: 'ighd-load-post-result', code: 'B', ok: true } });
  h.flush(); await settle();
  assert.equal(h.player.paused, true, 'the new post dominates, so pause until its own song is ready');
  assert.match(h.player.src, /A\.m4a$/);
  b.isConnected = true;
  for (const tick of h.timers) tick(); h.flush(); await settle();
  assert.match(h.player.src, /B\.m4a$/);
  assert.equal(h.player.currentTime, 5);
});

test('a video reaching the threshold stops extension music', async () => {
  const h = harness(); const a = h.add('A', 0, 1000); const b = h.silent('Video', 1100, 1000, 'video');
  await h.startMusic(a, 'A', true);
  a.box.top = -700; b.box.top = 400;
  h.updateFocusPlay(); h.flush(); await settle();
  assert.equal(h.player.paused, true);
});

test('music stops exactly when the old photo leaves the viewport completely', async () => {
  const h = harness(); const a = h.add('A', 0, 1000);
  await h.startMusic(a, 'A', true);
  a.box.top = -999;
  h.window.emit('scroll'); h.flush(); await settle();
  assert.equal(h.player.paused, false, 'a small remaining part is still visible');
  a.box.top = -1000;
  h.window.emit('scroll'); h.flush(); await settle();
  assert.equal(h.player.paused, true, 'do not require a new eligible post to stop');
});

test('a native reel without post data stops the song when it dominates, even below 60%', async () => {
  const h = harness(); const a = h.add('A', 0, 1000);
  await h.startMusic(a, 'A', true);
  a.box.top = -600; h.native(500); // photo: 40%, native reel: 50%, neither reaches 60%
  h.document.emit('play'); h.flush(); await settle();
  assert.equal(h.player.paused, true);
  assert.equal(h.player.calls, 1, 'must not restart the old song over the reel');
});

test('a new music post dominating at 55% pauses the old song until autoplay at 60%', async () => {
  const h = harness(); const a = h.add('A', 0, 1000); const b = h.add('B', 1100, 1000);
  await h.startMusic(a, 'A', true);
  a.box.top = -600; b.box.top = 450;
  h.window.emit('scroll'); h.flush(); await settle();
  assert.equal(h.player.paused, true);
  assert.equal(h.player.calls, 1);
  b.box.top = 400;
  h.window.emit('scroll'); h.flush(); await settle();
  assert.equal(h.player.paused, false);
  assert.match(h.player.src, /B\.m4a$/);
});

test('a small eligible photo cannot restart over a larger native reel', async () => {
  const h = harness(); const a = h.add('A', 0, 200);
  await h.startMusic(a, 'A', true);
  h.native(250, 700);
  h.document.emit('play'); h.flush(); await settle();
  assert.equal(h.player.paused, true);
  assert.equal(h.player.calls, 1);
});

test('a browser that rejects each automatic source still reports a fresh NotAllowedError', async () => {
  const h = harness(); const a = h.add('A', 0, 1000); const b = h.add('B', 1100, 1000);
  await h.startMusic(a, 'A', true);
  h.player.behavior = 'blocked'; a.box.top = -700; b.box.top = 400;
  h.updateFocusPlay(); h.flush(); await settle();
  h.window.emit('message', { source: h.window, origin: h.origin, data: { source: 'ighd-music-status' } });
  const status = JSON.parse(h.messages.at(-1).message.text);
  assert.equal(status.blocked, true);
  assert.deepEqual(status.lastError, { code: 'B', name: 'NotAllowedError', mode: 'autoplay',
    message: '', userActivated: null });
  assert.match(h.notices[0][0], /browser rejected autoplay/);
});

test('navigation away stops the old song even during a handoff', async () => {
  const h = harness(); const a = h.add('A', 0, 1000);
  await h.startMusic(a, 'A', true);
  a.box.top = -500;
  h.location.pathname = '/stories/example/';
  h.updateFocusPlay(); h.flush(); await settle();
  assert.equal(h.player.paused, true);
  assert.equal(h.player.calls, 1);
});

test('captured scroll switches at 60% of screen height and keeps music between posts', async () => {
  const h = harness();
  const a = h.add('A', -400, 1000); // exactly 60% of the screen
  const b = h.add('B', 800, 1000); // 20% of the screen
  h.window.emit('scroll'); h.flush(); await settle();
  assert.equal(h.focusedMusicButton(), a);
  assert.match(h.player.src, /A\.m4a$/);
  a.box.top = -1000; b.box.top = 0;
  h.window.emit('scroll'); h.flush(); await settle();
  assert.match(h.player.src, /B\.m4a$/);
  b.box.top = 800;
  h.window.emit('scroll'); h.flush();
  assert.equal(h.player.paused, false, 'keep the current song until another post takes over');
});

test('blocked autoplay logs the error, notifies once and waits for a trusted gesture', async () => {
  const h = harness();
  h.add('A'); h.player.behavior = 'blocked';
  h.updateFocusPlay(); h.flush(); await settle();
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0][0], /browser rejected autoplay/);
  assert.equal(h.notices[0][1], 10000);
  assert.ok(h.logs.some((line) => line.includes('NotAllowedError')));
  h.window.emit('scroll'); h.flush(); await settle();
  h.document.emit('click', { isTrusted: false });
  assert.equal(h.player.calls, 1);
  h.document.emit('click', { isTrusted: true }); await settle();
  assert.equal(h.player.calls, 2);
  assert.equal(h.notices.length, 1);
  h.player.behavior = 'success';
  h.document.emit('click', { isTrusted: true });
  assert.equal(h.player.calls, 3, 'retry stays inside the click, without an animation frame');
  await settle();
  assert.equal(h.player.paused, false);
  const b = h.add('B');
  b.box.top = 0;
  h.document.querySelectorAll('.ighd-music')[0].box.top = -500;
  h.window.emit('scroll'); h.flush(); await settle();
  assert.match(h.player.src, /B\.m4a$/, 'autoplay resumes for subsequent posts');
});

test('Enter retries a block, while repeat keys and music controls do not', async () => {
  const h = harness(); const b = h.add('A');
  h.player.behavior = 'blocked';
  await h.startMusic(b, 'A', false);
  h.document.emit('keydown', { isTrusted: true, code: 'Enter', repeat: true });
  h.document.emit('keydown', { isTrusted: true, code: 'Escape' });
  h.document.emit('click', { isTrusted: true, target: b });
  assert.equal(h.player.calls, 1);
  h.player.behavior = 'success';
  h.document.emit('keydown', { isTrusted: true, code: 'Enter' });
  assert.equal(h.player.calls, 2);
  await settle();
});

test('manual pause carries over to later posts until ♪ is pressed again', async () => {
  const h = harness(); const a = h.add('A'); const b = h.add('B', 1000); const c = h.add('C', 2000);
  h.updateFocusPlay(); h.flush(); await settle();
  h.toggleMusic(a, 'A');
  h.window.emit('scroll'); h.flush();
  h.document.emit('click', { isTrusted: true });
  assert.equal(h.player.calls, 1);
  assert.equal(h.player.paused, true);
  a.box.top = -1000; b.box.top = 0; c.box.top = 1000;
  h.window.emit('scroll'); h.flush(); await settle();
  for (const tick of h.timers) tick(); h.flush(); await settle();
  assert.equal(h.player.calls, 1, 'the next post must not autoplay while paused');
  assert.equal(h.player.paused, true);
  a.box.top = 0; b.box.top = 1000; c.box.top = 2000;
  h.window.emit('scroll'); h.flush(); await settle();
  assert.equal(h.player.calls, 1, 'returning to the paused post does not resume it either');
  a.box.top = -1000; b.box.top = 0; c.box.top = 1000;
  h.window.emit('scroll'); h.flush(); await settle();
  h.toggleMusic(b, 'B'); await settle();
  assert.equal(h.player.calls, 2);
  assert.equal(h.player.paused, false);
  assert.match(h.player.src, /B\.m4a$/);
  b.box.top = -1000; c.box.top = 0;
  h.window.emit('scroll'); h.flush(); await settle();
  assert.equal(h.player.calls, 3, 'pressing play turns automatic playback back on');
  assert.match(h.player.src, /C\.m4a$/);
  assert.equal(h.player.paused, false);
});

test('pending playback is deduplicated and cancelled immediately when the tab hides', async () => {
  const h = harness(); h.add('A'); h.player.behavior = 'pending';
  h.updateFocusPlay(); h.flush();
  h.updateFocusPlay(); h.flush();
  assert.equal(h.player.calls, 1);
  h.document.hidden = true;
  h.document.emit('visibilitychange');
  assert.equal(h.player.paused, true, 'must not wait for suspended animation frames');
  await settle();
  h.player.emit('loadedmetadata');
  assert.equal(h.player.calls, 1, 'late metadata must not restart the hidden post');
  assert.equal(h.notices.length, 0);
  h.player.behavior = 'success'; h.document.hidden = false;
  h.document.emit('visibilitychange'); h.flush(); await settle();
  assert.equal(h.player.calls, 2);
});

test('switching away cancels pending playback without a false error notice', async () => {
  const h = harness(); const a = h.add('A'); const b = h.add('B', 1000);
  h.player.behavior = 'pending';
  h.updateFocusPlay(); h.flush();
  a.box.top = -500; b.box.top = 0; h.player.behavior = 'success';
  h.window.emit('scroll'); h.flush(); await settle();
  assert.match(h.player.src, /B\.m4a$/);
  assert.equal(h.player.paused, false);
  assert.equal(h.notices.length, 0);
  assert.equal(h.logs.some((line) => line.includes('AbortError')), false);
});

test('clicking pause cancels a pending start and does not autoplay it again', async () => {
  const h = harness(); const b = h.add('A'); h.player.behavior = 'pending';
  h.updateFocusPlay(); h.flush();
  h.toggleMusic(b, 'A'); await settle();
  h.updateFocusPlay(); h.flush();
  assert.equal(h.player.calls, 1);
  assert.equal(h.player.paused, true);
});

test('open dialogs exclude feed music and removal of the focused post stops playback', async () => {
  const h = harness(); const a = h.add('A'); const b = h.add('B');
  h.document.dialog = {
    contains: (node) => node === b || node === b.box,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 })
  };
  h.updateFocusPlay(); h.flush(); await settle();
  assert.match(h.player.src, /B\.m4a$/);
  b.isConnected = false; a.box.top = -500;
  h.updateFocusPlay(); h.flush();
  assert.equal(h.player.paused, true);
});

test('real playback failures are logged and reported for manual play', async () => {
  const h = harness(); const b = h.add('A'); h.player.behavior = 'error';
  await h.startMusic(b, 'A', true);
  assert.ok(h.logs.some((line) => line.includes('NotSupportedError')));
  assert.equal(h.notices[0][0], 'Could not play the music.');
  h.player.behavior = 'success';
  h.updateFocusPlay(); h.flush(); await settle();
  assert.equal(h.player.paused, false, 'a media error must not be treated as an autoplay block');
});
