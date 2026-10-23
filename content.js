(() => {
  'use strict';

  // First URL segments that are not user profiles.
  const RESERVED = new Set([
    'explore', 'reels', 'reel', 'p', 'tv', 'direct', 'accounts', 'stories',
    'about', 'legal', 'developer', 'challenge', 'emails', 'web', 'api', 'ar',
    'lite', 'session', 'oauth', 'privacy', 'terms', 'nametag', 'directory',
    'graphql', 'popular', 'topics', 'locations', 'press', 'blog', 'jobs',
    'help', 'login', 'signup', 'threads', 'your_activity', 'notifications'
  ]);

  function getUsername() {
    const seg = location.pathname.split('/').filter(Boolean);
    if (!seg.length) return null;
    const name = seg[0];
    if (RESERVED.has(name.toLowerCase())) return null;
    if (!/^[A-Za-z0-9._]{1,30}$/.test(name)) return null;
    return name;
  }

  // Messages come from intercept.js, running in this same page.
  const fromPage = (e) => e.source === window && e.origin === location.origin;

  // Retain recent data only; infinite scrolling must not grow tab caches indefinitely.
  function remember(store, key, value, limit = 500) {
    store.delete(key);
    if (store instanceof Map) store.set(key, value); else store.add(key);
    if (store.size > limit) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
      return oldest;
    }
  }

  // ---------- Data ----------
  // Profile pictures come from data the page already received while you browse.

  const seen = new Map();
  let interceptStats = null;

  window.addEventListener('message', (e) => {
    if (!fromPage(e)) return;
    if (e.data?.source === 'ighd-stats') {
      interceptStats = e.data;
      return;
    }
    if (e.data?.source !== 'ighd-pics' || !Array.isArray(e.data.pics)) return;
    for (const p of e.data.pics) {
      if (typeof p?.username !== 'string' || typeof p.url !== 'string') continue;
      const prev = seen.get(p.username);
      if (!prev || p.hd || !prev.hd) remember(seen, p.username, { url: p.url, hd: !!p.hd });
    }
  });

  // Whether each user follows you, from the profile data the site already loaded.
  const friendships = new Map();
  window.addEventListener('message', (e) => {
    if (!fromPage(e) || e.data?.source !== 'ighd-friendship' || !Array.isArray(e.data.friendships)) return;
    for (const f of e.data.friendships) {
      if (typeof f?.username !== 'string' || typeof f.followedBy !== 'boolean') continue;
      remember(friendships, f.username, { followedBy: f.followedBy, pk: String(f.pk || '') });
    }
    updateFollowBadge();
  });

  function interceptDiag(key) {
    if (!interceptStats) return 'interceptor inactive: reload the page (F5)';
    const s = interceptStats;
    const tail = seen.has(key)
      ? `no HD version received for @${key}`
      : `no data received for @${key}; open the profile by navigating inside the site`;
    return `${s.responses} responses read, ${s.users} users · ${tail}`;
  }

  async function waitForSeenHd(key, ms) {
    interceptStats = null;
    window.postMessage({ source: 'ighd-scan' }, location.origin);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (seen.get(key)?.hd) return seen.get(key);
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }

  // Last resort: the avatar already shown on the page (low resolution).
  function avatarFromPage(key) {
    if (getUsername()?.toLowerCase() !== key) return null;
    const img = [...document.querySelectorAll('header img, main img')].find((i) =>
      (i.alt || '').toLowerCase().includes(key)
    ) || document.querySelector('header img');
    if (!img) return null;
    let best = { url: img.currentSrc || img.src, w: 0 };
    for (const part of (img.srcset || '').split(',')) {
      const [u, size] = part.trim().split(/\s+/);
      const w = parseInt(size, 10) || 0;
      if (u && w > best.w) best = { url: u, w };
    }
    return best.url || null;
  }

  async function getProfilePic(username) {
    const key = username.toLowerCase();

    const hd = await waitForSeenHd(key, 1500);
    if (hd) return { url: hd.url, hd: true, username };

    const url = seen.get(key)?.url || avatarFromPage(key);
    if (!url) throw new Error(interceptDiag(key));
    return { url, hd: false, username, note: interceptDiag(key) };
  }

  // ---------- UI ----------

  const btn = document.createElement('button');
  btn.id = 'ighd-btn';
  btn.type = 'button';
  btn.title = 'View profile picture in HD';
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/>
      <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      <line x1="10.5" y1="7.5" x2="10.5" y2="13.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <span>HD photo</span>`;
  btn.addEventListener('click', () => {
    const u = getUsername();
    if (u) openViewer(u);
  });

  let overlay = null;

  function closeViewer() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeViewer();
    }
  }

  async function openViewer(username) {
    closeViewer();
    overlay = document.createElement('div');
    overlay.id = 'ighd-overlay';
    overlay.innerHTML = `
      <div class="ighd-box">
        <div class="ighd-stage"><div class="ighd-spinner"></div></div>
        <div class="ighd-bar">
          <div class="ighd-info"><strong>@${username}</strong><span class="ighd-meta">Loading…</span></div>
          <div class="ighd-actions">
            <button type="button" class="ighd-dl" disabled>Download</button>
            <button type="button" class="ighd-open" disabled>Open</button>
            <button type="button" class="ighd-close" aria-label="Close">✕</button>
          </div>
        </div>
      </div>`;
    const myOverlay = overlay;
    overlay.addEventListener('click', (e) => { if (e.target === myOverlay) closeViewer(); });
    overlay.querySelector('.ighd-close').addEventListener('click', closeViewer);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);

    const stage = overlay.querySelector('.ighd-stage');
    const meta = overlay.querySelector('.ighd-meta');
    const dlBtn = overlay.querySelector('.ighd-dl');
    const openBtn = overlay.querySelector('.ighd-open');

    let pic;
    try {
      pic = await getProfilePic(username);
    } catch (err) {
      if (overlay !== myOverlay) return;
      stage.innerHTML = '<div class="ighd-error">Could not find the profile picture.<br><small></small></div>';
      stage.querySelector('small').textContent = err.message;
      meta.textContent = 'Error';
      return;
    }
    if (overlay !== myOverlay) return;

    const img = new Image();
    img.alt = `Profile picture of @${pic.username}`;
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      stage.replaceChildren(img);
      const res = `${img.naturalWidth}×${img.naturalHeight}`;
      meta.textContent = pic.hd
        ? `${res} · HD`
        : `${res} · standard quality${pic.note ? ` (${pic.note})` : ''}`;
    };
    img.onerror = () => {
      stage.innerHTML = '<div class="ighd-error">The image could not be loaded.</div>';
    };
    img.src = pic.url;

    openBtn.disabled = false;
    openBtn.addEventListener('click', () => window.open(pic.url, '_blank', 'noopener'));

    dlBtn.disabled = false;
    dlBtn.addEventListener('click', () => {
      dlBtn.disabled = true;
      dlBtn.textContent = 'Downloading…';
      chrome.runtime.sendMessage(
        { type: 'download', url: pic.url, filename: `${pic.username}_profile_hd.jpg` },
        (resp) => {
          dlBtn.disabled = false;
          dlBtn.textContent = resp?.ok ? 'Downloaded ✓' : 'Retry';
        }
      );
    });
  }

  // ---------- Post / video download ----------
  // Media URLs also come from intercept.js: only what the page already loaded for you.

  const mediaByCode = new Map();
  window.addEventListener('message', (e) => {
    if (!fromPage(e) || e.data?.source !== 'ighd-media' || !Array.isArray(e.data.media)) return;
    let credits = false;
    for (const m of e.data.media) {
      if (typeof m?.code !== 'string' || !Array.isArray(m.items)) continue;
      const evicted = remember(mediaByCode, m.code, mergePost(mediaByCode.get(m.code), m));
      if (evicted) detailsTried.delete(evicted); // revisiting an evicted post may reload its data
      if (m.music || m.audio) credits = true;
    }
    if (credits) queueScan();
  });

  // A real video file beats a still image, which beats nothing.
  const itemScore = (it) => (!it?.url ? 0 : it.type === 'video' ? 2 : 1);

  // The same post can arrive several times with different detail: keep the best of each item,
  // and never let a thumbnail replace a video.
  function mergePost(prev, next) {
    if (!prev) return next;
    const music = prev.music || next.music || null;
    let audio = next.audio || prev.audio || null;
    if (prev.audio && next.audio && prev.audio.original === next.audio.original) {
      audio = { ...next.audio, title: next.audio.title || prev.audio.title,
        artist: next.audio.artist || prev.audio.artist };
    }
    if (prev.items.length !== next.items.length) {
      const total = (p) => p.items.reduce((s, it) => s + itemScore(it), 0);
      return { ...(total(next) >= total(prev) ? next : prev), music, audio };
    }
    const items = prev.items.map((p, i) => {
      const n = next.items[i];
      const best = itemScore(n) > itemScore(p) ? { ...n } : { ...p };
      if (p.type === 'video' || n.type === 'video') {
        if (best.type !== 'video') best.url = null;
        best.type = 'video';
      }
      best.thumb = best.thumb || p.thumb || n.thumb;
      return best;
    });
    return { ...prev, username: prev.username || next.username, items, music, audio };
  }

  const POST_PATH = /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/;
  // aria-label of the "like" icon in the most common interface languages.
  const LIKE_LABEL = /^(like|unlike|me gusta|ya no me gusta|curtir|descurtir|j[’']aime|je n[’']aime plus|gefällt mir|gefällt mir nicht mehr|mi piace|non mi piace più)$/i;
  const COMMENT_LABEL = /^(comment|comentar|commenter|kommentieren|commenta|comentário)$/i;
  const labelOf = (svg) => (svg.getAttribute('aria-label') || '').trim();
  // The post bar uses 24px icons; comments use small 12px hearts.
  const bigIcon = (svg) => Number(svg.getAttribute('width')) >= 20 || svg.getBoundingClientRect().width >= 20;

  // The like / comment / share row of a post: the smallest box holding the big like icon and the
  // comment icon, and no other big like icon (so never a comment, nor several posts at once).
  function postBars() {
    const bars = new Set();
    for (const svg of document.querySelectorAll('svg[aria-label]')) {
      if (!LIKE_LABEL.test(labelOf(svg)) || !bigIcon(svg)) continue;
      let group = svg.parentElement;
      for (let i = 0; i < 10 && group; i++) {
        const icons = [...group.querySelectorAll('svg[aria-label]')];
        if (icons.some((s) => COMMENT_LABEL.test(labelOf(s)))) {
          const likes = icons.filter((s) => LIKE_LABEL.test(labelOf(s)) && bigIcon(s));
          if (likes.length === 1) bars.add(group);
          break;
        }
        group = group.parentElement;
      }
    }
    return bars;
  }

  function codeFor(group) {
    const scope = group.closest('article') || group.closest('[role="dialog"]');
    if (scope) {
      for (const a of scope.querySelectorAll('a[href]')) {
        const m = a.getAttribute('href').match(POST_PATH);
        if (m) return m[1];
      }
    }
    const m = location.pathname.match(POST_PATH);
    return m ? m[1] : null;
  }

  function extFrom(url, type) {
    try {
      const m = new URL(url).pathname.match(/\.(jpe?g|png|webp|heic|mp4|mov)$/i);
      if (m) return m[1].toLowerCase();
    } catch (_) {}
    return type === 'video' ? 'mp4' : 'jpg';
  }

  let toastTimer = null;
  function toast(text, duration = 3000) {
    let el = document.getElementById('ighd-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ighd-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  function download(url, filename) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'download', url, filename }, (resp) => resolve(!!resp?.ok));
    });
  }

  const toDataUrl = (buf, type) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(new Blob([buf], { type }));
  });

  const MAX_REPAIR_BYTES = 8 * 1024 * 1024;
  let repairingDownload = false;
  // Only small story videos need local timing repair. Ordinary videos go straight to
  // the browser downloader, without buffering a copy or downloading the same file twice.
  async function downloadMedia(it, filename, repairStory = false) {
    if (repairStory && !repairingDownload && it.type === 'video'
      && typeof globalThis.igtFixLowFpsMp4 === 'function') {
      repairingDownload = true;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(it.url, { signal: controller.signal });
        const length = Number(res.headers.get('content-length'));
        if (res.ok && length > 0 && length <= MAX_REPAIR_BYTES && res.body) {
          const reader = res.body.getReader(), chunks = [];
          let size = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > MAX_REPAIR_BYTES) {
                reader.cancel().catch(() => {});
                controller.abort();
                throw new Error('Story too large for repair');
              }
              chunks.push(value);
            }
          } finally { reader.releaseLock(); }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          chunks.length = 0;
          let fixed = null;
          try { fixed = globalThis.igtFixLowFpsMp4(bytes.buffer); } catch (_) {}
          // Reuse the bytes even if no repair applies, rather than fetching them again.
          return await download(await toDataUrl(fixed || bytes.buffer, 'video/mp4'), filename);
        }
        controller.abort();
      } catch (_) { controller.abort(); }
      finally { clearTimeout(timer); repairingDownload = false; }
    }
    return download(it.url, filename);
  }

  const fileKey = (u) => {
    try { return new URL(u).pathname.split('/').pop() || null; } catch (_) { return null; }
  };

  function srcKeys(el) {
    const urls = [el.currentSrc, el.src, el.poster];
    for (const part of (el.srcset || '').split(',')) urls.push(part.trim().split(/\s+/)[0]);
    return new Set(urls.filter((u) => /^https:/.test(u || '')).map(fileKey).filter(Boolean));
  }

  // How much of an element is really visible: its box clipped by the viewport and by every
  // ancestor that hides overflow (carousel slides off to the side end up with zero area).
  function visibleArea(el, stop, clips = null) {
    const r = el.getBoundingClientRect();
    let [x1, y1, x2, y2] = [r.left, r.top, r.right, r.bottom];
    const clip = (b) => {
      x1 = Math.max(x1, b.left); y1 = Math.max(y1, b.top);
      x2 = Math.min(x2, b.right); y2 = Math.min(y2, b.bottom);
    };
    clip({ left: 0, top: 0, right: innerWidth, bottom: innerHeight });
    if (x2 <= x1 || y2 <= y1) return 0;
    for (let a = el.parentElement; a && a !== stop; a = a.parentElement) {
      const cs = getComputedStyle(a);
      // Root overflow is applied to the viewport, already clipped above. Its DOM rect
      // moves with document scrolling and must not clip viewport-relative media a second time.
      if (a === document.documentElement || cs.display === 'contents') continue;
      if (a === document.body) {
        const root = getComputedStyle(document.documentElement);
        if (document.scrollingElement === a
          || (root.overflowX === 'visible' && root.overflowY === 'visible')) continue;
      }
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = a.getBoundingClientRect();
      if (cs.overflowX !== 'visible') {
        x1 = Math.max(x1, b.left);
        x2 = Math.min(x2, b.right);
      }
      if (cs.overflowY !== 'visible') {
        y1 = Math.max(y1, b.top);
        y2 = Math.min(y2, b.bottom);
      }
      if (clips) clips.push({ tag: a.tagName, overflowX: cs.overflowX, overflowY: cs.overflowY,
        top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) });
      if (x2 <= x1 || y2 <= y1) return 0;
    }
    return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  }

  function viewportArea(rect) {
    return Math.min(rect.width, innerWidth) * Math.min(rect.height, innerHeight);
  }

  // Index from the carousel position: slides are shifted by multiples of their own width.
  function slideIndex(el, stop) {
    for (let a = el; a && a !== stop; a = a.parentElement) {
      const m = (a.style?.transform || '').match(/translateX\((-?[\d.]+)px\)/);
      if (m && a.offsetWidth) return Math.round(parseFloat(m[1]) / a.offsetWidth);
    }
    return -1;
  }

  // Which item of the post you are looking at, and whether it is shown as a video.
  function selection(group, post) {
    const scope = group.closest('article') || group.closest('[role="dialog"]') || document.body;
    const n = post.items.length;
    let shown = null;
    let bestArea = 0;
    for (const el of scope.querySelectorAll('img, video')) {
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.height < 150) continue;
      const area = visibleArea(el, scope.parentElement);
      if (area > bestArea) {
        shown = el;
        bestArea = area;
      }
    }
    // A video often sits on top of its own poster image: check videos covering the same spot.
    const overlaps = (a, b) => {
      const p = a.getBoundingClientRect();
      const q = b.getBoundingClientRect();
      const w = Math.min(p.right, q.right) - Math.max(p.left, q.left);
      const h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      return w > p.width * 0.5 && h > p.height * 0.5;
    };
    const showsVideo = !!shown && (shown.tagName === 'VIDEO' || [...scope.querySelectorAll('video')].some(
      (v) => overlaps(shown, v) && visibleArea(v, scope.parentElement) > 0
    ));
    if (n === 1) return { index: 0, showsVideo };
    if (!shown) return null;

    // 1) Match the image file on screen with the post data.
    const keys = srcKeys(shown);
    let index = post.items.findIndex((it) => keys.has(fileKey(it.thumb)) || keys.has(fileKey(it.url)));
    // 2) The carousel position.
    if (index < 0) index = slideIndex(shown, scope);
    // 3) A video on screen and only one video in the post.
    if (index < 0 && showsVideo) {
      const videos = post.items.map((it, i) => (it.type === 'video' ? i : -1)).filter((i) => i >= 0);
      if (videos.length === 1) index = videos[0];
    }
    return index >= 0 && index < n ? { index, showsVideo } : null;
  }

  // An item is ready when it has a file and, if a video is on screen, that file is the video.
  const ready = (it, showsVideo) => !!it?.url && (!showsVideo || it.type === 'video');

  async function waitForItem(code, index, showsVideo, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const it = mediaByCode.get(code)?.items[index];
      if (ready(it, showsVideo)) return it;
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  }

  function permalinkFor(group, code) {
    const scope = group.closest('article') || document;
    return [...scope.querySelectorAll('a[href]')].find((a) => {
      const m = a.getAttribute('href').match(POST_PATH);
      return m && m[1] === code;
    }) || null;
  }

  async function downloadPost(group) {
    const code = codeFor(group);
    if (!code) {
      toast('Could not identify this post.');
      return;
    }
    let post = mediaByCode.get(code);
    if (!post) {
      // The feed had no data for this post: ask the site for its details.
      remember(detailsTried, code, null, 2000);
      await loadPostDetails(code);
      post = mediaByCode.get(code);
    }
    if (!post) {
      toast('Media not loaded yet. Open the post or scroll it into view, then try again.');
      return;
    }
    const sel = selection(group, post);
    if (!sel) {
      toast('Could not tell which photo or video is selected. Open the post and try again.');
      return;
    }
    let item = post.items[sel.index];

    // In the feed, videos often come only as a stream. Opening the post makes the site load
    // the full .mp4 file; we pick it up, download it and go back to where you were.
    if (!ready(item, sel.showsVideo)) {
      toast('Loading the full video…');
      remember(detailsTried, code, null, 2000);
      await loadPostDetails(code);
      item = await waitForItem(code, sel.index, sel.showsVideo, 2000) || item;
    }
    if (!ready(item, sel.showsVideo) && !location.pathname.includes(code)) {
      const link = permalinkFor(group, code);
      if (link) {
        toast('Loading the full video…');
        const before = location.href;
        link.click();
        item = await waitForItem(code, sel.index, sel.showsVideo, 8000);
        if (location.href !== before) history.back();
      }
    }

    if (!ready(item, sel.showsVideo)) {
      toast('This video is only available as a stream and cannot be downloaded.');
      return;
    }
    const suffix = post.items.length > 1 ? `_${sel.index + 1}` : '';
    const name = `${post.username || 'post'}_${code}${suffix}.${extFrom(item.url, item.type)}`;
    toast((await downloadMedia(item, name)) ? `Downloaded ${item.type} ✓` : 'Download failed');
  }

  const DL_ICON = `
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d="M12 3v12m0 0l-5-5m5 5l5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;

  // ---------- Music on photo posts ----------
  // The mobile app plays the song attached to a photo post; the website does not. When the post
  // data includes that song, a ♪ button plays the exact clip the author picked, in a loop.

  const MUSIC_ICON = `
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d="M9 18V5l11-2v13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="2"/>
      <circle cx="17" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`;
  const PAUSE_ICON = `
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/>
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>
    </svg>`;

  const player = globalThis.igtCreateMusicPlayer ? globalThis.igtCreateMusicPlayer() : new Audio();
  player.preload = 'metadata';
  let playing = null; // { code, music, button }
  let playRequest = null;
  let autoplayBlocked = false;
  let autoplayNoticeShown = false;
  let autoAttemptedButton = null;
  let lastFocus = undefined;
  let lastPlayError = null;
  const musicPosts = new Map(); // includes posts without songs, so they can take over with silence
  // Pressing pause stops automatic playback on every post until ♪ is pressed again.
  let pausedByUser = false;
  const watchedPosts = new Set();

  function stopMusic() {
    if (!playRequest && player.paused) return;
    playRequest = null; // ignore the result of a play() cancelled by scrolling or hiding the tab
    player.pause();
  }

  // Volume, remembered between visits.
  const VOLUME_KEY = 'igt-music-volume';
  try {
    const saved = parseFloat(localStorage.getItem(VOLUME_KEY));
    player.volume = Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 0.7;
  } catch (_) {
    player.volume = 0.7;
  }
  function setVolume(v) {
    player.volume = v;
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch (_) {}
    for (const r of document.querySelectorAll('.ighd-vol')) r.value = String(v);
  }

  function refreshMusicIcons() {
    for (const b of document.querySelectorAll('.ighd-music')) {
      const on = !!playing && playing.button === b && !player.paused;
      if (b.dataset.igtPlaying !== String(on)) {
        b.dataset.igtPlaying = String(on);
        b.innerHTML = on ? PAUSE_ICON : MUSIC_ICON;
      }
      b.title = on ? 'Pause music' : "Play this post's music";
    }
  }
  player.addEventListener('play', refreshMusicIcons);
  player.addEventListener('pause', refreshMusicIcons);
  player.addEventListener('timeupdate', () => {
    if (!playing) return;
    if (!playing.button.isConnected) {
      // The site re-rendered the post: follow the new button or re-evaluate visibility.
      const again = document.querySelector(`.ighd-music[data-code="${playing.code}"]`);
      if (again) playing.button = again;
      else {
        // Feed virtualization can remove the old post during a handoff. Let the focus
        // controller decide when to stop, rather than cutting the song between posts.
        updateFocusPlay();
      }
    }
    const { start, duration } = playing.music;
    if (player.currentTime >= (start + duration) / 1000) player.currentTime = start / 1000;
  });

  // Observe the photo itself, rather than the whole article (which can include long captions).
  // The focus calculation below also handles photos larger than the viewport.
  const musicVisibility = new IntersectionObserver(updateFocusPlay, {
    threshold: [0, 0.1, 0.3, 0.6, 0.9, 1]
  });
  const observedMusicBoxes = new Set();
  function observeMusicBox(box) { observedMusicBoxes.add(box); musicVisibility.observe(box); }

  // `fromClick`: started with the button (shows the song name and reports errors).
  async function startMusic(button, code, fromClick) {
    const music = mediaByCode.get(code)?.music;
    if (!music || playRequest?.button === button) return;
    // The click permits a fresh attempt. Do not keep the old block latched while this
    // clip loads: scrolling to the next post may cancel its play() promise first.
    if (fromClick) autoplayBlocked = false;
    const request = { button, code };
    playRequest = request;
    try {
      if (playing?.code !== code || playing.music.url !== music.url) {
        player.pause();
        playing = { code, music, button, path: location.pathname };
        if (player.src !== music.url) player.src = music.url;
        player.setClip?.(music.start, music.duration);
        // currentTime also sets the initial position before metadata is available. Call play()
        // in this event handler: waiting for loadedmetadata can lose the user's activation.
        player.currentTime = music.start / 1000;
      } else {
        playing.button = button;
        playing.path = location.pathname;
      }
      songLog(`music ${code}: trying (${fromClick ? 'button' : 'autoplay'})`);
      await player.play();
      if (playRequest !== request) return;
      autoplayBlocked = false;
      lastPlayError = null;
      songLog(`music ${code}: playing (${fromClick ? 'button' : 'autoplay'})`);
      const name = [music.title, music.artist].filter(Boolean).join(' · ');
      if (fromClick && name) toast(`♪ ${name}`);
    } catch (error) {
      if (playRequest !== request || error.name === 'AbortError') return;
      songLog(`music ${code}: ${error.name || 'playback error'}`);
      lastPlayError = { code, name: error.name || 'playback error', mode: fromClick ? 'button' : 'autoplay',
        message: String(error.message || '').slice(0, 300),
        userActivated: globalThis.navigator?.userActivation?.hasBeenActive ?? null };
      if (error.name === 'NotAllowedError') {
        autoplayBlocked = true;
        if (!autoplayNoticeShown) {
          autoplayNoticeShown = true;
          toast('The browser rejected autoplay. ♪ plays manually. Check the site’s Autoplay permission if this persists.', 10000);
        }
      } else if (fromClick) {
        toast('Could not play the music.');
      }
    } finally {
      if (playRequest === request) {
        playRequest = null;
        refreshMusicIcons();
      }
    }
  }

  function toggleMusic(button, code) {
    if (playing?.button === button && (!player.paused || playRequest?.button === button)) {
      stopMusic();
      pausedByUser = true;
    } else {
      pausedByUser = false;
      startMusic(button, code, true);
    }
  }

  // The next post takes over after filling 60% of the viewport's feed column. A shorter
  // photo must fit fully in view. Keep a partially visible post's song only while it
  // remains the dominant post; never carry it past the post or over another source.
  function musicFocus(diagnostics = false) {
    const dialogs = [...document.querySelectorAll('[role="dialog"], dialog[open]')].filter((d) =>
      getComputedStyle(d).visibility !== 'hidden' && visibleArea(d, null) > 0
    );
    const dialog = dialogs[dialogs.length - 1];
    let best = null;
    let bestArea = 0;
    let bestDistance = Infinity;
    let dominant = null;
    let dominantArea = 0;
    let dominantDistance = Infinity;
    const candidates = [];
    const posts = new Map();
    for (const [scope, post] of musicPosts) {
      if (!scope.isConnected || !post.box.isConnected) {
        musicVisibility.unobserve?.(post.box);
        observedMusicBoxes.delete(post.box);
        musicPosts.delete(scope);
        continue;
      }
      posts.set(post.box, { ...post, button: null });
    }
    for (const b of document.querySelectorAll('.ighd-music')) {
      const box = b.closest('.ighd-music-wrap')?.parentElement;
      if (!box) continue;
      posts.set(box, { code: b.dataset.code, box, button: b });
    }
    // Reels / videos can start before their post data or download bar is available.
    // Include native media directly, so pausing does not depend on identifying its code.
    for (const media of document.querySelectorAll('video, audio')) {
      const r = media.getBoundingClientRect();
      if (media.tagName === 'VIDEO' && (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth)) continue;
      const style = getComputedStyle(media);
      if (style.visibility === 'hidden' || style.opacity === '0') continue;
      let box = media;
      if (r.width < 150 || r.height < 150) {
        // An audio element may be hidden inside a visible post.
        if (media.tagName !== 'AUDIO' || media.paused || media.muted || !media.volume) continue;
        const scope = media.closest('article');
        box = scope && mediaBox(scope);
        if (!box) continue;
      }
      const known = [...posts.values()].find((p) => p.box === box || p.box.contains?.(box));
      if (known) known.native = true;
      else posts.set(box, { code: null, box, button: null, native: true });
    }
    for (const post of posts.values()) {
      const { box, code } = post;
      const r = box.getBoundingClientRect();
      const clips = diagnostics ? [] : null;
      const inViewport = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0))
        * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (!diagnostics && inViewport <= 0) continue;
      const area = inViewport > 0 ? visibleArea(box, null, clips) : 0;
      const available = viewportArea(r);
      const fraction = available > 0 ? area / available : 0;
      const columnArea = Math.min(r.width, innerWidth) * innerHeight;
      const required = Math.min(available, columnArea * 0.6);
      const covered = !!dialog && !dialog.contains(box);
      const eligible = available > 0 && area >= required;
      if (diagnostics) {
        const candidate = { code, visible: Math.round(fraction * 100), native: !!post.native,
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        viewportVisible: available > 0 ? Math.round(inViewport / available * 100) : 0,
        screen: columnArea > 0 ? Math.round(area / columnArea * 100) : 0,
        width: Math.round(r.width), height: Math.round(r.height), covered, eligible };
        if (area === 0 && inViewport > 0) candidate.clippedBy = clips;
        candidates.push(candidate);
      }
      const distance = Math.abs((r.top + r.bottom) / 2 - innerHeight / 2);
      if (!covered && area > 0 && (area > dominantArea
        || (area === dominantArea && distance < dominantDistance))) {
        dominant = post;
        dominantArea = area;
        dominantDistance = distance;
      }
      if (covered || !eligible) continue;
      if (area > bestArea || (area === bestArea && distance < bestDistance)) {
        best = post;
        bestArea = area;
        bestDistance = distance;
      }
    }
    const target = best?.box === dominant?.box ? best : null;
    return { target, button: target?.native ? null : target?.button || null, dominant, candidates, dialog };
  }

  function focusedMusicButton() {
    return musicFocus().button;
  }

  let focusQueued = false;
  function updateFocusPlay() {
    if (focusQueued) return;
    focusQueued = true;
    requestAnimationFrame(() => {
      focusQueued = false;
      if (document.hidden) {
        autoAttemptedButton = null;
        stopMusic();
        return;
      }
      const focus = musicFocus();
      const b = focus.button;
      const code = focus.target?.code || null;
      if (lastFocus !== code) {
        lastFocus = code;
        autoAttemptedButton = null;
        songLog(`focus: ${code || 'no eligible photo'}`);
      }
      if (playing && (playing.path !== location.pathname
        || (focus.dialog && !focus.dialog.contains(playing.button)))) {
        stopMusic();
        if (!focus.target || b === playing.button) return;
      }
      if (playing) {
        const box = playing.button.closest('.ighd-music-wrap')?.parentElement;
        const area = playing.button.isConnected && box ? visibleArea(box, null) : 0;
        const other = focus.dominant;
        const samePost = other && (other.box === box || (other.code && other.code === playing.code));
        if (area <= 0 || (other && (!samePost || other.native))) stopMusic();
      }
      if (!focus.target) {
        // A small scroll is not a pause while the current post remains dominant.
        return;
      }
      if (focus.target.native) {
        stopMusic();
        return;
      }
      if (!b) {
        // A new dominant post takes over with silence while its own song is loading.
        if (playing?.code !== code || !mediaByCode.get(code)?.music) stopMusic();
        return;
      }
      if (playing?.button === b && !player.paused) return;
      if (playing?.button !== b) {
        stopMusic();
      }
      if (!autoplayBlocked && !pausedByUser && autoAttemptedButton !== b) {
        // Periodic layout checks must not retry a broken media file over and over.
        autoAttemptedButton = b;
        startMusic(b, b.dataset.code, false);
      }
    });
  }
  window.addEventListener('scroll', updateFocusPlay, { passive: true, capture: true });
  window.addEventListener('resize', updateFocusPlay);
  document.addEventListener('play', updateFocusPlay, { capture: true });
  document.addEventListener('volumechange', updateFocusPlay, { capture: true });
  document.addEventListener('visibilitychange', () => {
    // Background tabs may suspend animation frames, so pause immediately.
    if (document.hidden) {
      autoAttemptedButton = null;
      stopMusic();
    }
    else updateFocusPlay();
  });

  function retryMusicOnGesture(e) {
    if (!e.isTrusted || document.hidden || !autoplayBlocked) return;
    if (e.type === 'keydown' && (e.repeat || !['Enter', 'Space'].includes(e.code))) return;
    // The music controls have their own click handlers; don't turn a pause into a restart.
    if (e.target?.closest?.('.ighd-music-wrap')) return;
    // Remember the gesture even if it happens in the gap between posts. Otherwise the
    // old block flag would prevent the next post from ever making an autoplay attempt.
    autoplayBlocked = false;
    autoAttemptedButton = null;
    const b = focusedMusicButton();
    if (!b || pausedByUser) return;
    // Stay inside the trusted gesture instead of deferring play() to an animation frame.
    startMusic(b, b.dataset.code, false);
  }
  document.addEventListener('click', retryMusicOnGesture, { capture: true });
  document.addEventListener('keydown', retryMusicOnGesture, { capture: true });

  // Catch layout shifts, SPA dialog changes and scroll containers even when no new scroll
  // event reaches us. Hidden tabs do no work; a failed attempt is limited to once per focus.
  setInterval(() => {
    if (!document.hidden && (playing || musicPosts.size || document.querySelector('.ighd-music'))) updateFocusPlay();
  }, 600);

  window.addEventListener('message', (e) => {
    if (!fromPage(e)) return;
    if (e.data?.source === 'ighd-load-post-result' && typeof e.data.code === 'string') {
      updateFocusPlay();
      return;
    }
    if (e.data?.source !== 'ighd-music-status') return;
    const focus = musicFocus(true);
    window.postMessage({ source: 'ighd-music-status-result', text: JSON.stringify({
      viewport: `${innerWidth}x${innerHeight}`, hidden: document.hidden,
      version: globalThis.chrome?.runtime?.getManifest?.()?.version || 'unknown',
      focused: focus.target?.code || null, playing: playing?.code || null,
      dominant: focus.dominant?.code || (focus.dominant?.native ? 'native media' : null),
      paused: player.paused, pending: playRequest?.code || null, blocked: autoplayBlocked,
      lastError: lastPlayError, userActivated: globalThis.navigator?.userActivation?.hasBeenActive ?? null,
      audioEngine: player.engine || 'page',
      manualPause: pausedByUser,
      dialog: !!focus.dialog, candidates: focus.candidates
    }) }, location.origin);
  });

  // Hovering a post also asks for its song right away (see below).
  function watchHover(scope) {
    if (scope.dataset.igtHover) return;
    scope.dataset.igtHover = '1';
    scope.addEventListener('mouseenter', () => requestPrefetch(scope));
  }

  // ---------- Finding the song of feed posts ----------
  // The feed data often has no song for a post. When you stop on a photo post (or point at it),
  // intercept.js asks the site for that post's details, the same request the site makes when you
  // open the post; the answer includes the song. One post at a time, with recent lookups
  // deduplicated. Revisiting an evicted post can reload its details.

  const detailsTried = new Set();
  const detailsQueue = [];
  let detailsBusy = false;
  const dwellTimers = new WeakMap();

  const logged = new Set();
  function songLog(text) {
    if (logged.has(text)) return;
    remember(logged, text, null, 200);
    window.postMessage({ source: 'ighd-log', text: `feed: ${text}` }, location.origin);
  }

  const prefetchObserver = new IntersectionObserver((entries) => {
    if (document.hidden) return;
    for (const e of entries) {
      const scope = e.target;
      const available = viewportArea(scope.getBoundingClientRect());
      if (available > 0 && visibleArea(scope, null) / available >= 0.6) {
        if (!dwellTimers.has(scope)) {
          dwellTimers.set(scope, setTimeout(() => {
            dwellTimers.delete(scope);
            requestPrefetch(scope);
          }, 400));
        }
      } else {
        clearTimeout(dwellTimers.get(scope));
        dwellTimers.delete(scope);
      }
    }
  }, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });

  // Asks the site for a post's full details (song, full video files). Resolves when answered.
  const detailsWaiters = new Map();
  window.addEventListener('message', (e) => {
    if (!fromPage(e) || e.data?.source !== 'ighd-load-post-result') return;
    const waiters = detailsWaiters.get(e.data.code) || [];
    detailsWaiters.delete(e.data.code);
    for (const w of waiters) w(e.data);
  });
  function loadPostDetails(code) {
    return new Promise((resolve) => {
      const done = (result) => {
        clearTimeout(timer);
        const pending = detailsWaiters.get(code);
        if (pending) {
          const remaining = pending.filter((fn) => fn !== done);
          if (remaining.length) detailsWaiters.set(code, remaining); else detailsWaiters.delete(code);
        }
        resolve(result);
      };
      const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), 10000);
      const list = detailsWaiters.get(code) || [];
      list.push(done);
      detailsWaiters.set(code, list);
      if (list.length === 1) window.postMessage({ source: 'ighd-load-post', code }, location.origin);
    });
  }

  function requestPrefetch(scope) {
    if (document.hidden || !scope.isConnected) return;
    const group = scope.__igtGroup;
    const code = group && codeFor(group);
    if (!code) return songLog('a post without a link to identify it');
    const post = mediaByCode.get(code);
    if (post?.music) return;
    if (post && post.items.every((it) => it.type === 'video')) return; // has its own sound
    if (!post && scope.querySelector('video')) return; // a reel or video: has its own sound
    if (detailsTried.has(code)) return;
    remember(detailsTried, code, null, 2000);
    songLog(`post ${code}: asking for its details`);
    detailsQueue.push({ code, scope });
    if (detailsQueue.length > 5) detailsQueue.shift();
    runPrefetch();
  }

  async function runPrefetch() {
    if (detailsBusy || !detailsQueue.length) return;
    if (document.hidden) { detailsQueue.length = 0; return; }
    const next = detailsQueue.pop();
    if (!next.scope.isConnected || codeFor(next.scope.__igtGroup) !== next.code
      || visibleArea(next.scope, null) <= 0) { runPrefetch(); return; }
    detailsBusy = true;
    await loadPostDetails(next.code); // the post you stopped on most recently first
    setTimeout(() => {
      detailsBusy = false;
      runPrefetch();
    }, 800);
  }

  function watchPost(group) {
    const scope = group.closest('article');
    if (!scope) return;
    const code = codeFor(group);
    const known = musicPosts.get(scope);
    if (code && (!known || known.code !== code || !known.box.isConnected)) {
      const box = mediaBox(scope);
      if (box) {
        if (known) musicVisibility.unobserve?.(known.box);
        musicPosts.set(scope, { code, box });
        observeMusicBox(box);
      }
    }
    scope.__igtGroup = group;
    watchHover(scope);
    if (watchedPosts.has(scope)) return;
    watchedPosts.add(scope);
    prefetchObserver.observe(scope);
  }

  // The box that shows the post's photo (the carousel window for carousels): the highest
  // ancestor of the media on screen that has exactly the size of what is visible.
  function mediaBox(scope) {
    let shown = null;
    let bestArea = 0;
    for (const el of scope.querySelectorAll('img, video')) {
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.height < 150) continue;
      const area = visibleArea(el, scope.parentElement);
      if (area > bestArea) {
        shown = el;
        bestArea = area;
      }
    }
    if (!shown) return null;
    // Visible size of the media, clipped by its ancestors only (not by the screen).
    let { left: x1, top: y1, right: x2, bottom: y2 } = shown.getBoundingClientRect();
    for (let a = shown.parentElement; a && a !== scope; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = a.getBoundingClientRect();
      x1 = Math.max(x1, b.left); y1 = Math.max(y1, b.top);
      x2 = Math.min(x2, b.right); y2 = Math.min(y2, b.bottom);
    }
    const w = x2 - x1;
    const h = y2 - y1;
    let box = null;
    for (let a = shown.parentElement; a && a !== scope; a = a.parentElement) {
      const b = a.getBoundingClientRect();
      if (Math.abs(b.width - w) <= 4 && Math.abs(b.height - h) <= 4) box = a;
      else if (b.width > w + 4 && b.height > h + 4) break;
    }
    return box;
  }

  // Find the identity column by the author's link, rather than site class names or the
  // translated recommendation text. Insert after its first row, before any subtitle.
  function audioHeaderSlot(scope, username) {
    if (!username) return null;
    const media = [...scope.querySelectorAll('img, video')]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.width >= 150 && r.height >= 150);
    if (!media.length) return null;
    const mediaTop = Math.min(...media.map((r) => r.top));
    for (const link of scope.querySelectorAll('a[href]')) {
      let path;
      try { path = new URL(link.getAttribute('href'), location.origin).pathname; } catch (_) { continue; }
      if (path.replace(/\/$/, '').toLowerCase() !== `/${username.toLowerCase()}`
        || !link.textContent.trim() || link.querySelector('img')) continue;
      const line = link.getBoundingClientRect();
      if (!line.width || !line.height || line.bottom > mediaTop + 2) continue;
      let row = link, slot = null;
      while (row.parentElement && row.parentElement !== scope) {
        const parent = row.parentElement;
        const css = getComputedStyle(parent);
        if (css.display === 'contents') { row = parent; continue; }
        const r = parent.getBoundingClientRect();
        if (r.top < line.top - 4 || r.bottom > mediaTop + 2 || parent.querySelector('img, video')) break;
        // Remember the outermost text column, passing through single-link wrappers.
        // A horizontal row holds the username / time; adding a sibling there would split it.
        if (css.display === 'block' || (css.display.includes('flex') && css.flexDirection.startsWith('column'))) {
          slot = { parent, row };
        }
        if (r.bottom > line.bottom + 4 || parent.querySelector('.ighd-audio-details')) break;
        row = parent;
      }
      if (slot) return slot;
    }
    return null;
  }

  function addAudioDetails(group) {
    const scope = group.closest('article') || group.closest('[role="dialog"]');
    if (!scope) return;
    const code = codeFor(group), post = code && mediaByCode.get(code);
    const info = post?.audio || post?.music;
    const name = [info?.title, info?.artist].filter((v) => typeof v === 'string' && v.trim()).join(' · ');
    const existing = scope.querySelector('.ighd-audio-details');
    // Recycled articles must not keep the previous post's credits.
    if (existing && (existing.dataset.code !== code || !name)) existing.remove();
    if (!name) return;
    const slot = audioHeaderSlot(scope, post.username);
    if (!slot) return;
    // The site sometimes provides this row itself. Leave its own audio link in place.
    const native = [...scope.querySelectorAll('a[href*="/reels/audio/"], a[href*="/music/"]')]
      .some((link) => {
        const r = link.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom <= slot.parent.getBoundingClientRect().bottom;
      });
    if (native) { scope.querySelector('.ighd-audio-details')?.remove(); return; }
    const label = scope.querySelector('.ighd-audio-details') || document.createElement('div');
    label.className = 'ighd-audio-details';
    label.dataset.code = code;
    const value = `♪ ${name}`;
    if (label.textContent !== value) label.textContent = value;
    label.title = name;
    if (label.parentElement !== slot.parent || slot.row.nextSibling !== label) {
      slot.parent.insertBefore(label, slot.row.nextSibling);
    }
  }

  function addMusicButton(group) {
    // Feed post, post window, or a post page opened directly.
    const scope = group.closest('article') || group.closest('[role="dialog"]') || group.closest('main');
    if (!scope || scope.querySelector('.ighd-music')) return;
    const code = codeFor(group);
    const post = code && mediaByCode.get(code);
    if (!post?.music) return;
    // Videos and reels already have their own sound.
    if (post.items.every((it) => it.type === 'video')) return;
    const box = mediaBox(scope);
    if (!box) return;
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';

    // Volume slider (shows on hover) + play / pause button, floating on the photo.
    const wrap = document.createElement('div');
    wrap.className = 'ighd-music-wrap';
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.className = 'ighd-vol';
    vol.min = '0';
    vol.max = '1';
    vol.step = '0.05';
    vol.value = String(player.volume);
    vol.setAttribute('aria-label', 'Music volume');
    vol.addEventListener('input', () => setVolume(parseFloat(vol.value)));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ighd-music';
    b.dataset.code = code;
    b.setAttribute('aria-label', "Play or pause this post's music");
    b.innerHTML = MUSIC_ICON;
    b.title = "Play this post's music";
    b.addEventListener('click', () => toggleMusic(b, code));
    // Keep clicks and double-clicks (a double-click would like the post) away from the site.
    for (const type of ['click', 'dblclick', 'mousedown', 'pointerdown', 'touchstart']) {
      wrap.addEventListener(type, (e) => e.stopPropagation());
    }
    wrap.append(vol, b);
    box.appendChild(wrap);

    if (playing?.code === code) playing.button = b;
    refreshMusicIcons();
    observeMusicBox(box);
    watchHover(scope);
    updateFocusPlay();
  }

  function addDownloadButton(group) {
    if (group.querySelector('.ighd-dlpost')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ighd-dlpost';
    b.title = 'Download photo / video';
    b.setAttribute('aria-label', 'Download photo or video');
    b.innerHTML = DL_ICON;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadPost(group);
    });
    group.appendChild(b);
  }

  // Adds the download button to each post's like / comment / share row, and the music button
  // on top of the photo when the post has a song.
  function addPostButtons() {
    for (const scope of watchedPosts) {
      if (scope.isConnected) continue;
      prefetchObserver.unobserve(scope);
      clearTimeout(dwellTimers.get(scope));
      dwellTimers.delete(scope);
      watchedPosts.delete(scope);
      musicPosts.delete(scope);
    }
    for (const box of observedMusicBoxes) {
      if (box.isConnected) continue;
      musicVisibility.unobserve(box);
      observedMusicBoxes.delete(box);
    }
    if (location.pathname.startsWith('/stories/')) return;
    for (const group of postBars()) {
      const scope = group.closest('article');
      if (scope) {
        const r = scope.getBoundingClientRect();
        if (r.bottom < -innerHeight || r.top > innerHeight * 2) continue;
      }
      addDownloadButton(group);
      addAudioDetails(group);
      addMusicButton(group);
      watchPost(group);
    }
  }

  let scanQueued = false;
  function queueScan() {
    if (document.hidden || scanQueued) return;
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      if (document.hidden) return;
      addPostButtons();
    }, 400);
  }
  new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('scroll', queueScan, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) queueScan(); });
  addPostButtons();

  // ---------- Story download ----------

  const mediaByPk = new Map();
  window.addEventListener('message', (e) => {
    if (!fromPage(e) || e.data?.source !== 'ighd-items' || !Array.isArray(e.data.items)) return;
    for (const it of e.data.items) {
      if (typeof it?.pk !== 'string') continue;
      const prev = mediaByPk.get(it.pk);
      if (!prev || itemScore(it) > itemScore(prev)) remember(mediaByPk, it.pk, it);
    }
  });

  // The biggest photo or video currently on screen (the story being shown).
  function visibleStoryMedia() {
    let best = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll('video, img')) {
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.height < 150 || r.bottom < 0 || r.top > innerHeight) continue;
      const area = r.width * r.height;
      if (area > bestArea) {
        best = el;
        bestArea = area;
      }
    }
    return best;
  }

  function currentStory() {
    const m = location.pathname.match(/^\/stories\/([^/]+)\/(\d+)/);
    if (m && m[1] !== 'highlights' && mediaByPk.get(m[2])?.url) return mediaByPk.get(m[2]);

    // Highlights (and anything else): match what is on screen with the data the page loaded.
    const el = visibleStoryMedia();
    if (!el) return null;
    const srcs = [el.currentSrc, el.src, el.poster].filter((u) => /^https:/.test(u || ''));
    const keys = srcKeys(el);
    for (const it of mediaByPk.values()) {
      if (keys.has(fileKey(it.url)) || keys.has(fileKey(it.thumb))) return it;
    }
    // Not in the data, but the element itself points to a real file.
    if (srcs[0]) {
      return { type: el.tagName === 'VIDEO' ? 'video' : 'image', url: srcs[0], pk: m?.[2] || 'story', username: m?.[1] || '' };
    }
    return null;
  }

  async function downloadStory(e) {
    e.preventDefault();
    e.stopPropagation();
    const it = currentStory();
    if (!it?.url) {
      toast(it ? 'This story video is only available as a stream and cannot be downloaded.'
        : 'Story not loaded yet. Wait a moment and try again.');
      return;
    }
    const user = it.username || location.pathname.split('/')[2] || 'story';
    const ok = await downloadMedia(it, `${user}_story_${it.pk}.${extFrom(it.url, it.type)}`, true);
    toast(ok ? 'Story downloaded ✓' : 'Download failed');
  }

  // Inside the story viewer, next to its like / share icons.
  function addStoryButton() {
    if (!location.pathname.startsWith('/stories/')) return false;
    for (const svg of document.querySelectorAll('svg[aria-label]')) {
      if (!LIKE_LABEL.test(svg.getAttribute('aria-label').trim())) continue;
      const r = svg.getBoundingClientRect();
      if (!r.width) continue;
      let group = svg.parentElement;
      for (let i = 0; i < 6 && group; i++) {
        if (group.querySelectorAll('svg[aria-label]').length >= 2) break;
        group = group.parentElement;
      }
      if (!group) continue;
      if (group.querySelector('.ighd-dlstory')) return true;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ighd-dlpost ighd-dlstory';
      b.title = 'Download this story';
      b.setAttribute('aria-label', 'Download this story');
      b.innerHTML = DL_ICON;
      b.addEventListener('click', downloadStory);
      group.appendChild(b);
      return true;
    }
    return false;
  }

  // Floating fallback (for example on your own stories, which have no like button).
  const storyBtn = document.createElement('button');
  storyBtn.id = 'ighd-story-btn';
  storyBtn.type = 'button';
  storyBtn.title = 'Download this story';
  storyBtn.innerHTML = `${DL_ICON}<span>Download story</span>`;
  storyBtn.addEventListener('click', downloadStory);

  // The story viewer may sit in the browser's top layer (an open <dialog>), above any z-index.
  function storyHost() {
    return document.querySelector('dialog[open]') || document.body;
  }

  // ---------- Chat themes ----------
  // The open conversation's theme, from the site's own conversation data: its background, and
  // bubble / text colors set through the site's own color variables.

  const chatThemes = new Map();
  window.addEventListener('message', (e) => {
    if (!fromPage(e) || e.data?.source !== 'ighd-themes' || !Array.isArray(e.data.themes)) return;
    for (const t of e.data.themes) {
      if (typeof t?.thread !== 'string' || !/^\d{5,32}$/.test(t.thread)) continue;
      const variants = Array.isArray(t.theme?.variants) ? t.theme.variants.filter((v) => v && typeof v === 'object') : [];
      remember(chatThemes, t.thread, variants.length ? variants : null, 200);
    }
    updateChatTheme();
  });
  // Themes that arrived before this script started.
  window.postMessage({ source: 'ighd-themes-request' }, location.origin);

  // The site sends colors as ARGB hex ("FF892320").
  const argbCss = (v) => typeof v === 'string' && /^[0-9A-F]{8}$/i.test(v) ? `#${v.slice(2)}${v.slice(0, 2)}` : null;
  const argbRgb = (v) => argbCss(v) && [2, 4, 6].map((i) => parseInt(v.slice(i, i + 2), 16)).join(', ');
  const themeImage = (u) => {
    try {
      const url = new URL(u);
      return url.protocol === 'https:' && /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)
        && !/["'()\\\s]/.test(u) ? u : null;
    } catch (_) { return null; }
  };

  const themeStyle = document.createElement('style');
  themeStyle.id = 'ighd-chat-theme';
  const bubbleClasses = { out: null, in: null };
  let themed = null;

  // Changes an inline style for the theme, remembering the site's value to put it back.
  function setThemeStyle(el, prop, value) {
    if (!themed.restore.some((r) => r.el === el && r.prop === prop)) themed.restore.push({ el, prop, value: el.style[prop] });
    el.style[prop] = value;
  }

  function themeVars(v) {
    const out = v.gradient_colors?.[0], inc = v.incoming_message_bubble_color;
    return {
      '--chat-outgoing-message-bubble-background-color': argbCss(out),
      '--ig-outgoing-message-bubble': argbRgb(out),
      '--chat-incoming-message-bubble-background-color': argbCss(inc),
      '--ig-incoming-message-bubble': argbRgb(inc)
    };
  }

  function clearChatTheme() {
    if (!themed) return;
    for (const name of Object.keys(themeVars({}))) themed.root.style.removeProperty(name);
    delete themed.root.dataset.ighdTheme;
    for (const r of themed.restore) r.el.style[r.prop] = r.value;
    themeStyle.remove();
    themed = null;
  }

  // The conversation pane (around the message box), its message list (the tallest scrolling area)
  // and the composer's painted layers, innermost first: the rounded input, then the bar around it.
  function chatParts() {
    const box = document.querySelector('main [role="textbox"], [role="main"] [role="textbox"]');
    if (!box) return null;
    let root = box;
    while (root.parentElement && root.getBoundingClientRect().height < innerHeight * 0.5) root = root.parentElement;
    let list = null, best = 0;
    for (const el of root.querySelectorAll('div')) {
      if (el.clientHeight <= best || el.scrollHeight <= el.clientHeight) continue;
      if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
      list = el; best = el.clientHeight;
    }
    if (!list) return null;
    const layers = [];
    for (let e = box.parentElement; e && e !== root; e = e.parentElement) {
      if (getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)') layers.push(e);
    }
    return { root, list, box, layers };
  }

  // Text colors have no variable: find the site's class that paints each bubble color, by giving
  // that class to a test element. Class names stay valid for the page's current stylesheets.
  function findBubbleClasses(list, vars) {
    const probe = document.createElement('div');
    list.appendChild(probe);
    const wanted = {};
    for (const side of missingBubbleClasses(vars)) {
      probe.style.backgroundColor = vars[BUBBLE_VARS[side]];
      wanted[side] = getComputedStyle(probe).backgroundColor;
    }
    probe.style.backgroundColor = '';
    for (const el of list.querySelectorAll('div')) {
      if (el === probe || el.offsetHeight < 20 || !el.textContent.trim()) continue;
      const bg = getComputedStyle(el).backgroundColor;
      const side = Object.keys(wanted).find((k) => !bubbleClasses[k] && wanted[k] === bg);
      if (!side) continue;
      for (const c of el.classList) {
        if (!/^[\w-]+$/.test(c)) continue;
        probe.className = c;
        if (getComputedStyle(probe).backgroundColor === bg) { bubbleClasses[side] = c; break; }
      }
      if (!missingBubbleClasses(vars).length) break;
    }
    probe.remove();
  }
  const BUBBLE_VARS = {
    out: '--chat-outgoing-message-bubble-background-color',
    in: '--chat-incoming-message-bubble-background-color'
  };
  const missingBubbleClasses = (vars) => ['out', 'in'].filter((side) => !bubbleClasses[side] && vars[BUBBLE_VARS[side]]);

  function themeCss(v) {
    const rules = [];
    const text = { out: argbCss(v.outbound_message_text_color), in: argbCss(v.inbound_message_text_color) };
    for (const side of ['out', 'in']) {
      const c = bubbleClasses[side];
      if (!c) continue;
      // Bubbles carry a thick outline in the page's background color (it shapes grouped corners);
      // over a theme background it shows as a dark box around each message.
      rules.push(`[data-ighd-theme] .${c} { outline-color: transparent !important; }`);
      if (text[side]) rules.push(`[data-ighd-theme] .${c}, [data-ighd-theme] .${c} * { color: ${text[side]} !important; }`);
    }
    const stops = (v.gradient_colors || []).map(argbCss).filter(Boolean);
    if (bubbleClasses.out && stops.length > 1) {
      rules.push(`[data-ighd-theme] .${bubbleClasses.out} { background-image: linear-gradient(${stops.join(', ')}) !important; }`);
    }
    return rules.join('\n');
  }

  function updateChatTheme() {
    const id = location.pathname.match(/^\/direct\/t\/(\d{5,32})/)?.[1];
    const variants = id && chatThemes.get(id);
    if (!variants) { clearChatTheme(); return; }
    const html = document.documentElement;
    const dark = html.classList.contains('__fb-dark-mode') || /dark/.test(getComputedStyle(html).colorScheme);
    const v = variants.find((x) => x.mode === (dark ? 'dark' : 'light')) || variants[0];
    const key = `${id}:${v.mode}`;
    const stale = themed && [themed.root, themed.list, themed.box, ...themed.layers].some((el) => !el.isConnected);
    if (themed && (themed.key !== key || stale)) clearChatTheme();
    if (!themed) {
      const parts = chatParts();
      if (!parts) return;
      themed = { key, ...parts, restore: [], divs: -1 };
      const vars = themeVars(v);
      for (const [name, value] of Object.entries(vars)) if (value) themed.root.style.setProperty(name, value);
      themed.root.dataset.ighdTheme = '';
      // The background covers the whole pane, behind the messages and the message box.
      const image = themeImage(v.background || '');
      const color = argbCss(v.thread_background_color);
      if (color) setThemeStyle(themed.root, 'backgroundColor', color);
      if (image) {
        setThemeStyle(themed.root, 'backgroundImage', `url("${image}")`);
        setThemeStyle(themed.root, 'backgroundSize', 'cover');
        setThemeStyle(themed.root, 'backgroundPosition', 'center');
      }
      // The composer bar would otherwise remain a band of page color under the messages.
      const [input, ...bars] = themed.layers;
      const inputColor = argbCss(v.composer_input_background_color);
      if (input && inputColor) setThemeStyle(input, 'backgroundColor', inputColor);
      for (const bar of bars) setThemeStyle(bar, 'backgroundColor', 'transparent');
    }
    // Bubbles render after the pane; look again only when the list's content changed.
    const vars = themeVars(v);
    if (missingBubbleClasses(vars).length) {
      const count = themed.list.getElementsByTagName('div').length;
      if (count !== themed.divs) { themed.divs = count; findBubbleClasses(themed.list, vars); }
    }
    const css = themeCss(v);
    if (themeStyle.textContent !== css) themeStyle.textContent = css;
    if (!themeStyle.isConnected) document.head.appendChild(themeStyle);
  }

  // ---------- "Follows you" label ----------

  const followBadge = document.createElement('span');
  followBadge.className = 'ighd-follow-badge';

  function viewerId() {
    const m = document.cookie.match(/(?:^|;\s*)ds_user_id=(\d+)/);
    return m ? m[1] : '';
  }

  // Next to the username at the top of a profile. Nothing is shown on your own profile or
  // when the page has not provided the relationship.
  function updateFollowBadge() {
    const user = getUsername()?.toLowerCase();
    const info = user && friendships.get(user);
    const own = info && info.pk && info.pk === viewerId();
    const named = (el) => el.textContent.trim().toLowerCase() === user
      || [...el.querySelectorAll('span')].some((s) => s.textContent.trim().toLowerCase() === user);
    const heading = info && !own
      && [...document.querySelectorAll('main header h1, main header h2')].find(named);
    if (!heading) { followBadge.remove(); return; }
    // Step out of single-child wrappers (link, row) so the label sits beside the name.
    let anchor = heading;
    for (let i = 0; i < 4; i++) {
      const parent = anchor.parentElement;
      if (!parent || parent.tagName === 'HEADER' || parent.children.length !== 1) break;
      anchor = parent;
    }
    const text = info.followedBy ? 'Follows you' : "Doesn't follow you";
    if (followBadge.textContent !== text) followBadge.textContent = text;
    followBadge.dataset.follows = String(info.followedBy);
    if (anchor.nextSibling !== followBadge) anchor.after(followBadge);
  }

  // ---------- Non-followers scan ----------
  // Only on your own profile. The panel explains the risk first; only its Start button (a real
  // click) asks intercept.js to read your lists. Results stay in this tab's memory; only the
  // whitelist and the verified filter are saved (extension storage).

  let viewer = null;
  const nf = { id: null, state: 'idle', note: '', progress: null, result: null };
  const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
  const fmt = (n) => n.toLocaleString('en-US');
  const NF_PAGE = 12;

  window.addEventListener('message', (e) => {
    if (!fromPage(e)) return;
    const d = e.data;
    if (d?.source === 'ighd-viewer' && typeof d.username === 'string') {
      viewer = { username: d.username.toLowerCase(), followers: count(d.followers), following: count(d.following) };
      updateNfButton();
    } else if (d?.source === 'ighd-nf' && nf.id && d.id === nf.id) {
      onScanMessage(d);
    }
  });
  window.postMessage({ source: 'ighd-viewer-request' }, location.origin);

  const nfBtn = document.createElement('button');
  nfBtn.id = 'ighd-nf-btn';
  nfBtn.type = 'button';
  nfBtn.textContent = 'Scan non-followers';
  nfBtn.addEventListener('click', () => { nfPanel.isConnected ? nfPanel.remove() : openNfPanel(); });

  const nfPanel = document.createElement('div');
  nfPanel.id = 'ighd-nf';
  nfPanel.setAttribute('role', 'dialog');
  nfPanel.setAttribute('aria-label', 'Non-followers scan');

  // Whitelist (accounts you follow on purpose even if they don't follow back) and the "show
  // verified accounts" choice (off by default: verified accounts are left out). Saved in the extension's own storage, which instagram.com cannot
  // read, and never sent anywhere. Keyed by pk, so a renamed account stays whitelisted.
  const NF_KEYS = ['nfWhitelist', 'nfShowVerified'];
  const NF_WHITELIST_MAX = 5000;
  const whitelist = new Map();
  let showVerified = false;

  function loadNfPrefs() {
    try {
      chrome.storage.local.get(NF_KEYS, (data) => {
        whitelist.clear();
        const saved = data?.nfWhitelist;
        if (saved && typeof saved === 'object') {
          for (const [pk, name] of Object.entries(saved)) {
            if (whitelist.size >= NF_WHITELIST_MAX) break;
            if (/^\d{1,32}$/.test(pk) && typeof name === 'string' && /^[a-z0-9._]{1,30}$/.test(name)) whitelist.set(pk, name);
          }
        }
        showVerified = data?.nfShowVerified === true;
        renderNf();
      });
    } catch (_) {} // The extension was reloaded; this page keeps its last values.
  }
  function saveNfPrefs() {
    try {
      chrome.storage.local.set({ nfWhitelist: Object.fromEntries(whitelist), nfShowVerified: showVerified });
    } catch (_) {}
  }
  loadNfPrefs();
  try {
    // Changes made in another Instagram tab.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && NF_KEYS.some((k) => k in changes)) loadNfPrefs();
    });
  } catch (_) {}

  function toggleWhitelist(u) {
    if (whitelist.has(u.pk)) whitelist.delete(u.pk);
    else if (whitelist.size < NF_WHITELIST_MAX) whitelist.set(u.pk, u.username);
    else toast(`The whitelist holds up to ${fmt(NF_WHITELIST_MAX)} accounts`);
    saveNfPrefs();
    renderNf();
  }

  // The result list without whitelisted accounts and, unless you show them, verified ones.
  const nfShown = () => (nf.result?.users || []).filter((u) => !whitelist.has(u.pk) && (showVerified || !u.isVerified));
  const whitelistButton = () => h('button', { type: 'button', text: `Whitelist (${fmt(whitelist.size)})`,
    on: () => { nf.view = 'whitelist'; renderNf(); } });
  // A toggle chip; the same choice before a scan (next to Start scan) and on its results.
  function verifiedToggle() {
    const box = h('input', { type: 'checkbox' });
    box.checked = showVerified;
    box.addEventListener('change', () => { showVerified = box.checked; saveNfPrefs(); renderNf(); });
    return h('label', { class: 'ighd-nf-chip' }, box, h('span', { text: 'Show verified accounts' }));
  }

  const onOwnProfile = () => !!viewer && getUsername()?.toLowerCase() === viewer.username;
  // A started scan keeps running while you browse elsewhere in this tab (a page reload ends it);
  // the button then stays visible to show progress, and until you open a finished result.
  const nfVisible = () => onOwnProfile() || nf.state === 'running' || (nf.state === 'done' && !nf.seen)
    || nfPanel.isConnected;

  function updateNfButton() {
    if (nfVisible()) {
      if (!nfBtn.isConnected) document.body.appendChild(nfBtn);
      return;
    }
    nfBtn.remove();
    nfPanel.remove();
  }

  function openNfPanel() {
    if (!nfVisible()) return;
    document.body.appendChild(nfPanel);
    renderNf();
  }

  function startNfScan(e) {
    if (!e?.isTrusted || nf.state === 'running' || !onOwnProfile()) return;
    nf.id = crypto.randomUUID();
    nf.state = 'running';
    nf.note = '';
    nf.result = null;
    nf.seen = false;
    nf.view = 'results';
    nf.progress = { list: 'followers', followers: 0, following: 0,
      totals: { followers: viewer.followers, following: viewer.following } };
    renderNf();
    window.postMessage({ source: 'ighd-nf-start', id: nf.id }, location.origin);
  }

  function cancelNfScan(note = 'Scan cancelled.') {
    if (nf.id) window.postMessage({ source: 'ighd-nf-cancel', id: nf.id }, location.origin);
    nf.id = null;
    nf.state = 'idle';
    nf.note = note;
    renderNf();
  }

  const NF_REASONS = {
    'rate-limit': 'Instagram answered "too many requests" (HTTP 429).',
    blocked: 'Instagram reported a block or a verification request. Use Instagram normally and resolve any notice first.',
    network: 'A request failed or took too long.',
    error: 'Instagram sent an unexpected answer.',
    cooldown: 'IG Tools is waiting after an earlier Instagram limit.',
    limited: 'Instagram limits these lists for your account, so a full comparison is not possible.',
    limit: 'The scan reached its safety limit of pages.',
    'too-large': 'Your lists are larger than the safety limit of this scan, so it did not start.',
    'not-own-profile': 'Open your own profile to scan.',
    'no-click': 'The scan only starts right after you press Start.'
  };

  function onScanMessage(d) {
    if (d.state === 'running') {
      nf.progress = { list: d.list, followers: count(d.followers) || 0, following: count(d.following) || 0,
        totals: nf.progress?.totals || {} };
    } else if (d.state === 'done' && Array.isArray(d.users)) {
      nf.id = null;
      nf.state = 'done';
      nf.result = { users: d.users.filter((u) => typeof u?.username === 'string' && /^[a-z0-9._]{1,30}$/.test(u.username)),
        followers: count(d.followers) || 0, following: count(d.following) || 0, totals: nf.progress?.totals || {} };
    } else if (['stopped', 'refused', 'cancelled'].includes(d.state)) {
      nf.id = null;
      nf.state = 'idle';
      const retry = Number.isFinite(d.retryAt) && d.retryAt > Date.now()
        ? ` Try again after ${new Date(d.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
        : d.state === 'cancelled' ? '' : ' There is no automatic retry.';
      const partial = d.state === 'stopped' && d.pages ? ` Read ${fmt(count(d.followers) || 0)} followers and ${fmt(count(d.following) || 0)} following before stopping.` : '';
      nf.note = (d.state === 'cancelled' ? 'Scan cancelled.' : `Scan stopped. ${NF_REASONS[d.reason] || 'Unknown error.'}`) + partial + retry;
      if (!nfPanel.isConnected && d.state === 'stopped') toast(nf.note, 8000);
    }
    if (nf.state === 'done' && !nfPanel.isConnected) toast('Non-followers scan finished. Click the button to see the results.', 6000);
    renderNf();
    updateNfButton();
  }

  // Builds an element; text is always set as text, never as HTML.
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') el.textContent = v;
      else if (k === 'on') el.addEventListener('click', v);
      else el.setAttribute(k, v);
    }
    el.append(...kids.filter(Boolean));
    return el;
  }

  function renderNf() {
    if (nf.state === 'done' && nfPanel.isConnected) nf.seen = true;
    const p = nf.progress, total = (p?.totals.followers ?? NaN) + (p?.totals.following ?? NaN);
    nfBtn.textContent = nf.state !== 'running' ? (nf.state === 'done' && !nf.seen ? 'Non-followers ready' : 'Scan non-followers')
      : total > 0 ? `Scanning… ${Math.min(99, Math.floor((p.followers + p.following) / total * 100))}%` : 'Scanning…';
    if (!nfPanel.isConnected) return;
    const close = h('button', { type: 'button', class: 'ighd-nf-close', 'aria-label': 'Close', text: '✕', on: () => nfPanel.remove() });
    const body = [];
    const actions = [];
    if (nf.state === 'running') {
      const p = nf.progress;
      const line = (label, n, total) => h('div', { class: 'ighd-nf-progress',
        text: `${label} ${fmt(n)}${total != null ? ` / ${fmt(total)}` : ''}` });
      body.push(h('p', { text: 'Reading your lists, one page every 2–4 seconds. You can keep using Instagram in this '
          + 'tab; reloading or closing it stops the scan.' }),
        line('Followers', p.followers, p.totals.followers), line('Following', p.following, p.totals.following));
      actions.push(h('button', { type: 'button', text: 'Cancel', on: () => cancelNfScan() }));
    } else if (nf.view === 'whitelist') {
      body.push(h('p', { class: 'ighd-nf-meta', text: 'Whitelisted accounts are never listed as non-followers. '
        + 'The whitelist is saved in the extension on this computer.' }));
      const list = h('ul', { class: 'ighd-nf-list' });
      for (const [pk, username] of whitelist) {
        list.append(h('li', {}, h('a', { href: `/${username}/`, target: '_blank', rel: 'noopener' }, h('strong', { text: `@${username}` })),
          h('button', { type: 'button', class: 'ighd-nf-row-btn', text: 'Remove', 'aria-label': `Remove @${username} from the whitelist`,
            on: () => toggleWhitelist({ pk, username }) })));
      }
      body.push(whitelist.size ? list : h('p', { text: 'No accounts yet. After a scan, press Keep next to an account '
        + 'you follow on purpose; it will not be listed again.' }));
      actions.push(h('button', { type: 'button', text: 'Back', on: () => { nf.view = 'results'; renderNf(); } }));
    } else if (nf.state === 'done') {
      const r = nf.result, shown = nfShown();
      const kept = r.users.filter((u) => whitelist.has(u.pk)).length;
      const verified = showVerified ? 0 : r.users.filter((u) => u.isVerified && !whitelist.has(u.pk)).length;
      body.push(h('p', { class: 'ighd-nf-summary', text: shown.length === 1
        ? "1 account you follow doesn't follow you back."
        : `${fmt(shown.length)} accounts you follow don't follow you back.` }));
      if (kept || verified) {
        body.push(h('p', { class: 'ighd-nf-meta', text: `Not shown: ${[kept && `${fmt(kept)} whitelisted`,
          verified && `${fmt(verified)} verified`].filter(Boolean).join(', ')}.` }));
      }
      if ((r.totals.followers != null && r.followers < r.totals.followers) || (r.totals.following != null && r.following < r.totals.following)) {
        body.push(h('p', { class: 'ighd-nf-note', text: `Instagram returned ${fmt(r.followers)} followers and ${fmt(r.following)} following `
          + 'out of the totals on your profile (hidden or deactivated accounts), so a few results may be wrong.' }));
      }
      body.push(verifiedToggle());
      const list = h('ul', { class: 'ighd-nf-list' });
      for (const u of shown) {
        const pic = typeof u.pic === 'string' && /^https:\/\/[^/]*(cdninstagram\.com|fbcdn\.net)\//.test(u.pic)
          ? h('img', { src: u.pic, alt: '', loading: 'lazy' }) : h('span', { class: 'ighd-nf-nopic' });
        list.append(h('li', {}, pic, h('a', { href: `/${u.username}/`, target: '_blank', rel: 'noopener' },
          h('strong', { text: `@${u.username}` }, u.isVerified ? h('span', { class: 'ighd-nf-badge', text: 'Verified' }) : null),
          u.fullName ? h('span', { text: String(u.fullName).slice(0, 100) }) : null),
        h('button', { type: 'button', class: 'ighd-nf-row-btn', text: 'Keep', title: 'Add to the whitelist: never list this account again',
          'aria-label': `Keep @${u.username}: add to the whitelist`, on: () => toggleWhitelist(u) })));
      }
      body.push(list);
      actions.push(h('button', { type: 'button', class: 'ighd-nf-primary', text: 'Export CSV', on: exportNfCsv }), whitelistButton(),
        onOwnProfile() && h('button', { type: 'button', text: 'New scan', on: () => { nf.state = 'idle'; nf.note = ''; renderNf(); } }));
    } else {
      const pages = Math.ceil((viewer?.followers || 0) / NF_PAGE) + Math.ceil((viewer?.following || 0) / NF_PAGE);
      const time = viewer?.followers != null && viewer?.following != null
        ? ` For your ${fmt(viewer.followers)} followers and ${fmt(viewer.following)} following that is about ${fmt(pages)} requests and ${Math.max(1, Math.round(pages * 3.3 / 60))} min.`
        : '';
      if (nf.note) body.push(h('p', { class: 'ighd-nf-note', role: 'status', text: nf.note }));
      body.push(h('p', { text: 'Lists the accounts you follow that do not follow you back. IG Tools reads your Followers and '
          + 'Following lists with the same requests Instagram’s website makes when you scroll them: 12 accounts per request, '
          + `one request every 2–4 seconds.${time}` }),
        h('p', { class: 'ighd-nf-warn', text: 'Instagram may limit or block accounts for automated activity. Use this rarely. '
          + 'The scan stops at the first limit or error and never retries by itself.' }),
        h('p', { class: 'ighd-nf-meta', text: 'Results stay in this tab only. Your whitelist and filter are saved in the '
          + 'extension on this computer. Nothing is sent anywhere.' }));
      actions.push(whitelistButton(), verifiedToggle(),
        onOwnProfile() ? h('button', { type: 'button', class: 'ighd-nf-primary', text: 'Start scan', on: startNfScan })
          : h('span', { class: 'ighd-nf-meta', text: 'Open your profile to start a scan.' }));
    }
    nfPanel.replaceChildren(
      h('div', { class: 'ighd-nf-head' }, h('strong', { text: 'Non-followers' }), close),
      h('div', { class: 'ighd-nf-body' }, ...body),
      h('div', { class: 'ighd-nf-actions' }, ...actions.filter(Boolean)));
  }

  // CSV cells are quoted; a leading = + - @ is neutralized so spreadsheets do not run formulas.
  function nfCsv(users) {
    const cell = (v) => {
      let t = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
      return `"${t.replace(/"/g, '""')}"`;
    };
    const rows = [['pk', 'username', 'full_name', 'profile_url', 'is_private', 'is_verified'],
      ...users.map((u) => [u.pk, u.username, u.fullName, `https://www.instagram.com/${u.username}/`, !!u.isPrivate, !!u.isVerified])];
    return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  }

  async function exportNfCsv() {
    if (!nf.result) return;
    const date = new Date().toISOString().slice(0, 10);
    const ok = await download(`data:text/csv;charset=utf-8,${encodeURIComponent(nfCsv(nfShown()))}`,
      `${viewer?.username || 'instagram'}_non-followers_${date}.csv`);
    toast(ok ? 'CSV saved to your downloads' : 'Could not save the CSV');
  }

  // The site is a single-page app: watch URL changes to show/hide the buttons.
  let lastPath = null;
  function sync() {
    if (document.hidden) return;
    const inStory = location.pathname.startsWith('/stories/');
    if (inStory && !addStoryButton()) {
      const host = storyHost();
      if (storyBtn.parentElement !== host) host.appendChild(storyBtn);
    } else if (storyBtn.isConnected) {
      storyBtn.remove();
    }
    updateFollowBadge();
    updateChatTheme();
    updateNfButton();
    if (location.pathname === lastPath && (btn.isConnected || !getUsername())) return;
    lastPath = location.pathname;
    if (getUsername()) {
      if (!btn.isConnected) document.body.appendChild(btn);
    } else {
      btn.remove();
      closeViewer();
    }
  }

  sync();
  setInterval(sync, 600);
  window.addEventListener('popstate', sync);
})();
