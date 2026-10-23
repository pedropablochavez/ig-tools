const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const path = require('node:path');

const read = (name) => readFileSync(path.join(__dirname, '..', name), 'utf8');
const content = read('content.js');
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const plain = (v) => JSON.parse(JSON.stringify(v));
const FLAG = '__relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider';
const IMAGE = 'https://scontent.fccp5-1.fna.fbcdn.net/v/t39/wallpaper.jpg?stp=x';

// Shapes observed in the owner's session (2026-10-22, FRACASOLAB): data.get_slide_thread_nullable
// .as_ig_direct_thread with thread_key (the /direct/t/<id>/ id) and theme_data.
const variant = (mode, extra = {}) => ({ app_color_mode: mode, gradient_colors: ['FF892320'],
  incoming_message_bubble_color: 'FFEFEFEF', inbound_message_text_color: 'FF000000',
  outbound_message_text_color: 'FFFFFFFF', thread_background_color: 'FF66849E',
  navigation_bar_color: 'FF86CBEC', thread_background_asset: { url_480: IMAGE, url_1024: IMAGE }, ...extra });
const threadResponse = (key, theme) => ({ data: { get_slide_thread_nullable: { as_ig_direct_thread: {
  thread_key: key, thread_fbid: '999', id: 'x', theme_data: theme } } } });
const requestBody = (flag) => new URLSearchParams({ doc_id: '123', fb_api_req_friendly_name: 'Thread',
  variables: JSON.stringify({ thread_fbid: '999', [FLAG]: flag, other: 'a b' }) }).toString();

function interceptor() {
  const messages = [], fetched = [], listeners = [];
  class XHR {
    constructor() { this.loads = []; this.responseType = ''; this.responseText = '{}'; }
    addEventListener(type, fn) { if (type === 'load') this.loads.push(fn); }
    open() {} setRequestHeader() {}
    send(body) { this.sent = body; }
  }
  const window = { fetch: async (url, init) => { fetched.push(init?.body); return new Response('{}'); },
    addEventListener: (type, fn) => listeners.push(fn), postMessage: (msg) => messages.push(msg) };
  const context = vm.createContext({ window, XMLHttpRequest: XHR, URL, Request, Response, Headers,
    URLSearchParams, FormData, TextDecoder, AbortController, setTimeout, clearTimeout,
    document: { readyState: 'loading', cookie: '', addEventListener() {}, querySelectorAll: () => [] },
    sessionStorage: { getItem: () => null }, console: { log() {}, table() {} },
    location: { origin: 'https://www.instagram.com', href: 'https://www.instagram.com/', pathname: '/' } });
  vm.runInContext(read('intercept.js'), context);
  const send = (body, response = {}) => {
    const xhr = new XHR();
    xhr.open('POST', '/api/graphql');
    xhr.send(body);
    xhr.responseText = JSON.stringify(response);
    xhr.loads.forEach((fn) => fn());
    return xhr.sent;
  };
  const themes = () => plain(messages.filter((m) => m.source === 'ighd-themes').flatMap((m) => m.themes));
  const ask = (data) => listeners.forEach((fn) => fn({ source: window, origin: 'https://www.instagram.com', data }));
  return { window, send, themes, fetched, messages, ask };
}

test("the site's conversation request asks for the chat theme", () => {
  const h = interceptor();
  const sent = new URLSearchParams(h.send(requestBody(false)));
  const vars = JSON.parse(sent.get('variables'));
  assert.equal(vars[FLAG], true);
  assert.equal(vars.thread_fbid, '999');
  assert.equal(vars.other, 'a b');
  assert.equal(sent.get('doc_id'), '123');
  assert.equal(sent.get('fb_api_req_friendly_name'), 'Thread');
});

test('other requests are sent unchanged', () => {
  const h = interceptor();
  for (const body of [requestBody(true), 'doc_id=1&variables=%7B%7D', 'variables=ChatThemesQE%7Bbroken',
    'a=1', null, undefined]) {
    assert.equal(h.send(body), body);
  }
  const form = { not: 'a string' };
  assert.equal(h.send(form), form);
});

