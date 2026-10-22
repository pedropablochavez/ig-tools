# Privacy Policy

**IG Tools (Unofficial)** does not collect, store, sell, or share any personal data.

- **No data collection.** The extension has no analytics, telemetry, tracking, or remote server.
- **Direct media and post-detail requests.** Inside your own browser tab, it reads the profile picture,
  post and story media URLs the website already loaded. Downloading a file or playing a post's song
  loads that media directly from the site's media servers. When the feed lacks a post's song or full
  video file, it may also ask Instagram for that post's details, with the same request the site makes
  when you open it. These requests use your browser's existing session where applicable; no browsing
  data is sent to the extension author or third-party services.
- **Audio credits.** Song titles, artists and original audio creators supplied by the page are displayed
  in post headers. These credits stay in the current tab; displaying them adds no requests or storage.
- **Internal audio player.** If a page requires a first click before playing sound, the extension may
  pass the selected audio URL, clip timing and volume to its own packaged offscreen document. Audio
  still loads directly from the site's media servers; no third-party service or embedded site is used.
  This does not change browser settings or collect page contents. Playback is paused when the post
  leaves view, another source takes over, or the tab is hidden / closed. A short lease also stops audio
  if the tab unexpectedly loses its connection.
- **Local preferences and temporary data.** Recent media URLs and bounded playback diagnostics are kept
  in memory in the current tab and, during audio playback, the internal player. Profile, post and story
  caches each retain up to 500 entries. Page data is discarded on tab close
  or reload; the player releases its audio source on pause or disconnection. The music volume preference
  is saved in local storage on instagram.com and is not uploaded by the extension.
- **Downloads.** When you click **Download**, the file is saved to your computer using your browser's
  download feature. Nothing is sent anywhere else.

## Permissions

| Permission | Why |
| --- | --- |
| `https://www.instagram.com/*` | To show the buttons and viewer on profiles, posts and stories. |
| `downloads` | To save a file to your computer when you click a download button. |
| `offscreen` | To play the selected post's music in a bundled extension document when page autoplay requires a click. |

## Contact

Questions or concerns: open an issue in this repository.
