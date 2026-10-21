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
  streamed version of a video, it briefly opens the post so the site loads the full file, downloads it, and
  takes you back.
- **Download** button in the story viewer, next to like / share (or a floating button on your own stories).
  It saves the photo or video being shown.
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

The extension is **passive**. It does **not** call any API, scrape, or send any request of its own.

- `intercept.js` runs in the page and reads the responses the site **already downloads for you** while you
  browse normally, looking only for profile picture, post and story media URLs.
- `content.js` shows the buttons and the viewer, using the URLs for the profile or post you are looking at.
- `background.js` only saves a file to your disk when you click a download button.

It only works with content the site itself already sent to your browser, so it cannot reveal anything you
could not already see, and it does not bypass private accounts or any other access restriction. Profile
pictures are publicly visible on Instagram, and the official mobile app already lets you view them in a
larger size.

## Privacy

This extension collects **no data at all**:

- No analytics, tracking, telemetry, or remote servers.
- Nothing is stored or transmitted. Picture URLs live in memory in the current tab and disappear when you close it.
- The only permissions it requests are access to `www.instagram.com` (to show the buttons) and `downloads`
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
