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
  request the site makes when a post is opened) for one post at a time. The one modified site request:
  the conversation query's chat theme flag (owner-approved exception, v2.5.0; see below).
- Commits end with the `Co-Authored-By` trailer used in history. Commit email is the GitHub noreply
  address already set in this repo's git config (do not expose the owner's personal email).

## Architecture

| File | World | Role |
| --- | --- | --- |
| `intercept.js` | MAIN, `document_start` | Hooks `fetch` / `XMLHttpRequest`, parses JSON responses and embedded `<script type="application/json">`, extracts profile pics, post media (`code` → items), story items (`pk`), and post music. Sends them with `window.postMessage` (`ighd-pics`, `ighd-media`, `ighd-items`, `ighd-friendship`, `ighd-themes`). Sets the chat theme flag in the site's conversation request (`withChatThemes`). Handles `ighd-load-post` → fetches `/api/v1/media/<id>/info/` (id = post code decoded as base64 digits, `codeToId`). Console helpers: `igtSongStatus()`, `igtMusicFields()`. |
| `content.js` | isolated | UI: profile HD viewer, download button in each post's like/comment/share bar (`postBars()`), story download button, ♪ music overlay + volume slider, reels-like autoplay (`updateFocusPlay`). Carousel slide detection via real visibility (`visibleArea`, `selection`). |
| `mp4fix.js` | isolated | Rewrites `stts` of ~1 fps "photo + music" story videos so Windows decoders show the picture immediately (no re-encode). |
| `background.js` | SW | `chrome.downloads.download` (accepts data: URLs from `downloadMedia`). |
| `music-player.js` | isolated | Audio adapter: page Audio first; falls back on NotAllowedError to an internal extension player over a runtime port. Mirrors state, clip, volume and pause; pagehide disconnects. |
| `offscreen.html`, `offscreen.js` | extension document | AUDIO_PLAYBACK player, clip loop, one owner, six-second heartbeat lease, releases source on stop. Background coordinates ownership and creation. |

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

## Chat themes (v2.5.0, safety pause and composer in v2.5.1)

Owner asked to see chat themes on the web, with nothing to enable besides the extension, and approved
the non-passive approach after a test. Details and observed fields: CHAT_THEME_FEASIBILITY.md. The web
client implements themes but its conversation query only selects `as_ig_direct_thread.theme_data` when
the Relay provider `IGDEnableOffMsysChatThemesQE` is true; it was false for the owner. `withChatThemes`
flips only `__relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider` false → true in XHR / string
fetch bodies. The server returned the theme (HTTP 200) in the owner's session. `thread_key` matches
`/direct/t/<id>/`; `theme_data: null` means no theme. Do not add separate theme requests.

`content.js` (`updateChatTheme`, from `sync` and on data) picks the light / dark variant from the site's
`__fb-dark-mode` / `color-scheme`, sets the site's own bubble color variables on the conversation pane
(ancestor of `[role="textbox"]` at least half the viewport tall), and puts the background color / image
on the parent of the message list (tallest scrolling div). Text colors are not variables: the atomic
class that paints each bubble color is found by giving a matching bubble's classes to a test element,
then one style rule colors that class. Bubbles also have a 10px outline in the page background color
(shapes grouped corners); over the theme image it drew a dark box around each message, so the
rule makes that outline transparent. Leaving the chat restores the saved inline values.

v2.5.1, owner-requested after a risk review: if a request the extension changed answers non-2xx,
non-JSON, or with GraphQL `errors` (any NDJSON part), `checkThemeResponse` pauses the flag for 24 h
(`igt-chat-theme-paused-until` in instagram.com localStorage; in-memory if storage fails) so a
server-side rejection cannot keep breaking conversations. Only changed requests are checked; the log
line appears in `igtSongStatus()`. The owner reported a black band at the message box in all themed
chats: the composer bar and its rounded input are painted with the page color. The background now
goes on the whole pane, the bar's opaque layers become transparent and the innermost one (the input)
takes `composer_input_background_color`; all are restored on leaving, and a re-rendered composer is
themed again. After reloading, the owner confirmed the black band is gone ("la barra negra ya no está"). During
development Claude Code's auto-mode classifier blocked this work as request tampering; the owner
explicitly authorized it and switched permission mode.