test('fetch requests with a string body are rewritten the same way', async () => {
  const h = interceptor();
  await h.window.fetch('https://www.instagram.com/api/graphql', { method: 'POST', body: requestBody(false) });
  await h.window.fetch('https://www.instagram.com/api/graphql', { method: 'POST', body: 'a=1' });
  assert.equal(JSON.parse(new URLSearchParams(h.fetched[0]).get('variables'))[FLAG], true);
  assert.equal(h.fetched[1], 'a=1');
});

test('FormData and URLSearchParams bodies get a rewritten copy', () => {
  const h = interceptor();
  const form = new FormData();
  for (const [k, v] of new URLSearchParams(requestBody(false))) form.append(k, v);
  const sentForm = h.send(form);
  assert.notEqual(sentForm, form);
  assert.equal(JSON.parse(sentForm.get('variables'))[FLAG], true);
  assert.equal(sentForm.get('doc_id'), '123');
  assert.equal(JSON.parse(form.get('variables'))[FLAG], false, "the site's object is not modified");
  const params = new URLSearchParams(requestBody(false));
  const sentParams = h.send(params);
  assert.equal(JSON.parse(sentParams.get('variables'))[FLAG], true);
  assert.equal(JSON.parse(params.get('variables'))[FLAG], false);
  const other = new FormData(); other.append('variables', '{}');
  assert.equal(h.send(other), other);
});

test('themes that arrived before the page script listened are sent again on request', () => {
  const h = interceptor();
  h.send('a=1', threadResponse('7880512602025476', variant('NORMAL')));
  h.messages.length = 0;
  h.ask({ source: 'ighd-themes-request' });
  assert.deepEqual(h.themes().map((t) => t.thread), ['7880512602025476']);
});

test('conversation responses report the theme, light and dark', () => {
  const h = interceptor();
  h.send('a=1', threadResponse('7880512602025476',
    { ...variant('NORMAL'), alternative_themes: [variant('DARK', { thread_background_color: 'FF000004' })] }));
  const [entry] = h.themes();
  assert.equal(entry.thread, '7880512602025476');
  assert.deepEqual(entry.theme.variants.map((v) => [v.mode, v.thread_background_color]),
    [['light', 'FF66849E'], ['dark', 'FF000004']]);
  assert.deepEqual(entry.theme.variants[0].gradient_colors, ['FF892320']);
  assert.equal(entry.theme.variants[0].background, IMAGE);
});

test('chats without a theme clear it; unsafe values are dropped', () => {
  const h = interceptor();
  h.send('a=1', threadResponse('105297574204708', null));
  h.send('a=1', threadResponse('200000000000001', variant('NORMAL', {
    incoming_message_bubble_color: 'red; background: url(x)', gradient_colors: ['FF000000', 'nope', 5],
    thread_background_asset: { url_1024: 'https://evil.example/x.jpg' } })));
  h.send('a=1', { data: { thread: { thread_key: 'not-a-number', theme_data: variant('NORMAL') } } });
  const [none, unsafe, ...rest] = h.themes();
  assert.deepEqual(none, { thread: '105297574204708', theme: null });
  const v = unsafe.theme.variants[0];
  assert.equal(v.incoming_message_bubble_color, null);
  assert.deepEqual(v.gradient_colors, ['FF000000']);
  assert.equal(v.background, null);
  assert.equal(rest.length, 0);
});

// ---------- Applying a theme ----------
// A small DOM whose computed backgrounds follow the site's mechanism: atomic classes paint
// bubbles with color variables inherited from ancestors.
const CLASS_VARS = { xout: '--chat-outgoing-message-bubble-background-color', xin: '--chat-incoming-message-bubble-background-color' };
const toRgb = (hex) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex || '');
  if (!m) return 'rgba(0, 0, 0, 0)';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};
