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

  // ---------- Data ----------
  // This extension never sends requests of its own to Instagram. It only reads the
  // profile picture URLs that the page already received while you browse (see intercept.js).

  const seen = new Map();
  let interceptStats = null;

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.source === 'ighd-stats') {
      interceptStats = e.data;
      return;
    }
    if (e.data?.source !== 'ighd-pics' || !Array.isArray(e.data.pics)) return;
    for (const p of e.data.pics) {
      if (typeof p?.username !== 'string' || typeof p.url !== 'string') continue;
      const prev = seen.get(p.username);
      if (!prev || p.hd || !prev.hd) seen.set(p.username, { url: p.url, hd: !!p.hd });
    }
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
    if (e.source !== window || e.data?.source !== 'ighd-media' || !Array.isArray(e.data.media)) return;
    for (const m of e.data.media) {
      if (typeof m?.code !== 'string' || !Array.isArray(m.items)) continue;
      mediaByCode.set(m.code, mergePost(mediaByCode.get(m.code), m));
    }
  });

  // A real video file beats a still image, which beats nothing.
  const itemScore = (it) => (!it?.url ? 0 : it.type === 'video' ? 2 : 1);

  // The same post can arrive several times with different detail: keep the best of each item,
  // and never let a thumbnail replace a video.
  function mergePost(prev, next) {
    if (!prev) return next;
    if (prev.items.length !== next.items.length) {
      const total = (p) => p.items.reduce((s, it) => s + itemScore(it), 0);
      return total(next) >= total(prev) ? next : prev;
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
    return { ...prev, username: prev.username || next.username, items };
  }

  const POST_PATH = /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/;
  // aria-label of the "like" icon in the most common interface languages.
  const LIKE_LABEL = /^(like|unlike|me gusta|ya no me gusta|curtir|descurtir|j[’']aime|je n[’']aime plus|gefällt mir|gefällt mir nicht mehr|mi piace|non mi piace più)$/i;

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
  function toast(text) {
    let el = document.getElementById('ighd-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ighd-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
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

  // Videos go through mp4fix.js first, which repairs 1 fps "photo + music" stories so the
  // picture shows right away. Anything else (or if reading the file fails) downloads as is.
  async function downloadMedia(it, filename) {
    if (it.type === 'video' && typeof globalThis.igtFixLowFpsMp4 === 'function') {
      try {
        const res = await fetch(it.url);
        if (res.ok) {
          const fixed = globalThis.igtFixLowFpsMp4(await res.arrayBuffer());
          if (fixed) return download(await toDataUrl(fixed, 'video/mp4'), filename);
        }
      } catch (_) {}
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
  function visibleArea(el, stop) {
    const r = el.getBoundingClientRect();
    let [x1, y1, x2, y2] = [r.left, r.top, r.right, r.bottom];
    const clip = (b) => {
      x1 = Math.max(x1, b.left); y1 = Math.max(y1, b.top);
      x2 = Math.min(x2, b.right); y2 = Math.min(y2, b.bottom);
    };
    clip({ left: 0, top: 0, right: innerWidth, bottom: innerHeight });
    for (let a = el.parentElement; a && a !== stop; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') clip(a.getBoundingClientRect());
      if (x2 <= x1 || y2 <= y1) return 0;
    }
    return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
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
    const post = mediaByCode.get(code);
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

  // Finds each like / comment / share row and adds a download button at its end.
  function addPostButtons() {
    if (location.pathname.startsWith('/stories/')) return;
    for (const svg of document.querySelectorAll('svg[aria-label]')) {
      if (!LIKE_LABEL.test(svg.getAttribute('aria-label').trim())) continue;
      let group = svg.parentElement;
      for (let i = 0; i < 8 && group; i++) {
        if (group.querySelectorAll('svg[aria-label]').length >= 3) break;
        group = group.parentElement;
      }
      if (!group || group.dataset.ighdDl || group.querySelector('.ighd-dlpost')) continue;
      group.dataset.ighdDl = '1';
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
  }

  let scanQueued = false;
  new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      addPostButtons();
    }, 400);
  }).observe(document.body, { childList: true, subtree: true });
  addPostButtons();

  // ---------- Story download ----------

  const mediaByPk = new Map();
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'ighd-items' || !Array.isArray(e.data.items)) return;
    for (const it of e.data.items) {
      if (typeof it?.pk !== 'string') continue;
      const prev = mediaByPk.get(it.pk);
      if (!prev || itemScore(it) > itemScore(prev)) mediaByPk.set(it.pk, it);
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
    const ok = await downloadMedia(it, `${user}_story_${it.pk}.${extFrom(it.url, it.type)}`);
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

  // The site is a single-page app: watch URL changes to show/hide the buttons.
  let lastPath = null;
  function sync() {
    const inStory = location.pathname.startsWith('/stories/');
    if (inStory && !addStoryButton()) {
      const host = storyHost();
      if (storyBtn.parentElement !== host) host.appendChild(storyBtn);
    } else if (storyBtn.isConnected) {
      storyBtn.remove();
    }
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