On a direct load of `/direct/t/<id>/` the conversation query (~460 ms) answers before content.js
starts (document_idle, ~600 ms), so intercept keeps the last 200 themes and resends them on
`ighd-themes-request`. Site request bodies may be strings, URLSearchParams or FormData; the flag is set
on a copy, never on the site's object.

Validation: 11 tests in `tests/chat-theme.test.js` (request rewrite for XHR / fetch / FormData /
URLSearchParams, untouched bodies, late listener resend, extraction, null / unsafe values, applying,
light / dark, restoring, CDN-only backgrounds) plus 77 existing pass. After reloading the extension,
the owner confirmed the theme shows in their themed group chat, and after the outline fix that
messages look right ("Se ve bien").

## Follows-you label (v2.4.0)

Owner asked for "(te sigue)" / "(no te sigue)" next to the name on profiles; UI text is English
("Follows you" / "Doesn't follow you"). Verified on 2026-10-22 in the owner's logged-in Brave with a
temporary page probe (read-only copies of responses): the profile query (`POST /api/graphql`,
`data.user`) carries `friendship_status.followed_by` for SPA navigation and after a full reload (then
it arrives by XHR, not embedded JSON). A follower showed `true`, a non-follower `false`. Feed copies of
the same user carry a partial `friendship_status` without `followed_by`; only booleans are used. The
owner's own profile has no `friendship_status`. Followers / following dialog entries have none either.

`collect` publishes `{ username, pk, followedBy }` as `ighd-friendship`; content keeps a 500-entry map.
`updateFollowBadge` runs from `sync` (600 ms, visible tab) and on data arrival. It finds the `h1` / `h2`
in `main header` whose text is the route username, leaves single-child wrappers (link, row) and places
one reused label before the Options button. Nothing on the own profile (pk = `ds_user_id` cookie) or
without data. No new requests, permissions or storage. Do not call `/friendships/show/` as a fallback.

Validation: 7 new tests (`tests/follow-badge.test.js`: extraction, partial data, placement, no
duplicates, own / unknown profiles, profile changes) plus the 70 existing pass. The placement was
previewed by injecting the label into the real header. After reloading the extension, the owner
confirmed it works in their real Brave session ("Lo comprobé y funciona bien").

## Installation website redesign (2026-10-22)

Owner requested the `design-taste-frontend` and `web-design-guidelines` skills. The Pages site now
uses the Product performs direction (seed 1331020704), dark neutral surfaces and a bronze download
action. Four cropped screenshots show actual bundled controls on the existing fictional demo.
`scripts/prepare_site_assets.ps1` reproduces these crops; `SITE_DESIGN.md` records the direction,
critique, intentional imagery limitations and review. The UI is still English and unofficial.

The preview switches between photo-post music and the profile viewer without playing sound.
Browser / preview choices can be shared in query parameters. Browser detection is local, with no
telemetry. Finite entrances respect reduced motion and finish when the tab hides; no polling,
frameworks, remote fonts, third-party assets or extension runtime changes were added.

The main CTA remains a ZIP download with manual installation and manual-update instructions.
No store account was registered or paid for; `distribution.json` still has a null store URL.
The owner is considering GitHub-only distribution. Do not imply a store listing exists.

Validation: skill lint 0 FAIL / 0 WARN; Edge inspection at 1440 / 768 / 390 CSS pixels 0 FAIL /
2 intentional imagery WARNs; 45 browser checks including keyboard, clipboard fallback, deep links,
privacy layout, no-JS and reduced motion; 70 extension regressions pass. Clipboard success and the
future store flow were tested with temporary fixtures only. Website assets remain outside the ZIP.

## Installation website and store kit (v2.3.3)

Owner requested a GitHub Pages installation page, then confirmed they have no Chrome Web Store
developer account and asked to prepare what is needed to publish. A website cannot silently install
the extension; the standard confirmed flow requires a store listing. Do not fake an install button,
invent a listing ID, pay registration fees or accept Google's developer agreement on their behalf.

