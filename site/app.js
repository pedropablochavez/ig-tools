(() => {
  'use strict';
  const config = window.IG_TOOLS || {};
  for (const node of document.querySelectorAll('[data-version]')) node.textContent = `v${config.version || '2.3.3'}`;
  if (config.zipBytes) for (const node of document.querySelectorAll('[data-zip-size]')) node.textContent = `${Math.ceil(config.zipBytes / 1024)} KB ZIP`;
  // This is local UI adaptation only; browser details are never sent anywhere.
  const addresses = { brave: 'brave://extensions', chrome: 'chrome://extensions', edge: 'edge://extensions' };
  const chooseBrowser = (browser) => {
    document.getElementById('extensions-address').textContent = addresses[browser];
    for (const button of document.querySelectorAll('[data-browser]')) button.setAttribute('aria-pressed', String(button.dataset.browser === browser));
    document.querySelector('.copy-status').textContent = '';
  };
  for (const button of document.querySelectorAll('[data-browser]')) button.addEventListener('click', () => chooseBrowser(button.dataset.browser));
  if (/Edg\//.test(navigator.userAgent)) chooseBrowser('edge');
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
})();
