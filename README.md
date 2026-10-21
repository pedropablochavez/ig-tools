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
- **♪ Music** on photo posts that have a song attached (as in the mobile app): like reels, the song of the
  post you are looking at plays (the exact clip the author picked, in a loop) and stops when you scroll to
  another post. A floating ♪ button on the photo pauses / resumes it, with a volume slider that shows on
  hover (remembered). The feed often lacks the song; see *How it works* for how it is found.
- Fixes "photo + music" stories (a still image turned into a 1 fps video), which in some players stay
  black for ~10 seconds: the frame timing is adjusted so the picture shows right away. Image and audio are
  not re-encoded.
- No third-party websites, no ads, no copy-pasting links.

## Install (developer mode)

1. Download this repository (**Code → Download ZIP**) and unzip it, or `git clone` it.
2. Open `brave://extensions` (or `chrome://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the folder that contains `manifest.json`.
5. Reload instagram.com and open a profile.

Tip: open profiles by navigating inside the site (search, links) rather than pasting a URL; that is when
the page loads the full-size picture data the extension reads.

## How it works

The extension does not scrape anything. Besides the photo or video you click to download, the only
request it makes is for a post you stop on (or download) whose song or full video file the feed did not
include: it asks the site for that post's details, the same request the site makes when you open the post.
One post at a time, each only once per visit.

- `intercept.js` runs in the page and reads the responses the site **already downloads for you** while you
  browse normally, looking only for profile picture, post, story and post music URLs, and asks for a
  post's details when the feed lacks them.
- `content.js` shows the buttons and the viewer, using the URLs for the profile or post you are looking at.
- `mp4fix.js` adjusts the frame timing of 1 fps "photo + music" videos before they are saved.
- `background.js` only saves a file to your disk when you click a download button.

It only works with content the site itself already sent to your browser, so it cannot reveal anything you
could not already see, and it does not bypass private accounts or any other access restriction. Profile
pictures are publicly visible on Instagram, and the official mobile app already lets you view them in a
larger size.

## Privacy

This extension collects **no data at all**:

- No analytics, tracking, telemetry, or remote servers.
- Nothing is stored or transmitted. Picture URLs live in memory in the current tab and disappear when you close it.
- The only permissions it requests are access to `www.instagram.com` (to show the buttons), `downloads`
  (to save a file when you ask it to).

See [PRIVACY.md](PRIVACY.md).

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