class Style {
  constructor() { this.vars = {}; }
  setProperty(k, v) { this.vars[k] = v; }
  removeProperty(k) { delete this.vars[k]; }
  getPropertyValue(k) { return this.vars[k] || ''; }
}
class El {
  constructor(tag, opts = {}) {
    this.tagName = tag.toUpperCase(); this.kids = []; this.parentElement = null; this.style = new Style();
    this.dataset = {}; this.cls = []; this.text = opts.text || ''; this.offsetHeight = opts.h ?? 40;
    this.clientHeight = opts.h ?? 40; this.scrollHeight = opts.scroll ?? this.clientHeight;
    this.overflowY = opts.overflowY || 'visible'; this.isRoot = false;
    if (opts.cls) this.cls = [opts.cls];
  }
  get classList() { const list = [...this.cls]; list.contains = (c) => this.cls.includes(c); return list; }
  set className(v) { this.cls = v ? v.split(' ') : []; }
  get className() { return this.cls.join(' '); }
  get textContent() { return this.text + this.kids.map((k) => k.textContent).join(''); }
  set textContent(v) { this.text = v; this.kids = []; }
  get isConnected() { let e = this; while (e.parentElement) e = e.parentElement; return e.isRoot; }
  getBoundingClientRect() { return { height: this.clientHeight }; }
  append(...nodes) { for (const n of nodes) this.appendChild(n); return this; }
  appendChild(n) { n.remove(); n.parentElement = this; this.kids.push(n); return n; }
  remove() { const p = this.parentElement; if (p) { p.kids.splice(p.kids.indexOf(this), 1); this.parentElement = null; } }
  *all() { for (const k of this.kids) { yield k; yield* k.all(); } }
  querySelectorAll(sel) {
    if (sel !== 'div') throw new Error(`unsupported selector ${sel}`);
    return [...this.all()].filter((e) => e.tagName === 'DIV');
  }
  getElementsByTagName(tag) { return this.querySelectorAll(tag); }
  inherited(name) { for (let e = this; e; e = e.parentElement) if (e.style.vars[name]) return e.style.vars[name]; return ''; }
}
function computed(el, html) {
  if (el === html) return { colorScheme: html.scheme };
  let bg = el.style.backgroundColor ? toRgb(el.style.backgroundColor) : 'rgba(0, 0, 0, 0)';
  const cls = el.classList.find((c) => CLASS_VARS[c]);
  if (!el.style.backgroundColor && cls) bg = toRgb(el.inherited(CLASS_VARS[cls]) || (cls === 'xout' ? '#4a5df9' : '#25292e'));
  return { overflowY: el.overflowY, backgroundColor: bg };
}

function chatPage({ scheme = 'dark' } = {}) {
  const listeners = [], requests = [];
  const html = new El('html'); html.isRoot = true; html.scheme = scheme;
  const head = new El('head'), body = new El('body');
  html.append(head, body);
  const out = new El('div', { cls: 'xout' }); out.append(new El('span', { text: 'mine' }));
  const inc = new El('div', { cls: 'xin' }); inc.append(new El('span', { text: 'theirs' }));
  const list = new El('div', { h: 600, scroll: 2000, overflowY: 'auto' }); list.append(inc, out);
  const backdrop = new El('div', { h: 600 }); backdrop.append(list);
  const box = new El('div', { h: 40 });
  const composer = new El('div', { h: 78 }); composer.append(box);
  const pane = new El('div', { h: 784 }); pane.append(backdrop, composer);
  body.append(pane);
  const context = vm.createContext({
    window: { addEventListener: (type, fn) => listeners.push(fn), postMessage: (msg) => requests.push(msg) },
    location: { origin: 'https://www.instagram.com', pathname: '/direct/t/7880512602025476/' }, innerHeight: 861, URL,
    getComputedStyle: (el) => computed(el, html),
    document: { documentElement: html, head, createElement: (tag) => new El(tag),
      querySelector: (sel) => /textbox/.test(sel) && pane.isConnected ? box : null },
    fromPage: () => true
  });
  vm.runInContext(`${between(content, '  function remember(', '  // ---------- Data ----------')}
    ${between(content, '  // ---------- Chat themes', '  // ---------- "Follows you" label')}
    globalThis.api = { updateChatTheme, bubbleClasses, themeStyle, get themed() { return themed; } };`, context);
  const send = (themes) => listeners.forEach((fn) => fn({ data: { source: 'ighd-themes', themes } }));
  return { context, api: context.api, send, html, pane, backdrop, list, out, inc, requests };
}
const fracasolab = () => ({ variants: [
  plain({ mode: 'light', gradient_colors: ['FF892320'], incoming_message_bubble_color: 'FFEFEFEF',
    inbound_message_text_color: 'FF000000', outbound_message_text_color: 'FFFFFFFF',
    thread_background_color: 'FF66849E', background: IMAGE }),
  plain({ mode: 'dark', gradient_colors: ['FFD9D9D9'], incoming_message_bubble_color: 'FF3F536F',
    inbound_message_text_color: 'FFFFFFFF', outbound_message_text_color: 'FF000000',
    thread_background_color: 'FF000004', background: IMAGE })
] });

