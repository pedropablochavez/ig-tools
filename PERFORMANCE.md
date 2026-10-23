# Resource review — v2.3.2

The review found and corrected avoidable memory growth, duplicate video downloads, repeated idle
DOM updates, retained observers and requests without a network timeout. This is a bounded-resource
design and a regression check, not a guarantee against browser, driver or operating-system crashes.

## Limits and behavior

| Resource | Limit / behavior |
| --- | --- |
| Profile, post and story caches | 500 recent entries each; evicted post data may be loaded again on revisit |
| Request history / diagnostics | 2,000 recent lookup codes; 200 deduplicated logs, 60 displayed log lines, 200 music-field records, 1,000 recent profile-stat usernames |
| Own post-detail requests | One active request per tab; at most six active / queued jobs, duplicates share a job |
| Automatic lookup scheduling | Posts on screen or up to one screen below; closest first; up to five candidates; far / stale / hidden candidates are dropped and may be asked again; at most 20 look-ahead and 30 total lookups per rolling minute |
| Request timeout | Eight seconds for a detail fetch / response reader; content waiters remove themselves after ten seconds |
| HTTP 429 | Respect Retry-After with a cooldown between one and fifteen minutes; no automatic retry loop |
| Block / verification answers | checkpoint, feedback_required, challenge, "try again later", redirects or HTML pages stop own requests for fifteen minutes |
| Passive fetch inspection | At most two concurrent response copies, up to 4 MiB each; the site's original response stays readable |
| JSON processing | Oversized embedded / XHR text is skipped above 4,194,304 code units; 20,000 node / field visits per response and 100 newline-delimited documents |
| Ordinary video download | Direct browser download; no full-file copy in the tab |
| Story timing repair | One file at a time, declared size up to 8 MiB; 15-second fetch timeout; streamed size is checked too |
| Unsupported / large story | Download the original file without timing repair; an initial probe is aborted at the headers |
| Audio | One player per tab, or one shared extension player; metadata preload; sources released on pause, tab hiding / closure |
| Detached DOM | Post and music observers are removed when their nodes leave the document |
| Idle / background work | Unchanged icons are not rewritten; hidden tabs skip UI scans / sync and automatic detail lookups |

The raw-file limit is not a total JavaScript heap limit. Repair and data-URL conversion create
temporary copies; browser media buffers and Instagram's own page memory are separate. Only small
story downloads use this path. A story already fetched for repair reuses the same bytes even if it
does not need repair, avoiding a second complete transfer. MP4 nesting, boxes, tracks and timing /
offset tables also have processing limits; unsupported files are saved unchanged.

## Validation

- `node --test tests/music-autoplay.test.js tests/extension-audio.test.js tests/resource-usage.test.js`:
  **70 passing tests**, including no-click playback, source release, clip handoff, bounded caches,
  serialization, cancellation, HTTP 429 cooldown, response-copy isolation, timeouts, downloads and
  malformed MP4 input.
- Simulated arrival of 10,000 posts, profiles and stories retained 500 entries per cache.
- A local headless Chromium fixture with 500 live posts / observed media verified audio-header
  insertion, no idle child-list mutations during a 1.3-second observation window, and cleanup to
  one tracked post / media box after removing the other 499 posts. Media and network behavior were
  simulated; the fixture did not use an Instagram account. Virtual browser time was used, so these
  checks are not CPU or wall-clock performance measurements.
- JavaScript syntax checks and `git diff --check` passed.

## Remaining data use

Autoplay necessarily downloads audio from the original media servers. The browser may buffer more
than the author's selected clip; the extension cannot promise a fixed MB/hour budget. Instagram's
own images / reels and user-requested downloads also consume data. Passive response inspection does
not make another HTTP request. No telemetry, analytics, external service or new permission was added
by this resource review.

The owner confirmed autoplay and stopping in Brave with v2.3.0 and the audio-header display with
v2.3.1. The v2.3.2 changes passed automated and synthetic browser checks; this review does not claim
a long-duration measurement in every user's hardware or logged-in session.
