const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const path = require('node:path');

const read = (name) => readFileSync(path.join(__dirname, '..', name), 'utf8');
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };
function event() {
  const listeners = [];
  return { addListener: (fn) => listeners.push(fn), emit: (...args) => listeners.map((fn) => fn(...args)) };
}
function domEvents(obj = {}) {
  const listeners = new Map();
  obj.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  obj.emit = (type, data = {}) => { for (const fn of listeners.get(type) || []) fn({ type, ...data }); };
  return obj;
}

function harness({ delayCreation = false } = {}) {
  const extensionId = 'test-ig-tools';
  const extensionURL = (name) => `chrome-extension://${extensionId}/${name}`;
  const runtimeListeners = [];
  const connectEvent = event();
  const offscreenIntervals = [];
  const timers = new Map();
  const pageAudio = [];
  const extensionAudio = [];
  let now = 0;
  let exists = false;
  let creations = 0;
  let ownerId = 0;
  let finishCreation;
  const deferred = delayCreation ? new Promise((resolve) => { finishCreation = resolve; }) : null;

  function AudioClass(list, initialBehavior) {
    return class {
      constructor() {
        domEvents(this); list.push(this);
        Object.assign(this, { src: '', currentTime: 0, paused: true, volume: 0.7,
          readyState: 0, calls: 0, behavior: initialBehavior });
      }
      play() {
        this.calls++;
        if (this.behavior === 'blocked') return Promise.reject(Object.assign(new Error('User gesture required'), { name: 'NotAllowedError' }));
        this.paused = false; this.emit('play');
        if (this.behavior === 'pending') return new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
        return Promise.resolve();
      }
      pause() {
        const changed = !this.paused;
        this.paused = true;
        if (this.pending) {
          this.pending.reject(Object.assign(new Error('Interrupted'), { name: 'AbortError' }));
          this.pending = null;
        }
        if (changed) this.emit('pause');
      }
      removeAttribute(name) { if (name === 'src') this.src = ''; }
      load() { this.currentTime = 0; }
    };
  }
  function runtime(context, sender) {
    return {
      id: extensionId, getURL: extensionURL, getManifest: () => ({ version: '2.3.0' }),
      onConnect: connectEvent,
      onMessage: { addListener: (fn) => runtimeListeners.push({ context, fn }) },
      getContexts: async () => exists ? [{}] : [],
      sendMessage: (msg) => new Promise((resolve, reject) => {
        let waiting = false;
        for (const listener of runtimeListeners) {
          if (listener.context === context) continue;
          try { if (listener.fn(msg, sender, resolve) === true) waiting = true; }
          catch (error) { reject(error); return; }
        }
        if (!waiting) resolve(undefined);
      })
    };
  }
  const offscreenRuntime = runtime('offscreen', { id: extensionId, url: extensionURL('offscreen.html') });
  function loadOffscreen() {
    exists = true;
    vm.runInNewContext(read('offscreen.js'), {
      chrome: { runtime: offscreenRuntime }, Audio: AudioClass(extensionAudio, 'success'),
      Date: { now: () => now }, setInterval: (fn) => offscreenIntervals.push(fn)
    });
  }
  const bgRuntime = runtime('background', { id: extensionId });
  vm.runInNewContext(read('background.js'), {
    URL, crypto: { randomUUID: () => `owner-${++ownerId}` },
    chrome: { runtime: bgRuntime, downloads: {}, offscreen: {
      createDocument: async (options) => {
        assert.deepEqual(Array.from(options.reasons), ['AUDIO_PLAYBACK']);
        creations++;
        if (deferred) await deferred;
        loadOffscreen();
      }
    } }
  });

  function client({ senderURL = 'https://www.instagram.com/', frameId = 0, controller = false, pageBehavior = 'blocked' } = {}) {
    const portToClient = event(); const portToBackground = event(); const disconnected = event();
    let closed = false;
    const disconnect = () => { if (!closed) { closed = true; disconnected.emit(); } };
    const pagePort = { onMessage: portToClient, onDisconnect: disconnected, disconnect,
      postMessage: (msg) => {
        if (closed) throw new Error('Port closed');
        queueMicrotask(() => { if (!closed) portToBackground.emit(msg); });
      }
    };
    const backgroundPort = { name: 'igt-music',
      sender: { tab: { id: ownerId + 1 }, frameId, url: senderURL },
      onMessage: portToBackground, onDisconnect: disconnected, disconnect,
      postMessage: (msg) => { if (!closed) queueMicrotask(() => { if (!closed) portToClient.emit(msg); }); }
    };
    const contentRuntime = runtime(`content-${ownerId}`, { id: extensionId, tab: { id: 1 }, url: senderURL });
    contentRuntime.connect = () => { connectEvent.emit(backgroundPort); return pagePort; };
    const window = domEvents();
    const document = domEvents({ hidden: false, body: {}, documentElement: {} });
    const frames = []; const buttons = []; const media = new Map(); const logs = [];
    const intervals = [];
    document.querySelectorAll = (selector) => selector === '.ighd-music' ? buttons : [];
    document.querySelector = (selector) => selector === '.ighd-music' ? buttons[0] : null;
    const context = vm.createContext({
      chrome: { runtime: contentRuntime }, Audio: AudioClass(pageAudio, pageBehavior), window, document,
      setInterval: (fn) => intervals.push(fn), setTimeout: (fn) => { const id = {}; timers.set(id, fn); return id; },
      clearTimeout: (id) => timers.delete(id), innerWidth: 1000, innerHeight: 1000,
      getComputedStyle: () => ({ overflowX: 'visible', overflowY: 'visible' }),
      localStorage: { getItem: () => null }, requestAnimationFrame: (fn) => frames.push(fn),
      IntersectionObserver: class {}, mediaByCode: media, songLog: (text) => logs.push(text),
      toast: () => {}, location: { pathname: '/', origin: 'https://www.instagram.com' }, fromPage: () => false
    });
    vm.runInContext(read('music-player.js'), context);
    let api;
    if (controller) {
      const source = read('content.js');
      const visibility = source.slice(source.indexOf('  function visibleArea('), source.indexOf('  // Index from the carousel'));
      const music = source.slice(source.indexOf('  const MUSIC_ICON'), source.indexOf('  // Hovering a post'));
      api = vm.runInContext(`${visibility}\n${music}\n({ player, updateFocusPlay });`, context);
    } else api = vm.runInContext('({ player: igtCreateMusicPlayer() })', context);
    function add(code, top = 0) {
      const box = { top, getBoundingClientRect() {
        return { left: 0, right: 500, top: this.top, bottom: this.top + 800, width: 500, height: 800 };
      } };
      const b = { isConnected: true, dataset: { code }, box,
        closest: () => ({ parentElement: box }) };
      buttons.push(b);
      media.set(code, { music: { url: `https://scontent.cdninstagram.com/${code}.m4a`, start: 12000, duration: 15000 } });
      return b;
    }
    const prepare = (code = 'A') => {
      api.player.src = `https://scontent.cdninstagram.com/${code}.m4a`;
      api.player.setClip(12000, 15000); api.player.currentTime = 12;
    };
    return { ...api, window, document, logs, add, prepare, port: pagePort,
      tick: () => intervals.forEach((fn) => fn()),
      flush: () => { while (frames.length) frames.shift()(); },
      raw: (msg) => pagePort.postMessage(msg), get closed() { return closed; } };
  }
  return { client, pageAudio, extensionAudio, timers, finishCreation,
    elapse: (ms) => { now += ms; }, sweep: () => offscreenIntervals.forEach((fn) => fn()),
    get creations() { return creations; },
    expire: () => { now += 7000; for (const tick of offscreenIntervals) tick(); } };
}