test('the open chat gets its background, bubble colors and readable text', () => {
  const p = chatPage();
  assert.deepEqual(plain(p.requests), [{ source: 'ighd-themes-request' }]);
  p.send([{ thread: '7880512602025476', theme: fracasolab() }]);
  assert.equal(p.pane.style.vars['--chat-outgoing-message-bubble-background-color'], '#D9D9D9FF');
  assert.equal(p.pane.style.vars['--ig-outgoing-message-bubble'], '217, 217, 217');
  assert.equal(p.pane.style.vars['--chat-incoming-message-bubble-background-color'], '#3F536FFF');
  assert.equal(p.backdrop.style.backgroundColor, '#000004FF');
  assert.equal(p.backdrop.style.backgroundImage, `url("${IMAGE}")`);
  assert.equal(p.backdrop.style.backgroundSize, 'cover');
  assert.deepEqual(plain(p.api.bubbleClasses), { out: 'xout', in: 'xin' });
  assert.match(p.api.themeStyle.textContent, /\.xout \* \{ color: #000000FF !important; \}/);
  assert.match(p.api.themeStyle.textContent, /\.xin \* \{ color: #FFFFFFFF !important; \}/);
  // The site's page-colored outline would draw a dark box around each bubble over the image.
  assert.match(p.api.themeStyle.textContent, /\.xout \{ outline-color: transparent !important; \}/);
  assert.match(p.api.themeStyle.textContent, /\.xin \{ outline-color: transparent !important; \}/);
  assert.equal(p.api.themeStyle.parentElement?.tagName, 'HEAD');
  assert.equal(p.list.kids.length, 2, 'the test element is removed');
});

test('light mode uses the light variant; repeated checks change nothing', () => {
  const p = chatPage({ scheme: 'light' });
  p.send([{ thread: '7880512602025476', theme: fracasolab() }]);
  assert.equal(p.backdrop.style.backgroundColor, '#66849EFF');
  const css = p.api.themeStyle.textContent, themed = p.api.themed;
  for (let i = 0; i < 20; i++) p.api.updateChatTheme();
  assert.equal(p.api.themed, themed);
  assert.equal(p.api.themeStyle.textContent, css);
  // Switching the site to dark mode re-applies with the dark variant.
  p.html.scheme = 'dark';
  p.api.updateChatTheme();
  assert.equal(p.backdrop.style.backgroundColor, '#000004FF');
});

test('leaving the chat, a chat without theme and malformed data restore the page', () => {
  const p = chatPage();
  p.backdrop.style.backgroundColor = 'site-value';
  p.send([{ thread: '7880512602025476', theme: fracasolab() }]);
  p.context.location.pathname = '/direct/t/105297574204708/';
  p.api.updateChatTheme();
  assert.equal(p.api.themed, null);
  assert.deepEqual(p.pane.style.vars, {});
  assert.equal(p.backdrop.style.backgroundColor, 'site-value');
  assert.equal(p.backdrop.style.backgroundImage, undefined);
  assert.equal(p.api.themeStyle.parentElement, null);
  // A theme later removed in the app arrives as null.
  p.context.location.pathname = '/direct/t/7880512602025476/';
  p.api.updateChatTheme();
  assert.notEqual(p.api.themed, null);
  p.send([{ thread: '7880512602025476', theme: null }]);
  assert.equal(p.api.themed, null);
  p.send([{ thread: '1', theme: fracasolab() }, { thread: '7880512602025476', theme: { variants: 'x' } }, null]);
  assert.equal(p.api.themed, null);
});

test('only Instagram CDN images over HTTPS are used as backgrounds', () => {
  const p = chatPage();
  const theme = fracasolab();
  theme.variants[1].background = 'https://evil.example/x.jpg';
  p.send([{ thread: '7880512602025476', theme }]);
  assert.equal(p.backdrop.style.backgroundImage, undefined);
  assert.equal(p.backdrop.style.backgroundColor, '#000004FF');
});
