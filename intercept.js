// Runs inside the page itself (world: MAIN) from the very start.
// It passively reads the responses the site already downloads on its own while you browse
// and picks out profile picture URLs. It never sends any request of its own and never
// stores or transmits anything: data only goes to content.js, in the same tab.
(() => {
  'use strict';

  const OK_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/;

  function validUrl(u) {
    try { return OK_HOST.test(new URL(u).hostname); } catch (_) { return false; }
  }

  function largest(versions) {
    if (!Array.isArray(versions) || !versions.length) return null;
    return versions.reduce((a, b) => ((b?.width || 0) > (a?.width || 0) ? b : a))?.url || null;
  }

  function biggest(list) {
    if (!Array.isArray(list) || !list.length) return null;
    const area = (x) => (x?.width || x?.config_width || 0) * (x?.height || x?.config_height || 0);
    return list.reduce((a, b) => (area(b) > area(a) ? b : a));
  }

  // One photo or video of a post, at the largest size available.
  function mediaItem(n) {
    if (!n || typeof n !== 'object') return null;
    const image = biggest(n.image_versions2?.candidates)?.url
      || biggest(n.display_resources)?.src
      || n.display_url;
    const thumb = image && validUrl(image) ? image : null;
    const video = biggest(n.video_versions)?.url || n.video_url;
    if (video && validUrl(video)) return { type: 'video', url: video, thumb };
    // Feed data often has no downloadable file for videos; these fields still give them away.
    const isVideo = n.media_type === 2 || n.is_video || !!n.video_dash_manifest
      || n.video_duration > 0 || n.product_type === 'clips' || n.product_type === 'igtv';
    if (isVideo) return { type: 'video', url: null, thumb };
    if (thumb) return { type: 'image', url: thumb, thumb };
    return null;
  }

  // Diagnostic: which music-related fields each post arrived with. In the browser console,
  // `igtMusicFields()` lists them, to see whether the feed data carries the song at all.
  const musicFields = new Map();
  function noteMusicFields(code, keys, hasSong) {
    if (typeof code !== 'string') return;
    const prev = musicFields.get(code);
    if (prev?.hasSong) return;
    musicFields.set(code, { hasSong, fields: keys.join(', ') || '(none)', from: location.pathname });
    if (musicFields.size > 200) musicFields.delete(musicFields.keys().next().value);
  }
  window.igtMusicFields = () => {
    console.table(Object.fromEntries(musicFields));
    return musicFields.size;
  };

  // Music attached to a photo post (what the mobile app plays): the audio file plus the clip
  // the author picked. Looked up under any "music" field of the post, whatever its exact shape.
  function findMusic(node) {
    const found = {};
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 6) return;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string') {
          if (!found.url && /progressive_download_url$/.test(k) && validUrl(v)) found.url = v;
          else if (k === 'title' && !found.title) found.title = v;
          else if (k === 'display_artist' && !found.artist) found.artist = v;
        } else if (typeof v === 'number') {
          if (k === 'audio_asset_start_time_in_ms' && found.start == null) found.start = v;
          else if (k === 'overlap_duration_in_ms' && found.duration == null) found.duration = v;
        } else if (v && typeof v === 'object') {
          walk(v, depth + 1);
        }
      }
    };
    const keys = [];
    for (const [k, v] of Object.entries(node)) {
      if (!/music|audio|sound/i.test(k)) continue;
      keys.push(`${k}:${v === null ? 'null' : typeof v}`);
      if (v && typeof v === 'object') walk(v, 0);
    }
    noteMusicFields(node.code || node.shortcode, keys, !!found.url);
    if (!found.url) return null;
    return {
      url: found.url,
      start: found.start || 0,
      duration: found.duration || 30000,
      title: found.title || '',
      artist: found.artist || ''
    };
  }

  function toPost(node) {
    const code = node.code || node.shortcode;
    const children = node.carousel_media || node.edge_sidecar_to_children?.edges?.map((e) => e.node);
    const items = (Array.isArray(children) && children.length ? children : [node])
      .map(mediaItem)
      .filter(Boolean);
    if (!items.length) return null;
    const username = (node.user?.username || node.owner?.username || '').toLowerCase();
    return { code, username, items, music: findMusic(node) };
  }

  function collect(node, out, depth) {
    if (!node || typeof node !== 'object' || depth > 80) return;
    if (Array.isArray(node)) {
      for (const x of node) collect(x, out, depth + 1);
      return;
    }
    if (typeof node.username === 'string') {
      const hd = node.hd_profile_pic_url_info?.url || largest(node.hd_profile_pic_versions);
      const std = node.profile_pic_url_hd || node.profile_pic_url;
      const url = hd || std;
      if (url && validUrl(url)) {
        out.pics.push({ username: node.username.toLowerCase(), url, hd: !!hd });
      }
    }
    const code = node.code || node.shortcode;
    if (typeof code === 'string' && /^[A-Za-z0-9_-]{5,}$/.test(code)) {
      const post = toPost(node);
      if (post) out.media.push(post);
    }
    // Single media items by numeric id. Stories are identified this way (/stories/<user>/<id>/).
    const pk = node.pk ?? node.id;
    if ((node.image_versions2 || node.video_versions) && pk != null) {
      const item = mediaItem(node);
      if (item) {
        out.items.push({
          ...item,
          pk: String(pk).split('_')[0],
          username: (node.user?.username || '').toLowerCase()
        });
      }
    }
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === 'object') collect(v, out, depth + 1);
    }
  }

  function parseAll(text) {
    const clean = text.replace(/^\s*for\s*\(;;\);\s*/, '');
    try { return [JSON.parse(clean)]; } catch (_) {}
    // Some GraphQL responses arrive as several JSON documents, one per line.
    const parts = [];
    for (const line of clean.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { parts.push(JSON.parse(t)); } catch (_) {}
    }
    return parts;
  }

  // Counters for the diagnostic line shown in the viewer.
  const stats = { responses: 0, withPics: 0, users: new Set() };

  // `req`: the request that produced this response (method, url, body, headers), if known.
  function handleText(text, req) {
    if (typeof text !== 'string') return;
    stats.responses++;
    if (!/profile_pic_url|image_versions2|video_versions|display_url|music|audio/.test(text)) return;
    stats.withPics++;
    const out = { pics: [], media: [], items: [] };
    for (const obj of parseAll(text)) collect(obj, out, 0);
    publish(out);
    learnProfileRequest(out.media, req);
  }

  function handleObject(obj, req) {
    stats.responses++;
    const out = { pics: [], media: [], items: [] };
    collect(obj, out, 0);
    publish(out);
    learnProfileRequest(out.media, req);
  }

  function send(msg) {
    window.postMessage(msg, location.origin);
  }

  function publish({ pics, media, items }) {
    for (const p of pics) stats.users.add(p.username);
    if (pics.length) send({ source: 'ighd-pics', pics });
    if (media.length) send({ source: 'ighd-media', media });
    if (items.length) send({ source: 'ighd-items', items });
  }

  // Data embedded in the HTML on page load.
  function scanEmbedded() {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      handleText(s.textContent);
    }
  }

  // ---------- Songs of feed posts ----------
  // The feed data has no song, but the request the site makes to show a profile's posts does.
  // The first time you open any profile, we remember how that request looks (it has the
  // username in it). For a photo post in your feed, content.js then asks us to make that same
  // request for the post's author, exactly as the site does when you open their profile.

  const TEMPLATE_KEY = 'igt-profile-request';
  const USER_CHARS = 'A-Za-z0-9._';
  const userRe = (u, flags) => new RegExp(
    `(^|[^${USER_CHARS}])${u.replace(/\./g, '\\.')}(?=[^${USER_CHARS}]|$)`, flags
  );
  const latestTokens = {}; // fb_dtsg / lsd / jazoest from the site's latest requests

  let template = null;
  try { template = JSON.parse(localStorage.getItem(TEMPLATE_KEY)); } catch (_) {}

  function noteTokens(body) {
    if (typeof body !== 'string' || !body.includes('=')) return;
    try {
      const params = new URLSearchParams(body);
      for (const k of ['fb_dtsg', 'lsd', 'jazoest']) if (params.get(k)) latestTokens[k] = params.get(k);
    } catch (_) {}
  }

  const isForm = (body) => typeof body === 'string' && /^[^{\[]*=/.test(body);
  const safeDecode = (x) => { try { return decodeURIComponent(x); } catch (_) { return x; } };

  // Readable text of a request (form values and URL decoded), to look for a username in it.
  function requestText(req) {
    let body = req.body || '';
    if (isForm(body)) {
      try { body = [...new URLSearchParams(body).values()].join(' '); } catch (_) {}
    }
    return `${safeDecode(req.url)} ${body}`;
  }

  // Same request with another username: replaced inside the URL path, the query values and
  // the form values (decoded), so encoded JSON like variables={"username":"..."} works too.
  function swapUser(req, from, to) {
    const re = userRe(from, 'gi');
    const rep = (x) => x.replace(re, `$1${to}`);
    const url = new URL(req.url, location.href);
    url.pathname = url.pathname.split('/').map((seg) => rep(safeDecode(seg))).join('/');
    for (const [k, v] of [...url.searchParams]) url.searchParams.set(k, rep(v));
    let body = req.body;
    if (isForm(body)) {
      const params = new URLSearchParams(body);
      for (const [k, v] of [...params]) params.set(k, rep(v));
      for (const [k, v] of Object.entries(latestTokens)) if (params.has(k)) params.set(k, v);
      body = params.toString();
    } else if (typeof body === 'string') {
      body = rep(body);
    }
    return { url: url.href, body };
  }

  function learnProfileRequest(media, req) {
    if (!req || !media.length) return;
    const text = requestText(req);
    // Only first pages: a request with a cursor would not work for another account.
    if (/max_id=|"after":"|%22after%22%3A%22/.test(text)) return;
    for (const post of media) {
      const u = post.music && post.username;
      if (!u || !userRe(u, 'i').test(text)) continue;
      const fresh = !template;
      template = { method: req.method, url: req.url, body: req.body, headers: req.headers, user: u };
      try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(template)); } catch (_) {}
      if (fresh) send({ source: 'ighd-template-ready' });
      return;
    }
  }

  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function loadProfileSongs(user) {
    if (!template) return { ok: false, reason: 'no-template' };
    let url;
    let body;
    try {
      ({ url, body } = swapUser(template, template.user, user));
    } catch (e) {
      return { ok: false, reason: e.message };
    }
    const headers = { ...(template.headers || {}) };
    for (const k of Object.keys(headers)) {
      const lk = k.toLowerCase();
      if (lk === 'x-csrftoken' && cookie('csrftoken')) headers[k] = cookie('csrftoken');
      if (lk === 'x-fb-lsd' && latestTokens.lsd) headers[k] = latestTokens.lsd;
    }
    try {
      const res = await origFetch(url, {
        method: template.method || 'GET',
        headers,
        body: template.method === 'GET' ? undefined : body,
        credentials: 'include'
      });
      handleText(await res.text(), null);
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  // ---------- Watching the site's own requests ----------

  // When logged in, profile data is loaded from /api/graphql (no trailing slash).
  const interesting = (url) => /graphql|\/api\/|\/ajax\//.test(String(url));

  function plainHeaders(h) {
    const out = {};
    try {
      if (!h) return out;
      if (h instanceof Headers) h.forEach((v, k) => { out[k] = v; });
      else if (Array.isArray(h)) for (const [k, v] of h) out[k] = v;
      else Object.assign(out, h);
    } catch (_) {}
    return out;
  }

  function bodyText(b) {
    if (typeof b === 'string') return b;
    if (b instanceof URLSearchParams) return b.toString();
    return null;
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const a = args[0];
    const init = args[1] || {};
    let req = null;
    try {
      const url = a instanceof Request ? a.url : String(a);
      if (interesting(url)) {
        req = {
          method: String(init.method || (a instanceof Request ? a.method : 'GET')).toUpperCase(),
          url,
          body: bodyText(init.body),
          headers: plainHeaders(init.headers || (a instanceof Request ? a.headers : null))
        };
        noteTokens(req.body);
      }
    } catch (_) {}
    const res = await origFetch.apply(this, args);
    if (req) res.clone().text().then((t) => handleText(t, req), () => {});
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__igt = interesting(url)
      ? { method: String(method || 'GET').toUpperCase(), url: new URL(url, location.href).href, body: null, headers: {} }
      : null;
    if (this.__igt) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') handleText(this.responseText, this.__igt);
          else if (this.responseType === 'json') handleObject(this.response, this.__igt);
        } catch (_) {}
      });
    }
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (this.__igt) this.__igt.headers[k] = v;
    return origSetHeader.call(this, k, v);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__igt) {
      this.__igt.body = bodyText(body);
      noteTokens(this.__igt.body);
    }
    return origSend.call(this, body);
  };

  window.addEventListener('message', async (e) => {
    if (e.source !== window) return;
    if (e.data?.source === 'ighd-scan') {
      scanEmbedded();
      send({
        source: 'ighd-stats',
        responses: stats.responses,
        withPics: stats.withPics,
        users: stats.users.size
      });
    } else if (e.data?.source === 'ighd-load-songs' && typeof e.data.user === 'string') {
      const result = await loadProfileSongs(e.data.user);
      send({ source: 'ighd-load-songs-result', user: e.data.user, ...result });
    }
  });

  // Diagnostic for the browser console.
  window.igtSongStatus = () => ({
    learned: !!template,
    learnedFrom: template ? `${template.method} ${template.url.split('?')[0]}` : null
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanEmbedded);
  } else {
    scanEmbedded();
  }
})();
