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
        out.push({ username: node.username.toLowerCase(), url, hd: !!hd });
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

  function handleText(text) {
    if (typeof text !== 'string') return;
    stats.responses++;
    if (!text.includes('profile_pic_url')) return;
    stats.withPics++;
    const out = [];
    for (const obj of parseAll(text)) collect(obj, out, 0);
    publish(out);
  }

  function handleObject(obj) {
    stats.responses++;
    const out = [];
    collect(obj, out, 0);
    publish(out);
  }

  function publish(pics) {
    for (const p of pics) stats.users.add(p.username);
    if (pics.length) window.postMessage({ source: 'ighd-pics', pics }, location.origin);
  }

  // Data embedded in the HTML on page load.
  function scanEmbedded() {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      handleText(s.textContent);
    }
  }

  // When logged in, profile data is loaded from /api/graphql (no trailing slash).
  const interesting = (url) => /graphql|\/api\/|\/ajax\//.test(String(url));

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const a = args[0];
      const url = a instanceof Request ? a.url : String(a);
      if (interesting(url)) res.clone().text().then(handleText, () => {});
    } catch (_) {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (interesting(url)) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') handleText(this.responseText);
          else if (this.responseType === 'json') handleObject(this.response);
        } catch (_) {}
      });
    }
    return origOpen.call(this, method, url, ...rest);
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'ighd-scan') return;
    scanEmbedded();
    window.postMessage({
      source: 'ighd-stats',
      responses: stats.responses,
      withPics: stats.withPics,
      users: stats.users.size
    }, location.origin);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanEmbedded);
  } else {
    scanEmbedded();
  }
})();