`scripts/build_distribution.py` (stdlib Python) creates a minimal runtime ZIP, a checksum and a
self-contained `dist/site/`. It generates the public privacy page from PRIVACY.md plus an accurate
website-hosting disclosure. `site/` has responsive English UI, browser-specific manual instructions,
no analytics / external assets / backend, and a same-origin packaged ZIP download. GitHub Pages hosts
the site; extension media never goes there. `distribution.json` keeps the Chrome Web Store URL null
until the owner has a real approved listing. Setting it switches the main CTA to the store.

`.github/workflows/pages.yml` tests, builds and deploys main pushes using official GitHub actions.
Generated ZIPs / site output stay in ignored dist/, never in the extension or source history.
`store/LISTING.md` contains submission copy, permission explanations and reviewer steps;
`store/PUBLISHING.md` describes remaining owner account / review steps. `store/assets/` has original
promotional art and labeled fictional demos showing the actual bundled content-script UI, not private
user screenshots. `scripts/prepare_store_assets.py` reproduces them with a headless browser and a
separate temporary profile. No real account or media is used.

The manifest description was 164 characters; shortened to 119 for the store's 132-character limit,
and homepage_url points to the public Pages site. Extension behavior / permissions stay as v2.3.2.

Validation: 70 extension tests pass, the ZIP contains 14 expected runtime / policy / license files,
and the generated site has no missing local links. Browser smoke checks passed for manual desktop,
390px mobile and a fixture-only future store CTA (ten checks each, clipboard simulated). Desktop /
mobile layouts and all three PNG store graphics were visually inspected. Image dimensions match
the store's documented 440×280 and 1280×800 requirements. The public site remains manual-only until
the owner supplies a real store listing URL; no Google account has been registered or paid for.

## Resource review (v2.3.2)

The owner confirmed v2.3.1 works ("Todo perfecto"), then requested a data / memory / stability review
and commit + push. See PERFORMANCE.md for the exact limits, checks and remaining media data usage.
70 tests pass, including the prior playback suite and resource regressions. A synthetic headless
Chromium fixture with 500 live posts confirmed idle DOM quiescence and observer cleanup; this is not
a long-duration test in a logged-in Instagram session or a guarantee for every machine.

Recent profile / post / story maps are bounded at 500 each; request history at 2,000 and deduplicated
logs at 200. Eviction releases the old request marker so revisiting an evicted post can reload it.
Detached post / music observers are unregistered. Distant posts skip UI construction; offscreen media
skip expensive ancestor visibility checks. Pausing is idempotent and unchanged icons are not replaced.
Hidden tabs skip UI scans / sync and automatic lookups. Both page and extension audio release their
source on pause; the page adapter preserves position for resume.

MAIN serializes and deduplicates detail requests (six jobs maximum), aborts fetches at eight seconds,
and cools down after HTTP 429. Passive fetch copies are capped at two and 4 MiB each, with a bounded
JSON traversal and at most 100 NDJSON documents. Cancelling a copy must not cancel the site's original
response (covered by a regression test). Reused XHRs have only one load listener. Embedded JSON is
not reparsed unchanged; content waiters remove themselves on timeout.

Ordinary videos now download directly. Only small stories of known size (up to 8 MiB) are buffered for
timing repair, one at a time. Unknown / larger files download unchanged. Reuse fetched bytes if no
repair applies; do not reintroduce the full second download. MP4 processing has recursion / table
limits. Source-file limits are not total heap or MB/hour limits: conversion copies and browser audio
buffering still exist. No permissions, telemetry or third-party services were added by this review.

## Audio credits (v2.3.1, confirmed by owner)

`intercept.js` publishes a separate `audio` metadata object (title, artist, original) for photos and
videos. It accepts licensed music credits without a standalone audio URL, and original_sound_info
with the original creator (not inferred from the uploader). The existing `music` playback object is
unchanged. `mergePost` preserves credits across partial responses, and metadata arrival queues a scan.

