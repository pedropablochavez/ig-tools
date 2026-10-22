// One extension-owned audio player. A short lease prevents orphaned playback.
(() => {
  'use strict';
  const audio = new Audio();
  audio.preload = 'metadata';
  let owner = null;
  let revision = 0;
  let attempt = 0;
  let expires = 0;
  let clip = null;

  function state() {
    if (!owner) return;
    chrome.runtime.sendMessage({ target: 'igt-music-state', owner,
      revision, paused: audio.paused, currentTime: audio.currentTime }).catch(() => {});
  }
  function stop() {
    ++attempt;
    audio.pause();
    state();
    owner = null;
    clip = null;
    audio.removeAttribute('src');
    audio.load();
  }
  audio.addEventListener('play', state);
  audio.addEventListener('pause', state);
  audio.addEventListener('timeupdate', () => {
    if (clip && audio.currentTime >= (clip.start + clip.duration) / 1000) audio.currentTime = clip.start / 1000;
    state();
  });
  audio.addEventListener('ended', () => {
    if (!clip || Date.now() >= expires) return;
    const token = attempt;
    audio.currentTime = clip.start / 1000;
    audio.play().catch(() => { if (token === attempt) stop(); });
  });
  audio.addEventListener('error', stop);
  setInterval(() => { if (owner && Date.now() >= expires) stop(); }, 1000);

  async function handle(msg) {
    if (msg.action === 'play') {
      if (owner === msg.owner && msg.id < revision) throw Object.assign(new Error('Stale play'), { name: 'AbortError' });
      const token = ++attempt;
      audio.pause();
      owner = msg.owner;
      revision = msg.id;
      expires = Date.now() + 6000;
      clip = { start: msg.start, duration: msg.duration };
      if (audio.src !== msg.url) audio.src = msg.url;
      audio.volume = msg.volume;
      audio.currentTime = msg.position;
      await audio.play();
      if (token !== attempt) throw Object.assign(new Error('Playback cancelled'), { name: 'AbortError' });
      state();
      return;
    }
    if (owner !== msg.owner) return;
    if (msg.action === 'pause') {
      if (msg.id < revision) return;
      revision = msg.id;
      stop();
    } else if (msg.action === 'heartbeat') expires = Date.now() + 6000;
    else if (msg.action === 'volume') audio.volume = msg.volume;
    else if (msg.action === 'seek') audio.currentTime = msg.position;
  }
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg?.target !== 'igt-music-offscreen' || sender.id !== chrome.runtime.id || sender.tab) return;
    handle(msg).then(() => reply({ ok: true }), (error) => {
      if (owner === msg.owner && revision === msg.id) stop();
      reply({ ok: false, name: error.name, error: error.message });
    });
    return true;
  });
})();
