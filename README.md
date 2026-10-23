# IG Tools (Unofficial)

A small, unofficial browser extension for Chromium-based browsers (Brave, Chrome, Edge) for instagram.com:

- an **"HD photo"** button on profile pages to view the profile picture in full size,
- a **download** button next to like / comment / share to save the photos and videos of a post, and
- a **Download story** button while watching stories.

> **Unofficial project.** Not affiliated with, endorsed by, or sponsored by Instagram or Meta Platforms, Inc.
> "Instagram" is a trademark of Meta Platforms, Inc. and is used here only to describe which website
> the extension works on.

## Features

- Floating **HD photo** button on profile pages.
- Full-size viewer with **Download** and **Open in new tab**. Press `Esc` or click outside to close.
- **Download** button next to like / comment / share on posts and reels. It saves only the photo or video
  you are looking at (in a carousel, the current slide), in its original quality. If the feed only has a
  streamed version of a video, it asks the site for the post's details to get the full file.
- **Download** button in the story viewer, next to like / share (or a floating button on your own stories).
  It saves the photo or video being shown.
- **Audio credits** in post headers: song title and artist, or original audio title and creator,
  below the username and above recommendation / location subtitles. Works with photos and videos
  when the page supplies audio metadata, even without a separate playable song URL. Existing native
  audio links are kept without adding a duplicate. Long credits are truncated; hover for the full text.
- **Follows you / Doesn't follow you** label next to the username on other people's profiles. It uses
  the relationship the profile page already loaded, so it adds no requests. Nothing is shown on your
  own profile or when the page has not provided the relationship.
- **Chat themes** in direct messages: the conversation's theme from the mobile app (background image,
  bubble and text colors, light / dark variant) is shown on the website, which otherwise leaves it out
  for some accounts. Chats without a theme are unchanged.
- **♪ Music** on photo posts that have a song attached (as in the mobile app): like reels, the song of the
  post you are looking at plays (the exact clip the author picked, in a loop). It keeps playing as you
  scroll while its photo remains visible and dominant, then switches when the next post fills about
  60% of the screen height. A shorter photo takes over when fully in view. A floating ♪ button
  pauses / resumes it, with a volume slider on
  hover (remembered). The feed often lacks the song; see *How it works* for how it is found.
  If the page rejects playback because no initial gesture occurred, the extension automatically
  plays the same clip in its own internal audio document. No first click or site-setting change is
  required for this fallback. Playback stops when the tab is hidden or closed.
- Fixes "photo + music" stories (a still image turned into a 1 fps video), which in some players stay
  black for ~10 seconds: the frame timing is adjusted so the picture shows right away. Image and audio are
  not re-encoded. To limit memory use, repair applies to one story at a time, with a known size up to
  8 MiB. Larger or unknown-size stories are downloaded unchanged.
- No third-party websites, no ads, no copy-pasting links.

## Install

