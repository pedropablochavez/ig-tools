const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const path = require('node:path');

const read = (name) => readFileSync(path.join(__dirname, '..', name), 'utf8');
const content = read('content.js');
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));

// Shapes observed in the owner's session (2026-10-22): the profile query's data.user has the
// complete friendship_status; feed copies of the same user carry it without followed_by.
const fullStatus = (followedBy) => ({ following: true, followed_by: followedBy, blocking: false,
  outgoing_request: false, incoming_request: false, is_restricted: false });
const profileResponse = (username, pk, followedBy) => ({ data: { user: {
  username, pk, id: pk, profile_pic_url: 'https://s.cdninstagram.com/p.jpg',
  friendship_status: fullStatus(followedBy) } } });

function interceptor() {
  const messages = [];
  class XHR {
    constructor() { this.loads = []; this.responseType = ''; this.responseText = '{}'; }
    addEventListener(type, fn) { if (type === 'load') this.loads.push(fn); }
    open() {} setRequestHeader() {} send() {}
  }
  const window = { fetch: async () => new Response('{}'), addEventListener() {},
    postMessage: (msg) => messages.push(msg) };
  const context = vm.createContext({ window, XMLHttpRequest: XHR, URL, Request, Response, Headers,
    URLSearchParams, TextDecoder, AbortController, setTimeout, clearTimeout,
    document: { readyState: 'loading', cookie: '', addEventListener() {}, querySelectorAll: () => [] },
    sessionStorage: { getItem: () => null }, console: { log() {}, table() {} },
    location: { origin: 'https://www.instagram.com', href: 'https://www.instagram.com/', pathname: '/' } });
  vm.runInContext(read('intercept.js'), context);
  const respond = (body) => {
    const xhr = new XHR();
    xhr.open('POST', '/api/graphql');
    xhr.responseText = JSON.stringify(body);
    xhr.loads.forEach((fn) => fn());
  };
  // Plain copies: objects made inside the vm context have that context's prototypes.
  const friendships = () => JSON.parse(JSON.stringify(messages
    .filter((m) => m.source === 'ighd-friendship').flatMap((m) => m.friendships)));
  return { respond, friendships };
}

test('profile responses report whether the user follows you', () => {
  const h = interceptor();
  h.respond(profileResponse('Follower.One', '111', true));
  h.respond(profileResponse('stranger', '222', false));
  assert.deepEqual(h.friendships(), [
    { username: 'follower.one', pk: '111', followedBy: true },
    { username: 'stranger', pk: '222', followedBy: false }
  ]);
});

test('partial friendship_status copies and users without it report nothing', () => {
  const h = interceptor();
  h.respond({ data: { feed: { edges: [{ node: { code: 'Abc12345', display_url: 'https://s.cdninstagram.com/x.jpg',
    user: { username: 'creator', pk: '333', friendship_status: { following: false, is_bestie: false } } } }] } } });
  h.respond({ data: { user: { username: 'me', pk: '444', profile_pic_url: 'https://s.cdninstagram.com/me.jpg' } } });
  h.respond({ data: { user: { username: 'odd', pk: '555', friendship_status: { followed_by: 'yes' } } } });
  assert.deepEqual(h.friendships(), []);
});

// Minimal DOM: enough of Element for the label code (tree edits, text, selectors it uses).
class El {
  constructor(tag, text = '') {
    this.tagName = tag.toUpperCase(); this.kids = []; this.parentElement = null; this.text = text;
    this.dataset = {}; this.className = '';
  }
  get children() { return this.kids; }
  get textContent() { return this.text + this.kids.map((k) => k.textContent).join(''); }
  set textContent(v) { this.text = v; this.kids = []; }
  get nextSibling() {
    const p = this.parentElement;
    return p ? p.kids[p.kids.indexOf(this) + 1] || null : null;
  }
  append(...nodes) { for (const n of nodes) { n.remove(); n.parentElement = this; this.kids.push(n); } return this; }
  remove() {
    const p = this.parentElement;
    if (p) { p.kids.splice(p.kids.indexOf(this), 1); this.parentElement = null; }
  }
  after(n) {
    n.remove();
    const p = this.parentElement;
    p.kids.splice(p.kids.indexOf(this) + 1, 0, n);
    n.parentElement = p;
  }
  *all() { for (const k of this.kids) { yield k; yield* k.all(); } }
  closest(tag) { for (let e = this; e; e = e.parentElement) if (e.tagName === tag) return e; return null; }
  querySelectorAll(sel) {
    const list = [...this.all()];
    if (sel === 'span') return list.filter((e) => e.tagName === 'SPAN');
    if (sel === 'main header h1, main header h2') {
      return list.filter((e) => /^H[12]$/.test(e.tagName) && e.closest('HEADER') && e.closest('MAIN'));
    }
    throw new Error(`unsupported selector ${sel}`);
  }
}
const el = (tag, ...kids) => new El(tag).append(...kids);

