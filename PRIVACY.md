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
- **Follows-you label.** On another person's profile, the extension shows whether that account follows
  you, using the relationship the profile page already loaded. It makes no extra request, and this
  status is kept only in memory in the current tab (up to 500 recent profiles).
- **Non-followers scan.** Only on your own profile and only after you press **Start scan**, the
  extension requests the pages of your own Followers and Following lists from Instagram using those
  list endpoints, requesting 50 accounts per page (larger than the website's observed 12-account pages).
  It makes one request at a time, 1.3–2.3 seconds apart, with an extra 5–15 second break every 15
  requests, at most 300 requests. These requests use your existing session and go only to instagram.com. It
  compares the two lists in the current tab and shows the accounts that do not follow you back. The
  lists and results are kept only in memory in that tab and are discarded on reload or close; they
  are not stored or sent to the extension author or third parties. **Export CSV** saves a file to your
  computer through your browser's download feature. If Instagram answers with a rate limit, a block or
  an error, the scan stops and the extension pauses its own requests for 1–15 minutes. Instagram may
  restrict accounts for automated activity; this risk is yours and the feature is optional.
- **Selected unfollows.** After a completed scan, you can select accounts and review them with
  **Unfollow selected**. Only pressing **Confirm unfollow** sends Instagram's own unfollow mutation
  for those selected account ids, using your existing session. This changes who you follow. Session
  tokens are read locally from the loaded page / its requests, used only with instagram.com, and
  never saved to persistent storage or logged by this feature. One request runs at a time, 4–4.8 seconds apart, with an
  extra 5-minute break every 5 accounts. Cancel stops remaining requests; a request already sent
  may still complete. Rate limits, blocks, errors and unconfirmed outcomes stop the batch with no
  automatic retry. Operation progress and confirmations stay in tab memory only. Following a private
  account again may require its owner's approval; Instagram may restrict automated actions.
- **Non-followers whitelist.** Accounts you mark with **Add to whitelist**, individually or together (their account id and username), and
  your "Show verified accounts" choice are saved in the extension's own local storage on your
  computer, so they apply to later scans. Instagram's pages cannot read this storage, and it is never
  sent anywhere. You can remove entries in the panel's Whitelist view; uninstalling the extension
  deletes it. At most 5,000 accounts are kept.
- **Chat themes.** When you open a direct-message conversation, the extension turns on the flag in the
  website's own conversation request that asks Instagram to include that chat's theme. No other
  request is made and nothing else in the request changes. The theme's colors and background image
  (loaded from Instagram's media servers) are shown only in your tab and kept in memory for up to
  200 recent conversations. Message contents are not read for this feature. If Instagram answers that
  request with an error, the extension stops setting the flag for 24 hours and stores only that retry
  time in local storage on instagram.com.
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
| `https://www.instagram.com/*` | To show the buttons and viewer on profiles, posts and stories, read your own lists when you start a scan, and unfollow selected scan results only after confirmation. |
| `downloads` | To save a file (media, or the non-followers CSV) to your computer when you click a download / export button. |
| `offscreen` | To play the selected post's music in a bundled extension document when page autoplay requires a click. |
| `storage` | To remember the non-followers whitelist and the "Show verified accounts" choice on your computer. |

## Contact

Questions or concerns: open an issue in this repository.