Visit the [installation website](https://pedropablochavez.github.io/ig-tools/) for a small extension-only
ZIP, browser-specific instructions and privacy policy. The site currently offers **manual installation**.
Once an approved Chrome Web Store listing is linked, its main button will open the store's normal
confirmed install flow, including in Brave. The extension has not been submitted to the store yet.

### Manual installation

Requires a Chromium-based browser using Chromium 116 or newer.

1. Download the extension ZIP from the installation website and unzip it to a permanent folder, or
   clone this repository. The installable ZIP has `manifest.json` directly at its root.
2. Open `brave://extensions` (or `chrome://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the folder that contains `manifest.json`.
5. Reload instagram.com and open a profile.

Tip: open profiles by navigating inside the site (search, links) rather than pasting a URL; that is when
the page loads the full-size picture data the extension reads.

## How it works

The extension uses the media data the site loads while you browse. Downloads and music playback load
the selected media file directly from the site's media servers. For a post you stop on (or download)
whose song or full video file the feed did not include, it asks the site for that post's details, the
same request the site makes when you open the post. One post at a time, with recent lookups deduplicated.
Caches retain up to 500 recent profiles, posts and story items each; an evicted post can be loaded
again when revisited. Requests time out and back off after HTTP 429. Large response copies are skipped
without affecting the website's original response.

- `intercept.js` runs in the page and reads the responses the site **already downloads for you** while you
  browse normally, looking only for profile picture, post, story and post music URLs, and asks for a
  post's details when the feed lacks them. It also reads song / original audio credits and whether a
  user follows you from those same responses; displaying them does not make additional requests.
  When you open a conversation, it turns on the flag in the site's own conversation request that
  asks Instagram to include the chat's theme (the website has this feature but may leave it off).
  No extra request is made; only that request's theme flag changes.
- `content.js` shows the buttons, audio credits, the follows-you label, chat themes and the viewer, using the data for the profile or post
  you are looking at.
- `music-player.js` first uses page audio, then switches to an extension-owned player if the page
  returns `NotAllowedError`. It keeps the same volume, clip position and play / pause controls.
- `offscreen.html` / `offscreen.js` provide that player using the browser's `offscreen` API with the
  `AUDIO_PLAYBACK` purpose. The document is bundled with the extension and loads only the selected
  audio file from the site's media servers. No website is embedded in it.
- `mp4fix.js` adjusts the frame timing of small 1 fps "photo + music" story videos before they are saved.
  Normal videos download directly without buffering a full copy in the tab. A fetched small story's
  bytes are reused even if no repair is needed, avoiding a duplicate full-file download.
- `background.js` saves requested downloads and routes audio commands from Instagram tabs to the
  internal player. Only one tab owns that player at a time; an old tab cannot stop a newer owner's song.

It only works with content the site itself already sent to your browser, so it cannot reveal anything you
could not already see, and it does not bypass private accounts or any other access restriction. Profile
pictures are publicly visible on Instagram, and the official mobile app already lets you view them in a
larger size.

## Website and store distribution

Run `python scripts/build_distribution.py` (Python 3.9+) to build `dist/ig-tools-v2.5.0.zip` and
`dist/site/`. The package contains only extension runtime assets, the license and privacy policy.
The GitHub Pages workflow builds this same ZIP and deploys the static site on main pushes. The
website has no analytics, third-party fonts or scripts, and no backend. GitHub serves the public site
and download, under its own hosting privacy policy.

Store submission text, original sample graphics and the remaining account steps are in
[store/PUBLISHING.md](store/PUBLISHING.md). Set the real published store URL in `distribution.json`
after approval; the site then switches its primary CTA. No account, fee, agreement acceptance or
Chrome Web Store publication has been performed by the build scripts.

## Privacy

This extension collects **no data at all**:

- No analytics, tracking, telemetry, or remote servers.
- Media URLs live in memory in the current tab and, during extension playback, the internal player.
  The player releases its audio source when paused or disconnected. The music volume is remembered
  in local storage on instagram.com; the extension does not upload it anywhere.
- Media and post-detail requests go directly to the site's servers using your browser's existing
  session where applicable. No browsing data is sent to the extension author or third-party services.
- Permissions are access to `www.instagram.com` (to show the buttons), `downloads` (to save a file
  when you ask it to), and `offscreen` (to play a song in an internal extension document).

See [PRIVACY.md](PRIVACY.md).

## Autoplay diagnostics and checks

After changing the extension, reload it in `brave://extensions`, then reload Instagram. Put a photo
post with a song mostly in view. The extension chooses the eligible post with the largest visible
area in the feed column. A new post takes over at 60% of the viewport height; photos shorter than this
must be fully in view. The current song continues on small scrolls while its photo is still visible
and remains the largest visible post. It pauses when the photo leaves the viewport completely or
another post becomes dominant, including while the next post's own song is loading. Native videos,
reels and visible posts with audio also pause extension music when they dominate, even before their
post details are available or they reach the 60% start threshold. Navigating away or hiding the tab
also pauses it.
Hidden dialogs do not exclude the feed. Visibility is checked on scroll, photo
intersection changes and every 600 ms while the tab is visible, to catch layout shifts.

After updating to 2.3.0, reload the extension and Instagram, and leave a music post in view without
clicking ♪. If page playback is blocked, extension playback should start automatically. Scroll between
posts and switch / close tabs to check that the song changes or pauses. In the page console,
`igtSongStatus()` reports focus changes, playback attempts,
success and error names such as `NotAllowedError`. It also prints an asynchronous `IG Tools music focus`
snapshot with extension version, viewport size, eligible / dominant post, block / pause state,
last playback error, browser user activation and candidate photo visibility. Candidate top / bottom
and viewport-only visibility distinguish offscreen posts from ancestor clipping; `clippedBy` shows
the clipping boxes if a photo inside the viewport is incorrectly reduced to zero visible area.
These diagnostics stay in the tab; the layout checks make no network requests of their own.
`audioEngine` is `page` or `extension`. A failed fallback is reported as a playback error; it does not
change browser settings. A 1.5-second heartbeat renews a six-second playback lease. Losing the tab or
connection pauses immediately when detected; the lease stops any orphaned audio within six seconds.
The browser closes the internal document after 30 seconds without audio, per the
[Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

Run `node --test tests/music-autoplay.test.js tests/extension-audio.test.js tests/resource-usage.test.js`
for playback, bridge and resource regression tests (70 tests). The owner confirmed initial playback
without a click and stopping in Brave with v2.3.0, and audio credits with v2.3.1. Future playback changes
should also be checked in a logged-in browser. See [Resource review](PERFORMANCE.md) for v2.3.2 limits,
validation and the scope of the checks. Playing music still uses data; usage depends on the source
files and the browser's buffering.

## Responsible use

- Use it for personal, non-commercial viewing only.
- Photos and videos belong to their owners and may be protected by copyright and personality/image rights.
  Do not republish, redistribute, or use other people's content without their permission.
- Stories are meant to be temporary. Do not keep or share someone else's story without their consent.
- Do not use this tool to harass, stalk, impersonate, or monitor anyone.
- You are responsible for complying with Instagram's Terms of Use and with the laws of your country.

## Disclaimer

This software is provided "as is", without warranty of any kind, under the [MIT License](LICENSE).
The author is not responsible for how it is used. It may stop working at any time if the website changes.
If you are a rights holder and have a concern about this project, please open an issue.

## License

[MIT](LICENSE)
