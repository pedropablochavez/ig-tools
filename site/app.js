(() => {
  'use strict';
  const config = window.IG_TOOLS || {};
  for (const node of document.querySelectorAll('[data-version]')) node.textContent = `v${config.version || '2.4.0'}`;
  if (config.zipBytes) for (const node of document.querySelectorAll('[data-zip-size]')) node.textContent = `${new Intl.NumberFormat('en').format(Math.ceil(config.zipBytes / 1024))} KB ZIP`;
  // Browser detection is local; this script sends no telemetry or network requests.
  const addresses = { brave: 'brave://extensions', chrome: 'chrome://extensions', edge: 'edge://extensions' };
  const chooseBrowser = (browser) => {
    document.getElementById('extensions-address').textContent = addresses[browser];
    for (const button of document.querySelectorAll('[data-browser]')) button.setAttribute('aria-pressed', String(button.dataset.browser === browser));
    document.querySelector('.copy-status').textContent = '';
  };
  const setUrlState = (key, value) => {
    const url = new URL(location.href);
    url.searchParams.set(key, value);
    history.replaceState(null, '', url);
  };
  for (const button of document.querySelectorAll('[data-browser]')) button.addEventListener('click', () => {
    chooseBrowser(button.dataset.browser);
    setUrlState('browser', button.dataset.browser);
  });
  const requestedBrowser = new URL(location.href).searchParams.get('browser');
  if (Object.hasOwn(addresses, requestedBrowser)) chooseBrowser(requestedBrowser);
  else if (/Edg\//.test(navigator.userAgent)) chooseBrowser('edge');
  else if (!navigator.brave && /Chrome\//.test(navigator.userAgent)) chooseBrowser('chrome');
  document.getElementById('copy-address').addEventListener('click', async () => {
    const value = document.getElementById('extensions-address').textContent;
    try { await navigator.clipboard.writeText(value); document.querySelector('.copy-status').textContent = 'Copied. Paste it into your address bar.'; }
    catch (_) { document.querySelector('.copy-status').textContent = `Copy ${value} and paste it into your address bar.`; }
  });
  const store = config.chromeWebStoreUrl;
  if (typeof store === 'string' && /^https:\/\/chromewebstore\.google\.com\/detail\/(?:[^/]+\/)?[a-p]{32}$/.test(store)) {
    for (const link of document.querySelectorAll('[data-install-link]')) {
      link.href = store;
      link.removeAttribute('download');
      link.textContent = 'Install from Chrome Web Store ↗';
    }
    document.querySelector('[data-install-note]').textContent = `Brave & Chrome · v${config.version} · Confirm installation in your browser`;
    document.getElementById('install-method').textContent = 'Install through the store and confirm the browser prompt. The manual method below is optional.';
  }
  if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) document.querySelector('.mobile-note').hidden = false;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const previews = {
    feed: { src: 'assets/feed-demo.png', alt: 'Bundled extension demo: photo-post music controls and a download button.', text: 'Photo-post music preview.' },
    profile: { src: 'assets/profile-demo.png', alt: 'Bundled extension demo: full-size profile viewer with Download, Open and Close controls.', text: 'Full-size profile viewer preview.' },
  };
  const previewImage = document.querySelector('.demo-stage > img');
  let previewRevision = 0;
  const choosePreview = async (name, updateUrl = false) => {
    if (!Object.hasOwn(previews, name)) return;
    const next = previews[name];
    const button = document.querySelector(`[data-preview="${name}"]`);
    const revision = ++previewRevision;
    if (button.getAttribute('aria-pressed') === 'true') return;
    // Decode first so the current preview stays visible if an asset cannot be loaded.
    const image = new Image();
    image.src = next.src;
    try { await image.decode(); }
    catch (_) { document.getElementById('demo-state').textContent = 'Preview unavailable. Try the feature screenshots below.'; return; }
    if (revision !== previewRevision) return;
    previewImage.src = next.src;
    previewImage.alt = next.alt;
    document.getElementById('demo-state').textContent = next.text;
    for (const control of document.querySelectorAll('[data-preview]')) control.setAttribute('aria-pressed', String(control === button));
    if (updateUrl) setUrlState('preview', name);
    if (!reducedMotion.matches) previewImage.animate([{ opacity: .15 }, { opacity: 1 }], { duration: 650, easing: 'ease-out' });
  };
  for (const button of document.querySelectorAll('[data-preview]')) button.addEventListener('click', () => choosePreview(button.dataset.preview, true));
  choosePreview(new URL(location.href).searchParams.get('preview'));
  document.querySelector('.demo-overlay').hidden = false;

  // Finite, once-only motion. Content is visible even without JavaScript or an observer.
  const enter = (element, index, picture = false) => {
    if (reducedMotion.matches || document.hidden) return;
    element.animate(picture
      ? [{ opacity: .65, transform: 'scale(.98)' }, { opacity: 1, transform: 'scale(1)' }]
      : [{ opacity: .2, transform: 'translateY(20px)' }, { opacity: 1, transform: 'translateY(0)' }],
    { duration: picture ? 1000 : 850, delay: (index % 3) * 70, easing: 'cubic-bezier(.22,1,.36,1)' });
  };
  document.querySelectorAll('[data-enter]').forEach((element, index) => enter(element, index, element.tagName === 'FIGURE'));
  if ('IntersectionObserver' in window) {
    let remaining = document.querySelectorAll('[data-reveal]').length;
    const observer = new IntersectionObserver((entries) => {
      entries.filter(entry => entry.isIntersecting).forEach((entry, index) => {
        enter(entry.target, index, entry.target.tagName === 'FIGURE');
        observer.unobserve(entry.target);
        if (--remaining === 0) observer.disconnect();
      });
    }, { threshold: .12 });
    document.querySelectorAll('[data-reveal]').forEach(element => observer.observe(element));
  }
  const finishMotion = () => document.getAnimations().forEach(animation => animation.finish());
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) finishMotion(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishMotion(); });
})();