test('automatic page rejection falls back to extension audio without a click', async () => {
  const h = harness(); const c = h.client(); c.prepare();
  await c.player.play(); await settle();
  assert.equal(h.pageAudio[0].calls, 1);
  assert.equal(h.pageAudio[0].src, '', 'release the failed page resource');
  assert.equal(c.player.engine, 'extension');
  assert.equal(c.player.paused, false);
  assert.equal(h.extensionAudio[0].currentTime, 12);
  assert.equal(h.creations, 1);
});

test('pausing the page player releases the network source and resumes at the same position', async () => {
  const h = harness(); const c = h.client({ pageBehavior: 'success' }); c.prepare();
  await c.player.play(); h.pageAudio[0].currentTime = 19;
  c.player.pause();
  assert.equal(h.pageAudio[0].src, '');
  assert.equal(c.player.currentTime, 19);
  await c.player.play();
  assert.match(h.pageAudio[0].src, /A\.m4a$/);
  assert.equal(h.pageAudio[0].currentTime, 19);
  assert.equal(h.creations, 0);
});

test('the actual focus controller can start before any gesture and pause offscreen', async () => {
  const h = harness(); const c = h.client({ controller: true }); const b = c.add('A');
  c.updateFocusPlay(); c.flush(); await settle();
  assert.equal(c.player.engine, 'extension');
  assert.equal(c.player.paused, false);
  assert.ok(c.logs.some((line) => line.includes('playing (autoplay)')));
  b.box.top = -800;
  c.updateFocusPlay(); c.flush(); await settle();
  assert.equal(c.player.paused, true);
  assert.equal(h.extensionAudio[0].paused, true);
  assert.equal(h.extensionAudio[0].src, '');
});

