// Fixes "music stories": a still photo turned into a ~1 fps video. Some players (notably the
// Windows decoder) hold back several frames before showing the first one, which at 1 fps means
// ~10 seconds of black screen while the music already plays.
//
// Since the picture never changes, we only rewrite the video timing table (stts) so the first
// frames arrive within a fraction of a second; the rest share the remaining time. Total length,
// audio and image data stay exactly the same. No re-encoding.
(() => {
  'use strict';

  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex']);
  const DENSE_FRAMES = 15; // frames packed at the start
  const DENSE_FPS = 30;

  function readBoxes(view, start, end, parents, out) {
    if (parents.length > 16) throw new Error('MP4 nesting limit');
    let pos = start;
    while (pos + 8 <= end) {
      let size = view.getUint32(pos);
      const type = String.fromCharCode(
        view.getUint8(pos + 4), view.getUint8(pos + 5), view.getUint8(pos + 6), view.getUint8(pos + 7)
      );
      let header = 8;
      if (size === 1) {
        if (pos + 16 > end) break;
        size = Number(view.getBigUint64(pos + 8));
        header = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < header || pos + size > end) break;
      const box = { type, pos, size, header, parents };
      if (out.length >= 10000) throw new Error('MP4 box limit');
      out.push(box);
      if (CONTAINERS.has(type)) readBoxes(view, pos + header, pos + size, [...parents, box], out);
      pos += size;
    }
    return out;
  }

  const child = (boxes, parent, type) => boxes.find((b) => b.type === type && b.parents.at(-1) === parent);

  function buildStts(entries) {
    const buf = new DataView(new ArrayBuffer(16 + entries.length * 8));
    buf.setUint32(0, buf.byteLength);
    [...'stts'].forEach((c, i) => buf.setUint8(4 + i, c.charCodeAt(0)));
    buf.setUint32(8, 0); // version + flags
    buf.setUint32(12, entries.length);
    entries.forEach(([count, delta], i) => {
      buf.setUint32(16 + i * 8, count);
      buf.setUint32(20 + i * 8, delta);
    });
    return new Uint8Array(buf.buffer);
  }

  // Returns a fixed copy of the file, or null when it does not need (or support) the fix.
  function fixLowFpsMp4(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const boxes = readBoxes(view, 0, bytes.length, [], []);
    const moov = boxes.find((b) => b.type === 'moov' && !b.parents.length);
    const mdat = boxes.find((b) => b.type === 'mdat' && !b.parents.length);
    if (!moov || !mdat || boxes.some((b) => b.type === 'moof')) return null;

    // Find the video track.
    let stts = null;
    let timescale = 0;
    const tracks = boxes.filter((b) => b.type === 'trak');
    if (tracks.length > 32) return null;
    for (const trak of tracks) {
      const mdia = child(boxes, trak, 'mdia');
      const hdlr = mdia && child(boxes, mdia, 'hdlr');
      if (!hdlr || view.getUint32(hdlr.pos + hdlr.header + 8) !== 0x76696465) continue; // 'vide'
      const mdhd = child(boxes, mdia, 'mdhd');
      const v1 = view.getUint8(mdhd.pos + mdhd.header) === 1;
      timescale = view.getUint32(mdhd.pos + mdhd.header + (v1 ? 20 : 12));
      const stbl = child(boxes, child(boxes, mdia, 'minf'), 'stbl');
      stts = stbl && child(boxes, stbl, 'stts');
      if (stbl && child(boxes, stbl, 'ctts')) return null; // reordered frames: leave as is
      break;
    }
    if (!stts || !timescale) return null;

    // Current timing.
    const n = view.getUint32(stts.pos + stts.header + 4);
    if (n > 100000 || stts.header + 8 + n * 8 > stts.size) return null;
    let frames = 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const count = view.getUint32(stts.pos + stts.header + 8 + i * 8);
      const delta = view.getUint32(stts.pos + stts.header + 12 + i * 8);
      frames += count;
      total += count * delta;
    }
    const fps = frames / (total / timescale);
    if (!(fps > 0 && fps <= 2) || frames < 3) return null;

    // New timing: K quick frames, the rest spread over the remaining time.
    const k = Math.min(DENSE_FRAMES, frames - 1);
    const d = Math.max(1, Math.round(timescale / DENSE_FPS));
    const rest = frames - k;
    const remaining = total - k * d;
    if (remaining < rest) return null;
    const base = Math.floor(remaining / rest);
    const extra = remaining - base * rest;
    const entries = [[k, d]];
    if (extra === 0) entries.push([rest, base]);
    else {
      if (rest > 1) entries.push([rest - 1, base]);
      entries.push([1, base + extra]);
    }
    const newStts = buildStts(entries);
    const delta = newStts.length - stts.size;

    // Splice it in and grow every ancestor box.
    const out = new Uint8Array(bytes.length + delta);
    out.set(bytes.subarray(0, stts.pos), 0);
    out.set(newStts, stts.pos);
    out.set(bytes.subarray(stts.pos + stts.size), stts.pos + newStts.length);
    const ov = new DataView(out.buffer);
    for (const p of stts.parents) {
      if (p.header === 16) ov.setBigUint64(p.pos + 8, BigInt(p.size + delta));
      else ov.setUint32(p.pos, p.size + delta);
    }

    // moov before mdat: the media moved, so shift every chunk offset.
    if (moov.pos < mdat.pos && delta !== 0) {
      for (const b of readBoxes(ov, 0, out.length, [], [])) {
        if (b.type !== 'stco' && b.type !== 'co64') continue;
        const count = ov.getUint32(b.pos + b.header + 4);
        const stride = b.type === 'stco' ? 4 : 8;
        if (count > 100000 || b.header + 8 + count * stride > b.size) return null;
        for (let i = 0; i < count; i++) {
          if (b.type === 'stco') {
            const at = b.pos + b.header + 8 + i * 4;
            ov.setUint32(at, ov.getUint32(at) + delta);
          } else {
            const at = b.pos + b.header + 8 + i * 8;
            ov.setBigUint64(at, ov.getBigUint64(at) + BigInt(delta));
          }
        }
      }
    }
    return out.buffer;
  }

  if (typeof module !== 'undefined') module.exports = { fixLowFpsMp4 };
  else globalThis.igtFixLowFpsMp4 = fixLowFpsMp4;
})();
