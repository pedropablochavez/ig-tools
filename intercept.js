// Runs inside the page itself (world: MAIN) from the very start.
// It passively reads the responses the site already downloads on its own while you browse
// and picks out media / audio data and whether each user follows you. Its only own request
// is a queued post-detail lookup.
// Temporary data goes only to content.js, in the same tab.
(() => {
  'use strict';

  const OK_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/;
  const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
  function remember(store, key, value, limit = 500) {
    store.delete(key);
    if (store instanceof Map) store.set(key, value); else store.add(key);
    if (store.size > limit) store.delete(store.keys().next().value);
  }

  // Read only a bounded copy of JSON. Cancelling this reader does not cancel the site's
  // original response; never wait on tee cancellation, which can await the original reader.
  async function readResponseText(res) {
    if (Number(res.headers.get('content-length')) > MAX_RESPONSE_BYTES || !res.body) {
      res.body?.cancel().catch(() => {});
      return null;
    }
    const reader = res.body.getReader(), decoder = new TextDecoder(), parts = [];
    let size = 0, expired = false;
    const timer = setTimeout(() => { expired = true; reader.cancel().catch(() => {}); }, 8000);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (expired) return null;
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { reader.cancel().catch(() => {}); return null; }
        parts.push(decoder.decode(value, { stream: true }));
      }
      parts.push(decoder.decode());
      return parts.join('');
    } finally { clearTimeout(timer); reader.releaseLock(); }
  }

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

  // Header credits are useful for videos too, even when there is no separate audio URL.
  // Keep them separate from `music`, which is exclusively the photo playback source.
  function findAudioDetails(node) {
    const text = (v) => typeof v === 'string' ? v.trim() : '';
    const original = (o) => {
      if (!o || typeof o !== 'object') return null;
      const artist = text(o.ig_artist?.username) || text(o.ig_artist?.full_name);
      return { title: text(o.original_audio_title) || 'Original audio', artist, original: true };
    };
    const licensed = (o) => {
      if (!o || typeof o !== 'object') return null;
      const title = text(o.title), artist = text(o.display_artist);
      return title || artist ? { title, artist, original: false } : null;
    };
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 6) return null;
      if (o.audio_type === 'original_sounds' && o.original_sound_info) return original(o.original_sound_info);
      const song = licensed(o.music_asset_info) || licensed(o.music_info?.music_asset_info)
        || (o.display_artist ? licensed(o) : null);
      if (song) return song;
      if (o.original_sound_info) return original(o.original_sound_info);
      if (text(o.original_audio_title)) return original(o);
      for (const v of Object.values(o)) {
        const found = walk(v, depth + 1);
        if (found) return found;
      }
      return null;
    };
    for (const [key, value] of Object.entries(node)) {
      if (!/music|audio|sound/i.test(key) && key !== 'clips_metadata') continue;
      const found = key === 'original_sound_info' ? original(value)
        : key === 'music_asset_info' ? licensed(value) : walk(value, 0);
      if (found) return found;
    }
    return null;
  }

  function toPost(node) {
    const code = node.code || node.shortcode;
    const children = node.carousel_media || node.edge_sidecar_to_children?.edges?.map((e) => e.node);
    const items = (Array.isArray(children) && children.length ? children : [node])
      .slice(0, 100)
      .map(mediaItem)
      .filter(Boolean);
    if (!items.length) return null;
    const username = (node.user?.username || node.owner?.username || '').toLowerCase();
    return { code, username, items, music: findMusic(node), audio: findAudioDetails(node) };
  }

  function collect(node, out, depth, budget = { left: 20000 }) {
    if (!node || typeof node !== 'object' || depth > 60 || --budget.left < 0) return;
    if (Array.isArray(node)) {
      for (const x of node) { if (budget.left <= 0) break; collect(x, out, depth + 1, budget); }
      return;
    }
    if (typeof node.username === 'string') {
      const hd = node.hd_profile_pic_url_info?.url || largest(node.hd_profile_pic_versions);
      const std = node.profile_pic_url_hd || node.profile_pic_url;
      const url = hd || std;
      if (url && validUrl(url)) {
        out.pics.push({ username: node.username.toLowerCase(), url, hd: !!hd });
      }
      // Whether this user follows you. Partial copies of friendship_status omit followed_by.
      const followedBy = node.friendship_status?.followed_by;
      if (typeof followedBy === 'boolean') {
        out.friendships.push({
          username: node.username.toLowerCase(),
          pk: String(node.pk ?? node.id ?? ''),
          followedBy
        });
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
      if (--budget.left <= 0) break;
      const v = node[k];
      if (v && typeof v === 'object') collect(v, out, depth + 1, budget);
    }
  }

  function parseAll(text) {
    const clean = text.replace(/^\s*for\s*\(;;\);\s*/, '');
    try { return [JSON.parse(clean)]; } catch (_) {}
    // Some GraphQL responses arrive as several JSON documents, one per line.
    const parts = [];
    for (const match of clean.matchAll(/[^\r\n]+/g)) {
      if (parts.length >= 100) break;
      const t = match[0].trim();
      if (!t) continue;
      try { parts.push(JSON.parse(t)); } catch (_) {}
    }
    return parts;
  }

  // Counters for the diagnostic line shown in the viewer.
  const stats = { responses: 0, withPics: 0, users: new Set() };

  // `req`: the request that produced this response (method, url, body, headers), if known.
  function handleText(text, req) {
    if (typeof text !== 'string' || text.length > MAX_RESPONSE_BYTES) return false;
    stats.responses++;
    if (!/profile_pic_url|image_versions2|video_versions|display_url|music|audio|followed_by/.test(text)) return;
    stats.withPics++;
    const out = { pics: [], media: [], items: [], friendships: [] };
    const budget = { left: 20000 };
    for (const obj of parseAll(text)) { if (budget.left <= 0) break; collect(obj, out, 0, budget); }
    publish(out);
    logSongs(out.media, req);
    return out.media.some((p) => p.music);
  }

  function logSongs(media, req) {
    const users = [...new Set(media.filter((p) => p.music).map((p) => p.username))];
    if (!users.length) return;
    const from = req ? `${req.method} ${shortUrl(req.url)}` : 'page HTML (no request)';
    slog(`songs from ${from} for @${users.slice(0, 5).join(', @')}`);
  }

  function handleObject(obj, req) {
    stats.responses++;
    const out = { pics: [], media: [], items: [], friendships: [] };
    collect(obj, out, 0);
    publish(out);
    logSongs(out.media, req);
  }

  function send(msg) {
    window.postMessage(msg, location.origin);
  }

  function publish({ pics, media, items, friendships }) {
    for (const p of pics) remember(stats.users, p.username, null, 1000);
    if (pics.length) send({ source: 'ighd-pics', pics });
    if (media.length) send({ source: 'ighd-media', media });
    if (items.length) send({ source: 'ighd-items', items });
    if (friendships.length) send({ source: 'ighd-friendship', friendships });
  }

  // Data embedded in the HTML on page load.
  const scannedScripts = new WeakMap();
  function scanEmbedded() {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      const text = s.textContent;
      if (scannedScripts.get(s) === text) continue;
      scannedScripts.set(s, text);
      handleText(text);
    }
  }

  // ---------- Post details on demand ----------
  // The feed data often lacks a post's song (and full video files). When you open a post, the
  // site asks /api/v1/media/<id>/info/ for it, and that answer has everything. content.js asks
  // us to make that same request for a post you stop on; the numeric id comes from the post's
  // code in its link (base64 digits).

  // Step-by-step log of the song feature, shown by igtSongStatus() in the browser console.
  const songLog = [];
  function slog(msg) {
    songLog.push(`${new Date().toLocaleTimeString()} ${msg}`);
    if (songLog.length > 60) songLog.shift();
  }
  const shortUrl = (u) => String(u || '').split('?')[0].replace(/^https:\/\/www\.instagram\.com/, '');

  const CODE_DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function codeToId(code) {
    let n = 0n;
    for (const c of code.slice(0, 11)) {
      const d = CODE_DIGITS.indexOf(c);
      if (d < 0) return null;
      n = n * 64n + BigInt(d);
    }
    return n.toString();
  }

  // Headers the site sends with its own /api/v1/ requests (app id, CSRF token, ...).
  let apiHeaders = null;
  function noteApiHeaders(url, headers) {
    if (!/\/api\/v1\//.test(url) || !headers) return;
    const h = {};
    for (const [k, v] of Object.entries(headers)) if (/^x-/i.test(k)) h[k.toLowerCase()] = v;
    if (h['x-ig-app-id']) apiHeaders = h;
  }

  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  const detailJobs = new Map();
  let detailChain = Promise.resolve();
  let retryAfterUntil = 0;
  function loadPostDetails(code) {
    if (!/^[A-Za-z0-9_-]{5,32}$/.test(code)) return Promise.resolve({ ok: false, reason: 'bad code' });
    if (detailJobs.has(code)) return detailJobs.get(code);
    if (detailJobs.size >= 6) return Promise.resolve({ ok: false, reason: 'queue full' });
    const job = detailChain.then(() => fetchPostDetails(code));
    detailChain = job.catch(() => {});
    detailJobs.set(code, job);
    job.finally(() => detailJobs.delete(code)).catch(() => {});
    return job;
  }

  async function fetchPostDetails(code) {
    if (Date.now() < retryAfterUntil) return { ok: false, status: 429, reason: 'rate limit cooldown' };
    const id = codeToId(code);
    if (!id) return { ok: false, reason: 'bad code' };
    const url = `${location.origin}/api/v1/media/${id}/info/`;
    let claim = '0';
    try { claim = sessionStorage.getItem('www-claim-v2') || '0'; } catch (_) {}
    const headers = {
      'x-ig-app-id': '936619743392459',
      'x-requested-with': 'XMLHttpRequest',
      'x-ig-www-claim': claim,
      ...(apiHeaders || {}),
      'x-csrftoken': cookie('csrftoken')
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await origFetch(url, { headers, credentials: 'include', signal: controller.signal });
      if (res.status === 429) {
        const retry = res.headers.get('retry-after');
        const ms = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
        retryAfterUntil = Date.now() + Math.min(900000, Math.max(60000, ms || 0));
      }
      const text = await readResponseText(res);
      if (text == null) return { ok: false, status: res.status, reason: 'response limit' };
      const found = handleText(text, { method: 'GET', url, body: null, headers });
      slog(`post ${code}: HTTP ${res.status}, ${found ? 'song found' : 'no song'}` +
        (res.ok ? '' : ` (${text.slice(0, 120).replace(/\s+/g, ' ')})`));
      return { ok: res.ok, status: res.status };
    } catch (e) {
      slog(`post ${code}: failed (${e.message})`);
      return { ok: false, reason: e.message };
    } finally { clearTimeout(timer); }
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
  let passiveReads = 0;
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
        noteApiHeaders(url, req.headers);
      }
    } catch (_) {}
    const res = await origFetch.apply(this, args);
    if (req && passiveReads < 2 && Number(res.headers.get('content-length')) <= MAX_RESPONSE_BYTES) {
      try {
        const copy = res.clone();
        passiveReads++;
        readResponseText(copy).then((t) => { if (t != null) handleText(t, req); })
          .catch(() => {}).finally(() => { passiveReads--; });
      } catch (_) {} // Inspection must never reject or delay the site's fetch.
    }
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
      if (!this.__igtListening) this.addEventListener('load', () => {
        try {
          if (!this.__igt) return;
          if (this.responseType === '' || this.responseType === 'text') handleText(this.responseText, this.__igt);
          else if (this.responseType === 'json') handleObject(this.response, this.__igt);
        } catch (_) {}
      });
      this.__igtListening = true;
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
      noteApiHeaders(this.__igt.url, this.__igt.headers);
    }
    return origSend.call(this, body);
  };

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    if (e.data?.source === 'ighd-scan') {
      scanEmbedded();
      send({
        source: 'ighd-stats',
        responses: stats.responses,
        withPics: stats.withPics,
        users: stats.users.size
      });
    } else if (e.data?.source === 'ighd-log' && typeof e.data.text === 'string') {
      slog(e.data.text);
    } else if (e.data?.source === 'ighd-music-status-result'
      && typeof e.data.text === 'string') {
      console.log(`IG Tools music focus: ${e.data.text}`);
    } else if (e.data?.source === 'ighd-load-post' && typeof e.data.code === 'string') {
      const result = await loadPostDetails(e.data.code);
      send({ source: 'ighd-load-post-result', code: e.data.code, ...result });
    }
  });

  // Diagnostic for the browser console.
  window.igtSongStatus = () => {
    console.log(`site API headers seen: ${!!apiHeaders}`);
    console.log(songLog.join('\n') || '(no events yet)');
    send({ source: 'ighd-music-status' });
    return songLog.length;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanEmbedded);
  } else {
    scanEmbedded();
  }
})();