test('hiding the tab cancels the extension player through the shipped controller', async () => {
  const h = harness(); const c = h.client({ controller: true }); c.add('A');
  c.updateFocusPlay(); c.flush(); await settle();
  c.document.hidden = true; c.document.emit('visibilitychange'); await settle();
  assert.equal(h.extensionAudio[0].paused, true);
});

test('pause during document creation prevents a late automatic start', async () => {
  const h = harness({ delayCreation: true }); const c = h.client(); c.prepare();
  const starting = c.player.play(); const result = assert.rejects(starting, { name: 'AbortError' });
  await settle(); c.player.pause(); await settle(); h.finishCreation(); await result; await settle();
  assert.equal(h.extensionAudio[0].calls, 0);
  assert.equal(c.player.paused, true);
});

test('switching songs reuses one document, selected clip and remembered volume', async () => {
  const h = harness(); const c = h.client(); c.prepare(); await c.player.play();
  c.player.pause(); c.prepare('B'); c.player.volume = 0.4; await c.player.play(); await settle();
  assert.equal(h.creations, 1);
  assert.match(h.extensionAudio[0].src, /B\.m4a$/);
  assert.equal(h.extensionAudio[0].volume, 0.4);
  h.extensionAudio[0].currentTime = 28; h.extensionAudio[0].emit('timeupdate'); await settle();
  assert.equal(h.extensionAudio[0].currentTime, 12);
  assert.equal(c.player.currentTime, 12);
});

test('closing the tab releases the source immediately', async () => {
  const h = harness(); const c = h.client(); c.prepare(); await c.player.play();
  c.window.emit('pagehide'); await settle();
  assert.equal(h.extensionAudio[0].paused, true);
  assert.equal(h.extensionAudio[0].src, '');
});

test('a missing heartbeat stops orphaned audio', async () => {
  const h = harness(); const c = h.client(); c.prepare(); await c.player.play();
  h.expire(); await settle();
  assert.equal(h.extensionAudio[0].paused, true);
  assert.equal(h.extensionAudio[0].src, '');
  assert.equal(c.player.paused, true);
});

test('adapter heartbeats renew the playback lease without any user interaction', async () => {
  const h = harness(); const c = h.client(); c.prepare(); await c.player.play();
  for (let i = 0; i < 6; i++) {
    h.elapse(2000); c.tick(); await settle(); h.sweep(); await settle();
  }
  assert.equal(h.extensionAudio[0].paused, false);
});

test('concurrent tabs share one pending offscreen creation and only the latest plays', async () => {
  const h = harness({ delayCreation: true }); const a = h.client(); a.prepare('A');
  const first = a.player.play(); const cancelled = assert.rejects(first, { name: 'AbortError' });
  await settle(); const b = h.client(); b.prepare('B'); const second = b.player.play();
  await settle(); h.finishCreation(); await cancelled; await second; await settle();
  assert.equal(h.creations, 1);
  assert.equal(h.extensionAudio[0].calls, 1);
  assert.match(h.extensionAudio[0].src, /B\.m4a$/);
});

test('cancelling a loading source cannot pause a newer song', async () => {
  const h = harness(); const c = h.client(); c.prepare(); await c.player.play();
  c.player.pause(); c.prepare('B'); h.extensionAudio[0].behavior = 'pending';
  const loading = c.player.play(); const cancelled = assert.rejects(loading, { name: 'AbortError' });
  await settle(); c.player.pause(); h.extensionAudio[0].behavior = 'success';
  c.prepare('C'); await c.player.play(); await cancelled; await settle();
  assert.match(h.extensionAudio[0].src, /C\.m4a$/);
  assert.equal(h.extensionAudio[0].paused, false);
});

test('an older tab cannot pause the tab that took over audio', async () => {
  const h = harness(); const a = h.client(); a.prepare('A'); await a.player.play();
  const b = h.client(); b.prepare('B'); await b.player.play(); await settle();
  assert.equal(a.player.paused, true);
  a.window.emit('pagehide'); await settle();
  assert.equal(h.extensionAudio[0].paused, false);
  assert.match(h.extensionAudio[0].src, /B\.m4a$/);
});

test('external URLs and commands from other origins / frames are rejected', async () => {
  const h = harness(); const c = h.client(); c.prepare(); await c.player.play();
  c.raw({ action: 'play', id: 100, url: 'https://example.com/a.mp3', start: 0,
    duration: 15000, position: 0, volume: 0.5 }); await settle();
  assert.match(h.extensionAudio[0].src, /A\.m4a$/);
  const other = h.client({ senderURL: 'https://example.com/' });
  other.prepare(); await assert.rejects(other.player.play());
  assert.equal(other.closed, true);
  const child = h.client({ frameId: 1 }); child.prepare(); await assert.rejects(child.player.play());
  assert.equal(child.closed, true);
});
