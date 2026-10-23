// Runs inside the page itself (world: MAIN) from the very start.
// It passively reads the responses the site already downloads on its own while you browse
// and picks out media / audio data, whether each user follows you, and chat themes. Its own
// requests are a queued post-detail lookup and, only when you start it on your own profile, the
// pages of your own Followers / Following lists (non-followers scan). It also asks the site's own
// conversation request to include the chat's theme, which the website leaves out for some accounts.
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

  // ---------- Chat themes ----------
  // The website has chat themes but, behind an experiment, may leave them out of its own
  // conversation request. Setting that request's flag makes the same request include them.
  const THEME_FLAG = '__relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider';
  // Accepts the body types the site uses (string, URLSearchParams, FormData); returns a new body
  // only when the flag is present and off, never altering the site's own object.
  function withChatThemes(body) {
    try {
      if (themeFlagPaused()) return body;
      if (typeof body === 'string' && !body.includes('ChatThemesQE')) return body;
      const form = typeof FormData !== 'undefined' && body instanceof FormData;
      if (typeof body !== 'string' && !form && !(body instanceof URLSearchParams)) return body;
      const text = typeof body === 'string' ? new URLSearchParams(body).get('variables') : body.get('variables');
      if (typeof text !== 'string' || !text.includes('ChatThemesQE')) return body;
      const vars = JSON.parse(text);
      if (vars?.[THEME_FLAG] !== false) return body;
      vars[THEME_FLAG] = true;
      if (!form) {
        const params = new URLSearchParams(body);
        params.set('variables', JSON.stringify(vars));
        return typeof body === 'string' ? params.toString() : params;
      }
      const copy = new FormData();
      for (const [k, v] of body.entries()) copy.append(k, k === 'variables' ? JSON.stringify(vars) : v);
      return copy;
    } catch (_) { return body; }
  }

  // Safety: if Instagram ever rejects a request with the flag set (HTTP error or GraphQL errors),
  // stop setting it for a day so conversations always load. The retry time is kept in this site's
  // local storage, so a rejection is not repeated on every page load.
  const THEME_PAUSE_KEY = 'igt-chat-theme-paused-until';
  const THEME_PAUSE_MS = 24 * 60 * 60 * 1000;
  let themePausedUntil = 0;
  try { themePausedUntil = Number(window.localStorage?.getItem(THEME_PAUSE_KEY)) || 0; } catch (_) {}
  const themeFlagPaused = () => Date.now() < themePausedUntil;
  function checkThemeResponse(status, text) {
    let failed = !(status >= 200 && status < 300);
    if (!failed && typeof text === 'string' && text.length <= MAX_RESPONSE_BYTES) {
      const docs = parseAll(text);
      failed = !docs.length || docs.some((d) => Array.isArray(d?.errors) && d.errors.length > 0);
    }
    if (!failed || themeFlagPaused()) return;
    themePausedUntil = Date.now() + THEME_PAUSE_MS;
    try { window.localStorage?.setItem(THEME_PAUSE_KEY, String(themePausedUntil)); } catch (_) {}
    slog(`chat themes paused for 24 h: conversation request answered ${status}${failed && status < 300 ? ' with errors' : ''}`);
  }
  // The conversation request often finishes before content.js starts listening; keep recent
  // themes so it can ask for them.
  const recentThemes = new Map();

  const THEME_COLORS = ['gradient_colors', 'incoming_message_bubble_color', 'inbound_message_text_color',
    'outbound_message_text_color', 'thread_background_color', 'composer_input_background_color'];
  // One light / dark variant: ARGB hex colors and an optional background image.
  function themeVariant(t) {
    if (!t || typeof t !== 'object') return null;
    const argb = (v) => typeof v === 'string' && /^[0-9a-f]{8}$/i.test(v) ? v.toUpperCase() : null;
    const v = { mode: t.app_color_mode === 'DARK' ? 'dark' : 'light' };
    for (const key of THEME_COLORS) {
      v[key] = key === 'gradient_colors'
        ? (Array.isArray(t.gradient_colors) ? t.gradient_colors.map(argb).filter(Boolean).slice(0, 8) : [])
        : argb(t[key]);
    }
    const bg = t.thread_background_asset?.url_1024 || t.thread_background_asset?.url_480;
    v.background = typeof bg === 'string' && validUrl(bg) && /^https:/.test(bg) ? bg : null;
    return v;
  }
  function toTheme(data) {
    if (!data || typeof data !== 'object') return null;
    const variants = [data, ...(Array.isArray(data.alternative_themes) ? data.alternative_themes : [])]
      .slice(0, 4).map(themeVariant).filter(Boolean);
    return variants.length ? { variants } : null;
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
      // The logged-in account's own profile (pk = ds_user_id cookie) and its list sizes.
      if (out.viewerPk && String(node.pk ?? node.id ?? '') === out.viewerPk) {
        const count = (...vs) => vs.find((v) => Number.isSafeInteger(v) && v >= 0) ?? null;
        out.viewer = {
          username: node.username.toLowerCase(),
          followers: count(node.follower_count, node.edge_followed_by?.count, out.viewer?.followers),
          following: count(node.following_count, node.edge_follow?.count, out.viewer?.following)
        };
      }
    }
    // A conversation: thread_key is the id in /direct/t/<id>/. A null theme means "no theme".
    if ('theme_data' in node && typeof node.thread_key === 'string' && /^\d{5,32}$/.test(node.thread_key)) {
      out.themes.push({ thread: node.thread_key, theme: toTheme(node.theme_data) });
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
    if (!/profile_pic_url|image_versions2|video_versions|display_url|music|audio|followed_by|theme_data/.test(text)) return;
    stats.withPics++;
    const out = { pics: [], media: [], items: [], friendships: [], themes: [], viewerPk: cookie('ds_user_id') };
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
    const out = { pics: [], media: [], items: [], friendships: [], themes: [], viewerPk: cookie('ds_user_id') };
    collect(obj, out, 0);
    publish(out);
    logSongs(out.media, req);
  }

  function send(msg) {
    window.postMessage(msg, location.origin);
  }

  // Your own profile as last seen (username, list sizes); content.js may start listening late.
  let viewer = null;
  function publish({ pics, media, items, friendships, themes, viewer: me }) {
    if (me) {
      const same = viewer?.username === me.username;
      const next = { username: me.username, followers: me.followers ?? (same ? viewer.followers : null),
        following: me.following ?? (same ? viewer.following : null) };
      if (JSON.stringify(next) !== JSON.stringify(viewer)) {
        viewer = next;
        send({ source: 'ighd-viewer', ...viewer });
      }
    }
    for (const p of pics) remember(stats.users, p.username, null, 1000);
    if (pics.length) send({ source: 'ighd-pics', pics });
    if (media.length) send({ source: 'ighd-media', media });
    if (items.length) send({ source: 'ighd-items', items });
    if (friendships.length) send({ source: 'ighd-friendship', friendships });
    for (const t of themes) remember(recentThemes, t.thread, t, 200);
    if (themes.length) send({ source: 'ighd-themes', themes });
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

  // All of the extension's own requests go through one queue: never two at the same time.
  let requestChain = Promise.resolve();
  function serial(task) {
    const job = requestChain.then(task);
    requestChain = job.catch(() => {});
    return job;
  }

  // After a 429 (or a block / error during a list scan) no own request is made until this time.
  let retryAfterUntil = 0;
  function coolDown(ms) {
    retryAfterUntil = Math.max(retryAfterUntil, Date.now() + Math.min(900000, Math.max(60000, ms || 0)));
  }
  function noteRateLimit(res) {
    if (res.status !== 429) return;
    const retry = res.headers.get('retry-after');
    coolDown(/^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now());
  }

  function apiRequestHeaders() {
    let claim = '0';
    try { claim = sessionStorage.getItem('www-claim-v2') || '0'; } catch (_) {}
    return {
      'x-ig-app-id': '936619743392459',
      'x-requested-with': 'XMLHttpRequest',
      'x-ig-www-claim': claim,
      ...(apiHeaders || {}),
      'x-csrftoken': cookie('csrftoken')
    };
  }

  const detailJobs = new Map();
  function loadPostDetails(code) {
    if (!/^[A-Za-z0-9_-]{5,32}$/.test(code)) return Promise.resolve({ ok: false, reason: 'bad code' });
    if (detailJobs.has(code)) return detailJobs.get(code);
    if (detailJobs.size >= 6) return Promise.resolve({ ok: false, reason: 'queue full' });
    const job = serial(() => fetchPostDetails(code));
    detailJobs.set(code, job);
    job.finally(() => detailJobs.delete(code)).catch(() => {});
    return job;
  }

  async function fetchPostDetails(code) {
    if (Date.now() < retryAfterUntil) return { ok: false, status: 429, reason: 'rate limit cooldown' };
    const id = codeToId(code);
    if (!id) return { ok: false, reason: 'bad code' };
    const url = `${location.origin}/api/v1/media/${id}/info/`;
    const headers = apiRequestHeaders();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await origFetch(url, { headers, credentials: 'include', signal: controller.signal });
      noteRateLimit(res);
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

  // ---------- Non-followers scan ----------
  // Reads your own Followers and Following lists with the requests the website makes when you
  // scroll those dialogs (12 accounts per page), one page at a time with 2–4 s between pages, and
  // reports the accounts you follow that are not in your followers. Only on your own profile, only
  // after you press Start; any 429, block or error ends the scan, with no automatic retry.
  const SCAN_PAGE_SIZE = 12;
  const SCAN_PAGE_LIMIT = 300;
  const BLOCKED = /checkpoint|feedback_required|challenge|login_required|spam|rate limit|try again later|please wait/i;
  let scan = null;

  const routeUser = () => (location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
  const scanSend = (s, msg) => send({ source: 'ighd-nf', id: s.id, ...msg });

  function scanPageUrl(kind, viewerPk, maxId) {
    const cursor = maxId == null ? '' : `&max_id=${encodeURIComponent(maxId)}`;
    const tail = kind === 'followers' ? '&search_surface=follow_list_page' : '';
    return `${location.origin}/api/v1/friendships/${viewerPk}/${kind}/?count=${SCAN_PAGE_SIZE}${cursor}${tail}`;
  }

  function scanUser(u) {
    if (!u || typeof u !== 'object') return null;
    const pk = String(u.pk ?? u.pk_id ?? u.id ?? '');
    if (!/^\d{1,32}$/.test(pk) || typeof u.username !== 'string' || !/^[A-Za-z0-9._]{1,30}$/.test(u.username)) return null;
    return {
      pk,
      username: u.username.toLowerCase(),
      fullName: typeof u.full_name === 'string' ? u.full_name.slice(0, 100) : '',
      pic: typeof u.profile_pic_url === 'string' && validUrl(u.profile_pic_url) ? u.profile_pic_url : '',
      isPrivate: u.is_private === true,
      isVerified: u.is_verified === true
    };
  }

  // Sleeps between pages; Cancel wakes it up early.
  const scanPause = (s, ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    s.wake = () => { clearTimeout(timer); resolve(); };
  });

  // One page. Returns { users, next } or throws an Error with `stop` (reason) and `cool` (ms).
  async function scanPage(s, kind, maxId) {
    const fail = (stop, cool, detail) => Object.assign(new Error(detail || stop), { stop, cool });
    if (Date.now() < retryAfterUntil) throw fail('cooldown', 0);
    const url = scanPageUrl(kind, s.viewerPk, maxId);
    s.controller = new AbortController();
    const timer = setTimeout(() => s.controller.abort(), 8000);
    try {
      let res;
      try {
        res = await origFetch(url, { headers: apiRequestHeaders(), credentials: 'include', signal: s.controller.signal });
      } catch (e) { throw s.cancelled ? fail('cancelled', 0) : fail('network', 60000, e.message); }
      noteRateLimit(res);
      if (res.status === 429) throw fail('rate-limit', 0, 'HTTP 429');
      const text = await readResponseText(res);
      if (s.cancelled) throw fail('cancelled', 0);
      let data = null;
      try { data = text == null ? null : JSON.parse(text.replace(/^\s*for\s*\(;;\);\s*/, '')); } catch (_) {}
      const said = `${data?.message || ''} ${data?.error_type || ''} ${data?.spam ? 'spam' : ''}`;
      if (BLOCKED.test(said) || (res.status >= 400 && BLOCKED.test(text || ''))) throw fail('blocked', 900000, `HTTP ${res.status} ${said.trim()}`);
      if (!res.ok) throw fail('error', 60000, `HTTP ${res.status}`);
      if (!data || data.status !== 'ok' || !Array.isArray(data.users)) throw fail('error', 60000, 'unexpected response');
      if (data[`should_limit_list_of_${kind}`] === true) throw fail('limited', 0, `Instagram limits the ${kind} list`);
      const next = typeof data.next_max_id === 'string' || typeof data.next_max_id === 'number' ? String(data.next_max_id) : '';
      return { users: data.users.slice(0, 200).map(scanUser).filter(Boolean),
        next: data.has_more !== false && next && data.users.length ? next : null };
    } finally { clearTimeout(timer); s.controller = null; }
  }

  async function runScan(s) {
    const lists = { followers: new Map(), following: new Map() };
    const progress = (list) => scanSend(s, { state: 'running', list, followers: lists.followers.size,
      following: lists.following.size, pages: s.pages, totals: s.totals });
    try {
      for (const kind of ['followers', 'following']) {
        let maxId = null;
        progress(kind);
        do {
          if (s.cancelled) throw Object.assign(new Error('cancelled'), { stop: 'cancelled' });
          if (s.pages >= SCAN_PAGE_LIMIT) throw Object.assign(new Error('page limit'), { stop: 'limit' });
          if (s.pages > 0) await scanPause(s, 2000 + Math.floor(Math.random() * 2001));
          if (s.cancelled) throw Object.assign(new Error('cancelled'), { stop: 'cancelled' });
          const page = await serial(() => scanPage(s, kind, maxId));
          s.pages++;
          for (const u of page.users) lists[kind].set(u.pk, u);
          maxId = page.next;
          progress(kind);
        } while (maxId);
        slog(`non-followers: ${kind} ${lists[kind].size} in ${s.pages} pages`);
      }
      const nonFollowers = [...lists.following.values()].filter((u) => !lists.followers.has(u.pk));
      slog(`non-followers: done, ${nonFollowers.length} of ${lists.following.size} don't follow back`);
      scanSend(s, { state: 'done', followers: lists.followers.size, following: lists.following.size,
        pages: s.pages, totals: s.totals, users: nonFollowers });
    } catch (e) {
      const reason = e.stop || 'error';
      if (e.cool) coolDown(e.cool);
      slog(`non-followers: stopped (${reason}${e.message && e.message !== reason ? `: ${e.message}` : ''}) after ${s.pages} pages`);
      scanSend(s, { state: reason === 'cancelled' ? 'cancelled' : 'stopped', reason, detail: String(e.message || '').slice(0, 160),
        followers: lists.followers.size, following: lists.following.size, pages: s.pages,
        retryAt: Date.now() < retryAfterUntil ? retryAfterUntil : null });
    } finally {
      if (scan === s) scan = null;
    }
  }

  // Called for the Start button. Refuses unless this tab shows your own profile, the click just
  // happened, and no scan or cooldown is in progress.
  function startScan(id) {
    if (scan) return;
    const refuse = (reason, extra) => send({ source: 'ighd-nf', id, state: 'refused', reason, ...extra });
    const viewerPk = cookie('ds_user_id');
    if (!/^\d{1,32}$/.test(viewerPk) || !viewer || viewer.username !== routeUser()) return refuse('not-own-profile');
    if (navigator.userActivation?.isActive !== true) return refuse('no-click');
    if (Date.now() < retryAfterUntil) return refuse('cooldown', { retryAt: retryAfterUntil });
    const totals = { followers: viewer.followers, following: viewer.following };
    const needed = Math.ceil((totals.followers || 0) / SCAN_PAGE_SIZE) + Math.ceil((totals.following || 0) / SCAN_PAGE_SIZE);
    if (needed > SCAN_PAGE_LIMIT) return refuse('too-large', { pages: needed, limit: SCAN_PAGE_LIMIT });
    scan = { id, viewerPk, totals, pages: 0, cancelled: false, controller: null, wake: null };
    slog(`non-followers: started (${totals.followers ?? '?'} followers, ${totals.following ?? '?'} following)`);
    runScan(scan);
  }

  function cancelScan(id) {
    if (!scan || scan.id !== id) return;
    scan.cancelled = true;
    scan.controller?.abort();
    scan.wake?.();
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
    let req = null, themed = false;
    try {
      const url = a instanceof Request ? a.url : String(a);
      if (interesting(url) && args[1]?.body != null) {
        const body = withChatThemes(args[1].body);
        if (body !== args[1].body) { args[1] = { ...args[1], body }; themed = true; }
      }
    } catch (_) {}
    const init = args[1] || {};
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
    if (themed) {
      try {
        readResponseText(res.clone()).then((t) => checkThemeResponse(res.status, t)).catch(() => {});
      } catch (_) {}
    }
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
          if (this.__igt.themed) {
            const text = this.responseType === '' || this.responseType === 'text' ? this.responseText : null;
            checkThemeResponse(this.status, text);
          }
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
      const sent = withChatThemes(body);
      this.__igt.themed = sent !== body;
      body = sent;
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
    } else if (e.data?.source === 'ighd-themes-request') {
      if (recentThemes.size) send({ source: 'ighd-themes', themes: [...recentThemes.values()] });
    } else if (e.data?.source === 'ighd-viewer-request') {
      if (viewer) send({ source: 'ighd-viewer', ...viewer });
    } else if (e.data?.source === 'ighd-nf-start' && typeof e.data.id === 'string') {
      startScan(e.data.id);
    } else if (e.data?.source === 'ighd-nf-cancel' && typeof e.data.id === 'string') {
      cancelScan(e.data.id);
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
