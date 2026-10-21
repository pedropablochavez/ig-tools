# HD Profile Picture Viewer

A small, unofficial browser extension for Chromium-based browsers (Brave, Chrome, Edge) that adds an
**"HD photo"** button to profile pages on instagram.com. Click it to view the profile picture of the
profile you are looking at in full size, and optionally save it.

> **Unofficial project.** Not affiliated with, endorsed by, or sponsored by Instagram or Meta Platforms, Inc.
> "Instagram" is a trademark of Meta Platforms, Inc. and is used here only to describe which website
> the extension works on.

## Features

- Floating **HD photo** button on profile pages.
- Full-size viewer with **Download** and **Open in new tab**. Press `Esc` or click outside to close.
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
  browse normally, looking only for profile picture URLs.
- `content.js` shows the button and the viewer, using the picture URL for the profile you are currently viewing.
- `background.js` only saves the image to your disk when you click **Download**.

It can only show a picture that the site itself already sent to your browser. That means it cannot reveal
anything you could not already see: it does not access private accounts, posts, stories, messages, or any
other content. Profile pictures are publicly visible on Instagram, and the official mobile app already lets
you view them in a larger size.

## Privacy

This extension collects **no data at all**:

- No analytics, tracking, telemetry, or remote servers.
- Nothing is stored or transmitted. Picture URLs live in memory in the current tab and disappear when you close it.
- The only permissions it requests are access to `www.instagram.com` (to show the button) and `downloads`
  (to save a picture when you ask it to).

See [PRIVACY.md](PRIVACY.md).

## Responsible use

- Use it for personal, non-commercial viewing only.
- Profile pictures belong to their owners and may be protected by copyright and personality/image rights.
  Do not republish, redistribute, or use other people's photos without their permission.
- Do not use this tool to harass, stalk, impersonate, or monitor anyone.
- You are responsible for complying with Instagram's Terms of Use and with the laws of your country.

## Disclaimer

This software is provided "as is", without warranty of any kind, under the [MIT License](LICENSE).
The author is not responsible for how it is used. It may stop working at any time if the website changes.
If you are a rights holder and have a concern about this project, please open an issue.

## License

[MIT](LICENSE)