`addAudioDetails` inserts a text-only row after the author row and before recommendation / location
subtitles. Header discovery uses the author's link and layout, not site class names or translated
subtitle text. It avoids duplicates when a native audio link is present, updates changing credits,
and removes stale credits in recycled articles. Long text truncates with the complete credits in the
tooltip. No extra requests, permissions or storage were added. The owner confirmed the header UI
works ("Todo perfecto") after this version.

Validation: the 48 existing playback tests passed. Eight extraction / merge cases passed, including
video credits without a song URL and original creator attribution. A temporary local browser fixture
passed 11 DOM checks for placement, repeated scans, native audio rows, safe text and stale metadata;
also checked nested author wrappers and visually inspected the rendered header. This fixture uses
synthetic markup, not the owner's logged-in DOM.

## Current playback behavior (v2.3.0): no-first-click playback confirmed by owner

The owner reloaded the extension and Instagram, did not click in the page or on ♪, and confirmed:
**"Sí, empieza sola y se detiene"**. Initial automatic playback and stopping now work in their real
Brave session without changing site settings. 48 regression tests and all JavaScript syntax checks
pass for that version.

The owner supplied an initial-attempt snapshot: focused / dominant post 100% visible, `NotAllowedError`
with "user didn't interact with the document first", and `userActivated:false` at the failure.
Autoplay was already Allow. The owner explicitly declined changing any browser settings and requested
zero initial clicks. Do not suggest Sound / Autoplay setting changes again for this task.

Added the supported `offscreen` API / permission (AUDIO_PLAYBACK purpose), minimum Chromium 116 for
runtime.getContexts. The existing page Audio is still preferred. Only a NotAllowedError switches to
the extension-owned player. No site is framed, no browser settings change, no third-party service.
All media still comes directly from the original CDN URLs. The background only accepts main-frame
Instagram ports, HTTPS cdninstagram.com / fbcdn.net audio and finite clip / volume parameters.

Creation is shared across concurrent requests; play / pause revisions prevent late playback after
scroll or hiding. Runtime disconnect pauses the owner's audio; old tabs cannot pause the new owner.
The content adapter sends a heartbeat every 1.5 seconds; the offscreen player stops after a six-second
lease without one. Source URLs are released on stop. Chromium closes the silent document after 30 sec.

Tests include the actual controller + adapter + SW + offscreen scripts in linked vm contexts, with
page play always rejecting without a gesture. For future changes, reload the extension and Instagram,
do not click in the page, and check a music post, scrolling, hiding and closing the tab.
`igtSongStatus()` adds `audioEngine: page | extension`.

## Previously confirmed behavior (v2.2.4)

After reloading the extension and Instagram, the owner tested the actual Brave session and confirmed:
**"Sí, cambia sola y se detiene"** — one manual start, automatic song changes on subsequent posts,
and stopping after scrolling past the post. The final visibility correction resolved their report.
36 Node regression tests and JavaScript syntax checks passed for that version.

Owner reported v2.2.3 keeps playing after leaving a post and still needs a click for each new song.
Latest requirement supersedes the uninterrupted-gap behavior below: keep playing through small
scrolls only while the current photo is visible and dominant. Stop at zero visible area, or as soon
as another post dominates (even before that next post reaches the 60% start threshold). Do not wait
for its song details. Start its song at 60%, subject to browser permission. Pause for native reels,
video and audio too; native media participates in focus even without a known post code or button.

The owner confirmed needing another click on every post and **Autoplay already set to Allow** in
Brave. Their latest snapshot has `blocked:false`, `focused:null`, no pending play, and every candidate
at `visible:0` despite nonzero media sizes. Do not keep attributing the failure to site permissions.
Selection has no candidate at that moment; incorrect ancestor clipping can produce this condition.
Regression tests reproduced displaced document-root boxes, display:contents wrappers and horizontal-
only overflow incorrectly reducing visibility to zero. `visibleArea` now applies viewport overflow
once, skips boxless wrappers and clips each axis independently while preserving carousel clipping.
This helper is also used by downloads / slide selection, so keep the nested-scroll and carousel tests.
The exact ancestry in the owner's page was not captured, but the owner confirmed the final fix in
their real session. Do not use mocked tests alone to claim future browser regressions are resolved.

