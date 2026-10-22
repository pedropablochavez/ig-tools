// Saves the image via the downloads API (avoids CDN cross-origin restrictions in the page).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'download') return;
  chrome.downloads.download({ url: msg.url, filename: msg.filename, saveAs: false }, (id) => {
    const err = chrome.runtime.lastError;
    sendResponse(err ? { ok: false, error: err.message } : { ok: true, id });
  });
  return true; // async response
});

// Audio fallback runs in a packaged extension document, not inside instagram.com's
// document. Only our own Instagram content scripts can request it.
let creatingAudio = null;
let audioOwner = null;
const audioClients = new Map();
const audioDocument = () => chrome.runtime.getURL('offscreen.html');

async function ensureAudioDocument() {
  if (creatingAudio) return creatingAudio;
  creatingAudio = (async () => {
    if (!chrome.offscreen || !chrome.runtime.getContexts) {
      throw Object.assign(new Error('Extension audio requires Chromium 116 or later'), { name: 'NotSupportedError' });
    }
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [audioDocument()]
    });
    if (!existing.length) await chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play the visible Instagram post song without requiring a webpage gesture.'
    });
  })();
  try { await creatingAudio; } finally { creatingAudio = null; }
}

const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
function validMusicCommand(msg) {
  if (!Number.isSafeInteger(msg?.id) || msg.id < 1) return false;
  if (['pause', 'heartbeat'].includes(msg.action)) return true;
  if (msg.action === 'volume') return finite(msg.volume, 0, 1);
  if (msg.action === 'seek') return finite(msg.position, 0, 86400);
  if (msg.action !== 'play') return false;
  try {
    const url = new URL(msg.url);
    if (url.protocol !== 'https:' || url.username || url.password
      || !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) return false;
  } catch (_) { return false; }
  return finite(msg.start, 0, 86400000) && finite(msg.duration, 1, 86400000)
    && finite(msg.position, 0, 86400) && finite(msg.volume, 0, 1);
}

async function sendAudio(msg) {
  return chrome.runtime.sendMessage({ ...msg, target: 'igt-music-offscreen' });
}
async function pauseAudio(client, id) {
  if (audioOwner !== client) return;
  audioOwner = null;
  if (creatingAudio) { try { await creatingAudio; } catch (_) { return; } }
  try { await sendAudio({ action: 'pause', owner: client.key, id }); } catch (_) {}
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'igt-music') return;
  const sender = port.sender;
  try {
    if (!Number.isInteger(sender?.tab?.id) || sender.frameId !== 0
      || new URL(sender.url).origin !== 'https://www.instagram.com') throw new Error('Invalid sender');
  } catch (_) { port.disconnect(); return; }
  const client = { port, key: crypto.randomUUID(), revision: 0, closed: false };
  audioClients.set(client.key, client);
  function reply(msg) { if (!client.closed) { try { port.postMessage(msg); } catch (_) {} } }
  port.onMessage.addListener(async (msg) => {
    if (!validMusicCommand(msg)) {
      reply({ replyTo: msg?.id, ok: false, name: 'TypeError', error: 'Invalid music command' });
      return;
    }
    try {
      if (msg.action === 'play') {
        client.revision = msg.id;
        const previous = audioOwner;
        audioOwner = client;
        if (previous && previous !== client && !previous.closed) {
          try { previous.port.postMessage({ event: 'state', paused: true, currentTime: 0,
            revision: previous.revision }); } catch (_) {}
        }
        await ensureAudioDocument();
        if (client.closed || client.revision !== msg.id || audioOwner !== client) {
          throw Object.assign(new Error('Playback cancelled'), { name: 'AbortError' });
        }
        const result = await sendAudio({ ...msg, owner: client.key });
        reply({ ...result, replyTo: msg.id });
      } else if (msg.action === 'pause') {
        client.revision = msg.id;
        await pauseAudio(client, msg.id);
      } else if (audioOwner === client) {
        await sendAudio({ ...msg, owner: client.key });
      }
    } catch (error) {
      reply({ replyTo: msg.id, ok: false, name: error.name, error: error.message });
    }
  });
  port.onDisconnect.addListener(() => {
    client.closed = true;
    client.revision = Number.MAX_SAFE_INTEGER;
    audioClients.delete(client.key);
    pauseAudio(client, client.revision);
  });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.target !== 'igt-music-state' || sender.id !== chrome.runtime.id
    || sender.url !== audioDocument() || sender.tab) return;
  const client = audioClients.get(msg.owner);
  if (client && client === audioOwner && !client.closed) {
    try { client.port.postMessage({ event: 'state', revision: msg.revision,
      paused: msg.paused, currentTime: msg.currentTime }); } catch (_) {}
  }
});
