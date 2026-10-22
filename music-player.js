// The page player is preferred. If the browser requires a first gesture, use the
// extension's AUDIO_PLAYBACK document instead; no site settings are changed.
(() => {
  'use strict';
  globalThis.igtCreateMusicPlayer = () => {
    const audio = new Audio();
    const listeners = new Map();
    let port = null;
    let remote = false;
    let sequence = 0;
    let generation = 0;
    let control = 0;
    let source = '';
    let released = false;
    let savedPosition = 0;
    let clip = { start: 0, duration: 30000 };
    let state = { paused: true, currentTime: 0 };
    const pending = new Map();
    const emit = (type) => { for (const fn of listeners.get(type) || []) fn(); };
    const abort = () => Object.assign(new Error('Playback cancelled'), { name: 'AbortError' });

    function connect() {
      if (port) return port;
      const current = chrome.runtime.connect({ name: 'igt-music' });
      port = current;
      current.onMessage.addListener((msg) => {
        if (port !== current) return;
        if (msg.event === 'state') {
          if (msg.revision < control) return;
          const wasPaused = state.paused;
          state = { paused: !!msg.paused, currentTime: msg.currentTime || 0 };
          if (remote) {
            if (wasPaused !== state.paused) emit(state.paused ? 'pause' : 'play');
            emit('timeupdate');
          }
        }
        const waiter = pending.get(msg.replyTo);
        if (!waiter) return;
        pending.delete(msg.replyTo);
        clearTimeout(waiter.timer);
        if (msg.ok) waiter.resolve(msg);
        else waiter.reject(Object.assign(new Error(msg.error || 'Extension audio failed'), {
          name: msg.name || 'Error'
        }));
      });
      current.onDisconnect.addListener(() => {
        if (port !== current) return;
        port = null;
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(abort());
        }
        pending.clear();
        state.paused = true;
        if (remote) emit('pause');
      });
      return current;
    }

    function command(action, args = {}, wait = true) {
      const id = ++sequence;
      if (action === 'play' || action === 'pause') control = id;
      const current = connect();
      if (!wait) {
        current.postMessage({ id, action, ...args });
        return;
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          if (id === control) {
            try { current.postMessage({ id: ++sequence, action: 'pause' }); } catch (_) {}
          }
          reject(Object.assign(new Error('Extension audio timed out'), { name: 'TimeoutError' }));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        try { current.postMessage({ id, action, ...args }); }
        catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    }

    for (const type of ['play', 'pause', 'timeupdate']) {
      audio.addEventListener(type, () => { if (!remote) emit(type); });
    }
    const player = {
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      setClip(start, duration) { clip = { start, duration }; },
      get engine() { return remote ? 'extension' : 'page'; },
      get preload() { return audio.preload; },
      set preload(value) { audio.preload = value; },
      get readyState() { return remote ? 1 : audio.readyState; },
      get paused() { return remote ? state.paused : audio.paused; },
      get src() { return source; },
      set src(value) {
        source = value;
        if (!remote) { released = false; audio.src = value; }
      },
      get volume() { return audio.volume; },
      set volume(value) {
        audio.volume = value;
        if (remote && port) command('volume', { volume: value }, false);
      },
      get currentTime() { return remote ? state.currentTime : released ? savedPosition : audio.currentTime; },
      set currentTime(value) {
        if (remote) {
          state.currentTime = value;
          if (port) command('seek', { position: value }, false);
        } else if (released) savedPosition = value;
        else audio.currentTime = value;
      },
      async play() {
        const attempt = ++generation;
        if (!remote) {
          if (released) {
            audio.src = source;
            audio.currentTime = savedPosition;
            released = false;
          }
          try { await audio.play(); return; }
          catch (error) {
            if (error.name !== 'NotAllowedError' || !globalThis.chrome?.runtime?.connect) throw error;
            if (attempt !== generation) throw abort();
            state = { paused: true, currentTime: audio.currentTime };
            audio.pause();
            remote = true;
            // The extension will load the file, so release the page's failed resource.
            audio.preload = 'none';
            audio.removeAttribute('src');
            audio.load();
          }
        }
        try {
          await command('play', { url: source, ...clip, position: state.currentTime, volume: audio.volume });
          if (attempt !== generation) throw abort();
          const wasPaused = state.paused;
          state.paused = false;
          if (wasPaused) emit('play');
        } catch (error) {
          if (attempt === generation) { state.paused = true; emit('pause'); }
          throw error;
        }
      },
      pause() {
        ++generation;
        if (!remote) {
          if (!released && source) {
            savedPosition = audio.currentTime;
            audio.pause();
            released = true;
            audio.removeAttribute('src');
            audio.load();
          } else audio.pause();
        }
        else {
          state.paused = true;
          if (port) { try { command('pause', {}, false); } catch (_) {} }
          emit('pause');
        }
      }
    };
    setInterval(() => {
      if (remote && port && (!state.paused || pending.size)) {
        try { command('heartbeat', {}, false); } catch (_) { player.pause(); }
      }
    }, 1500);
    window.addEventListener('pagehide', () => { player.pause(); if (port) port.disconnect(); });
    return player;
  };
})();