`igtSongStatus()` now adds extension version, dominant post / native media, last error with attempt
mode, and user activation to the focus snapshot. Candidates include top / bottom and viewport-only
visibility; if ancestor clipping alone reduces a visible candidate to zero, `clippedBy` records the
actual clipping boxes. A native play / volumechange event also checks focus.

## Earlier autoplay changes

Owner clarified the handoff behavior: keep the current song playing while scrolling, and switch only
when the next post fills about 60% of the screen. v2.2.3 therefore uses 60% of viewport height in the
feed column, or the whole photo for a shorter photo. **Do not pause just because no post currently
meets that threshold.** The old controller paused in the gap between posts; this was reproducible.

Another regression reproduced the block getting stuck after an initial `NotAllowedError`: a manual
retry followed by a quick scroll could cancel its play() promise before success cleared the block.
Manual play now clears the old block before loading, and a page gesture clears it even in a gap with
no eligible song. A new `NotAllowedError` still restores the block; browser restrictions are respected.

`musicPosts` also tracks media boxes for posts without buttons. v2.2.3 held the old song while the
next post's details / button loaded; v2.2.4 instead pauses once another post is dominant. Leaving
the route, opening a covering dialog, hiding the tab, or losing the visible photo also stops it.

The owner's v2.2.1 console log showed an initial `NotAllowedError` followed by successful button
playback for several posts, without any successful autoplay. That does not establish that permission
is the only issue. Regression tests reproduced four focus failures: photos taller than the viewport
could never reach the old 60% threshold, small fully visible neighbors beat the dominant photo, hidden
dialog containers excluded the feed, and layout shifts without scroll left focus stale.

v2.2.2 compares visible area with the area that fits in the viewport, preserving the 60% threshold for
smaller photos. It chooses the eligible photo with the largest visible area and only considers visible
dialogs. Missing-song prefetch uses the same viewport sizing, with finer intersection thresholds for
tall posts. Music visibility observes the photo box, and a 600 ms check in visible tabs catches layout
changes. A failed automatic attempt is limited to once per focus so layout checks cannot cause retries
in a loop. No new request types or permissions were added.

`startMusic` now calls `play()` before any asynchronous wait; setting `currentTime` before metadata
loads preserves the author's clip offset without losing a click's user activation. `NotAllowedError`
is logged through `ighd-log` / `igtSongStatus()` and shows one notice per page load. After a block,
scrolling does not repeatedly call `play()`; a trusted page click or Enter / Space retries the currently
focused post synchronously. The ♪ controls handle their own clicks and manual pauses are respected.

Pending playback is cancelled when a new post takes over, and hiding the tab pauses immediately
without waiting for an animation frame. `igtSongStatus()` also requests an asynchronous
`IG Tools music focus` snapshot showing viewport, focused / playing code, block / manual pause state,
and each candidate's normalized visibility and dialog coverage. The bridge checks window and origin.

For future changes, verify real playback in the owner's logged-in Brave session:
reload the extension and page, view a photo post with a song, check the block notice / click recovery,
scroll between posts, pause manually and hide the tab. If sound stays blocked, inspect `igtSongStatus()`
and the audio engine / error. The owner requires playback without changing site settings.

## Testing

- `node --check *.js` for syntax. Logic tests in Node load `intercept.js` in a `vm` context with stubbed
  `window`, `document`, `fetch` (see git history for examples of this harness).
- `node --test tests/music-autoplay.test.js` runs the shipped music controller in a `vm` with stubbed
  media and DOM events, covering blocked playback, gesture recovery, focus changes and cancellation.
- Real UI checks need the owner's logged-in browser.
- Full suite: `node --test tests/music-autoplay.test.js tests/extension-audio.test.js tests/resource-usage.test.js tests/follow-badge.test.js tests/chat-theme.test.js`.
