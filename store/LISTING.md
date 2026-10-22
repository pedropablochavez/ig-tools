# Chrome Web Store submission copy

Status: prepared for the owner's first submission; **not published or approved**.

## Listing

- Name: IG Tools (Unofficial)
- Category: Tools (choose the closest available dashboard category)
- Language: English
- Homepage: https://pedropablochavez.github.io/ig-tools/
- Privacy policy: https://pedropablochavez.github.io/ig-tools/privacy.html
- Support: https://github.com/pedropablochavez/ig-tools/issues
- Package: build with `python scripts/build_distribution.py`; upload `dist/ig-tools-v2.3.3.zip`
- Short description: use the current manifest description (119 characters, within the 132 limit).

## Detailed description

Get a little more from the posts you already browse on instagram.com.

IG Tools (Unofficial) adds practical media controls to the desktop website:

• View profile pictures in full size, then open or save the best version available.
• Download a photo or video from a post. On a carousel, save the slide you are viewing.
• Save the current story with a dedicated download button.
• Hear music attached to photo posts automatically, using the clip selected by the author.
• See song titles, artists and original audio credits when the page provides them.
• Pause or resume music, adjust volume and let playback follow the visible post.

Playback stops when the post leaves view, another post takes over or the tab is hidden. A bundled
extension audio player handles browsers that require a first click for webpage audio.

The extension reads media data the website supplies to your session. For missing song or full-video
details, it can request the same individual post information the website uses. It does not unlock
private accounts, bypass access restrictions, or make unavailable media downloadable.

No analytics, advertising, telemetry or developer servers. Temporary media caches are bounded.
Only the music volume preference is remembered locally. Media and music still use your connection;
they load directly from the original media servers. Larger story videos are downloaded without the
optional timing repair to limit in-memory processing.

Free and open source. Built for current desktop Chromium browsers, including Brave and Chrome.

This is an independent, unofficial project, not affiliated with, endorsed by, or sponsored by Instagram
or Meta Platforms, Inc. Instagram is a trademark of Meta Platforms, Inc. Use downloaded media for
personal, lawful purposes, respect copyright and privacy, and follow the site's terms.

## Single purpose

Provide media viewing, saving and playback controls for the Instagram content the user can already
access in their own desktop browser session.

## Permission justifications

### Host: https://www.instagram.com/*

Run bundled content scripts on the supported website to read already-loaded media metadata, display
full-size profile pictures and audio credits, attach user-initiated download controls and select the
visible post for playback. Missing media details are requested from the site's same-origin single-post
endpoint. No other website access is requested.

### downloads

Save a media file only when the user clicks a download control. Downloads go to the browser's normal
download system. For small story videos, the extension may pass a locally repaired video as a data URL.

### offscreen

Play a visible photo post's attached music in a bundled AUDIO_PLAYBACK document if the page rejects
audio because no initial gesture occurred. This document loads only the selected original media file.
It does not embed a website, record audio or send data to the developer. Playback has one owner and
stops when the tab leaves the post, hides, disconnects or loses its heartbeat.

## Privacy practices

- Remote code: **No**. All executed JavaScript is bundled. Fetched JSON and media are data, not code.
- Developer collection / transfer: **None**. No analytics, accounts, tracking or external backend.
- Local processing: website media / credits and diagnostic data in temporary memory; volume in local
  storage on instagram.com. Files are saved at the user's request.
- The owner must read and certify the dashboard's current privacy disclosures personally, keeping
  answers consistent with PRIVACY.md. No certification or developer agreement has been accepted here.

## Reviewer testing notes

1. Install the ZIP and sign in to an Instagram test account you control. No credentials are provided
   or collected by this extension. Do not send the developer a password or session token.
2. Open a profile via normal site navigation. Click HD photo and use the viewer.
3. Visit a feed or post with a photo, a carousel, a video or a story. Click the added download control.
4. Find a photo post whose author attached music. When it becomes dominant and eligible in the
   viewport, its clip plays without clicking the page; the ♪ control pauses / resumes it. Scroll to
   the next post and hide the tab to check playback stops or changes. Data availability depends on
   the content the site sends to that account.
5. Confirm the extension shows song / original audio credits when available and does not request
   access to unrelated domains. No remote executable code, browsing-history permission or analytics.

Store images use sample artwork and clearly label illustrative demos. Extension controls in the demo
screenshots are rendered from the bundled content script; sample accounts and media are fictional.
