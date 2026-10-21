// Saves the image via the downloads API (avoids CDN cross-origin restrictions in the page).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'download') return;
  chrome.downloads.download({ url: msg.url, filename: msg.filename, saveAs: false }, (id) => {
    const err = chrome.runtime.lastError;
    sendResponse(err ? { ok: false, error: err.message } : { ok: true, id });
  });
  return true; // async response
});
