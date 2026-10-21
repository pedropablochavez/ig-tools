# AGENTS.md — handoff notes for IG Tools

Unofficial Chromium (MV3) extension for instagram.com, used in **Brave** by the owner.
Repo: https://github.com/pedropablochavez/ig-tools (public). The owner speaks Spanish; code, UI and
docs are in English. Load it via `brave://extensions` → Developer mode → Load unpacked (this folder).

## Hard rules (owner's requirements)

- **Legal / privacy posture:** no data collection, no third-party servers, no analytics. Keep the
  disclaimers in `README.md` / `PRIVACY.md` accurate whenever behaviour changes. Do not use Instagram
  branding (colors/logo); name is "IG Tools (Unofficial)".
- **Passive first:** prefer reading data the page already loaded (`intercept.js`). The only requests
  the extension makes itself: the file the user downloads, and `/api/v1/media/<id>/info/` (the same
  request the site makes when a post is opened) for one post at a time.
- Commits end with the `Co-Authored-By` trailer used in history. Commit email is the GitHub noreply
  address already set in this repo's git config (do not expose the owner's personal email).

## Architecture

| File | World | Role |
| --- | --- | --- |
| `intercept.js` | MAIN, `document_start` | Hooks `fetch` / `XMLHttpRequest`, parses JSON responses and embedded `<script type="application/json">`, extracts profile pics, post media (`code` → items), story items (`pk`), and post music. Sends them with `window.postMessage` (`ighd-pics`, `ighd-media`, `ighd-items`). Handles `ighd-load-post` → fetches `/api/v1/media/<id>/info/` (id = post code decoded as base64 digits, `codeToId`). Console helpers: `igtSongStatus()`, `igtMusicFields()`. |
| `content.js` | isolated | UI: profile HD viewer, download button in each post's like/comment/share bar (`postBars()`), story download button, ♪ music overlay + volume slider, reels-like autoplay (`updateFocusPlay`). Carousel slide detection via real visibility (`visibleArea`, `selection`). |
| `mp4fix.js` | isolated | Rewrites `stts` of ~1 fps "photo + music" story videos so Windows decoders show the picture immediately (no re-encode). |
| `background.js` | SW | `chrome.downloads.download` (accepts data: URLs from `downloadMedia`). |

Messages between worlds are checked with `fromPage(e)` (same window + same origin).

## Things learned the hard way

- Calling `/api/v1/users/web_profile_info` or `/users/<id>/info/` ourselves → **HTTP 429**. Avoid.
- Instagram sends `X-Frame-Options: DENY`: hidden iframes do not work (tried and removed).
- `fetch('/p/CODE/')` returns an empty shell (no data); only real navigations embed data.
- **Feed data often lacks songs and full video files** (only DASH). The post details request
  (`/api/v1/media/<id>/info/`) has `music_metadata` (song URL, `audio_asset_start_time_in_ms`,
  `overlap_duration_in_ms`) and `video_versions`. Confirmed working with the owner's session (v2.2.0).
- Post bar detection must require the big (24px) like icon + comment icon; comments have 12px hearts.
- Logged-out testing is limited (login wall hides carousels, no music fields). Ask the owner for
  console output (`igtSongStatus()`) or to connect a browser tool if you need the logged-in view.

## Open task: autoplay does not start

Music plays when the ♪ button is clicked, but **does not start automatically** when a photo post with a
song is on screen. Expected (owner): like reels, the song of the post in view plays, and stops when
scrolling to another post (`updateFocusPlay` in `content.js`, triggered by scroll/resize/visibility and
when a ♪ button is added; picks the ♪ whose media box is ≥60% visible).

Likely causes to check, in order:
1. **Brave blocks autoplay with sound by default** (Brave Shields / `brave://settings/content/autoplay`).
   `player.play()` then rejects with `NotAllowedError`, and `startMusic(..., fromClick=false)` swallows
   it silently. Log the rejection (e.g. post an `ighd-log` message) and, if blocked, show a one-time
   toast telling the user to allow autoplay for instagram.com, or start on the first user gesture.
2. Chromium's autoplay policy needs a prior user gesture on the page; scrolling does not count.
3. Verify `updateFocusPlay` actually runs on the feed's scroll (the feed scrolls the window; a capture
   listener is registered) and that `focusedMusicButton()` finds the ♪ (box = `.ighd-music-wrap` parent).

## Testing

- `node --check *.js` for syntax. Logic tests in Node load `intercept.js` in a `vm` context with stubbed
  `window`, `document`, `fetch` (see git history for examples of this harness).
- Real UI checks need the owner's logged-in browser.