// The profile header as observed: h1/h2 > span inside a link and a wrapper, next to Options.
function profileHeader(username, headingTag = 'H1') {
  const options = el('div', new El('button', 'Options'));
  const row = el('div', el('div', el('a', el(headingTag, new El('span', username)))), options);
  return { root: el('body', el('main', el('header', el('section', row)))), row, options };
}

function page(cookie = 'ds_user_id=999; csrftoken=x') {
  const listeners = [];
  const context = vm.createContext({
    window: { addEventListener: (type, fn) => listeners.push(fn) },
    location: { pathname: '/' },
    document: { cookie, createElement: (tag) => new El(tag), querySelectorAll: (s) => context.root.querySelectorAll(s) },
    fromPage: () => true
  });
  vm.runInContext(`${between(content, '  // First URL segments', '  // Messages come from intercept.js')}
    ${between(content, '  function remember(', '  // ---------- Data ----------')}
    ${between(content, '  // Whether each user follows you', '  function interceptDiag(')}
    ${between(content, '  // ---------- "Follows you" label', '  // ---------- Non-followers scan')}
    globalThis.api = { updateFollowBadge, followBadge };`, context);
  const send = (friendships) => listeners.forEach((fn) => fn({ data: { source: 'ighd-friendship', friendships } }));
  const show = (username, header) => {
    context.location.pathname = `/${username}/`;
    context.root = header.root;
    context.api.updateFollowBadge();
    return header;
  };
  const badges = () => [...context.root.all()].filter((e) => e.className === 'ighd-follow-badge');
  return { context, send, show, badges, api: context.api };
}

test('the label sits between the username and the options button', () => {
  const p = page();
  const h = p.show('follower.one', profileHeader('follower.one'));
  assert.equal(p.badges().length, 0, 'nothing is shown before the data arrives');
  p.send([{ username: 'follower.one', pk: '111', followedBy: true }]);
  assert.equal(p.badges().length, 1);
  assert.equal(p.api.followBadge.textContent, 'Follows you');
  assert.equal(p.api.followBadge.parentElement, h.row);
  assert.equal(p.api.followBadge.nextSibling, h.options);
  for (let i = 0; i < 20; i++) p.api.updateFollowBadge();
  assert.equal(p.badges().length, 1);
  assert.equal(h.row.kids.length, 3);
});

test('profiles that do not follow you, h2 headings and uppercase routes', () => {
  const p = page();
  p.send([{ username: 'stranger', pk: '222', followedBy: false }]);
  p.show('Stranger', profileHeader('stranger', 'H2'));
  assert.equal(p.api.followBadge.textContent, "Doesn't follow you");
  assert.equal(p.api.followBadge.dataset.follows, 'false');
});

test('your own profile and unknown profiles show no label', () => {
  const p = page('csrftoken=x; ds_user_id=999');
  p.send([{ username: 'me', pk: '999', followedBy: false }]);
  p.show('me', profileHeader('me'));
  assert.equal(p.badges().length, 0);
  p.show('nobody', profileHeader('nobody'));
  assert.equal(p.badges().length, 0);
});

test('moving between profiles updates or removes the label', () => {
  const p = page();
  p.send([{ username: 'a.user', pk: '1', followedBy: true }, { username: 'b.user', pk: '2', followedBy: false }]);
  p.show('a.user', profileHeader('a.user'));
  assert.equal(p.api.followBadge.textContent, 'Follows you');
  // The site reuses the header element and only replaces the name.
  const b = profileHeader('b.user');
  p.show('b.user', b);
  assert.equal(p.api.followBadge.textContent, "Doesn't follow you");
  assert.equal(p.api.followBadge.parentElement, b.row);
  // Route changed but the previous profile's header is still rendered: no stale label.
  p.context.location.pathname = '/c.user/';
  p.api.updateFollowBadge();
  assert.equal(p.api.followBadge.parentElement, null);
  // Newer data replaces older data for the same user.
  p.send([{ username: 'b.user', pk: '2', followedBy: true }]);
  p.show('b.user', b);
  assert.equal(p.api.followBadge.textContent, 'Follows you');
});

test('malformed messages are ignored', () => {
  const p = page();
  p.send([{ username: 'x', followedBy: 'true' }, { followedBy: true }, null]);
  p.show('x', profileHeader('x'));
  assert.equal(p.badges().length, 0);
});
