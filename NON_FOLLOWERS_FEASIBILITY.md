# Non-followers scan: feasibility (2026-10-22)

Goal: on the owner's own profile, a "Scan non-followers" button that lists accounts the owner
follows that do not follow back. The initial v2.6.0 scope was informational only. On 2026-10-26
the owner requested and clarified selected unfollows in v2.6.4; this supersedes that earlier scope.

## Selected unfollows (v2.6.4, 2026-10-26)

The owner's new request adds per-account selection, batch Add to whitelist, and Unfollow selected
with an explicit review / confirmation. The latest completed own-account scan defines eligible
targets; no arbitrary account ids, duplicate ids or cross-account results are accepted. One
website GraphQL `usePolarisUnfollowMutation` per selected account, sharing the existing serial
queue / cooldown. Session tokens come from the loaded page only and remain in memory.

Pacing uses the reference's unfollow defaults (separate from reading lists): 4–4.8 seconds between
accounts plus 5 minutes after every 5 when another remains. Cancel stops remaining requests,
including interrupting pauses; a request already sent may still complete. Errors / blocks / 429
or uncertain responses stop without retrying. Success requires explicit relationship confirmation;
unknown 2xx responses are not counted as successful and there is no extra verification search.

This changes relationships and can incur action limits. Re-following a private account may need
approval. Review copy, README, privacy policy, listing and site disclose this behavior. Verification
uses synthetic requests and offline headless Brave UI only; no real relationship was changed.

Status: historical review. b1 shipped in v2.6.0 after owner approval. The owner requested the
reference tool's scan speed on 2026-10-26; v2.6.3 supersedes b1's page size and pacing as follows.

## Faster scan (v2.6.3, 2026-10-26)

- Requests 50 accounts per page on the same own-account list endpoints; actual server cursors are
  followed unchanged even if Instagram returns fewer accounts. No parallel requests.
- Matches the reference's default pacing: 1.3–2.3 seconds between requests, plus a 5–15 second
  break after every 15 requests if another page remains. Cancel interrupts either wait.
- For 879 followers / 1,074 following, full 50-account pages mean 18 + 22 = 40 requests. Average
  scheduled waits total about 90 seconds, plus network time (roughly 2 minutes). This is an estimate,
  not a measured logged-in result or a guarantee of server page sizes / response time.
- Keeps own-profile trusted Start, shared serial queue / cooldown, 300-page cap, memory-only
  results, and full stop on 429 / block / error with no automatic retry. Also stops on repeated
  cursors, explicitly incomplete pagination, and either list's restriction flag.
- The page size differs from the observed website requests. Fewer requests do not establish lower
  account risk; no attempt was made to provoke a rate limit or block.
- Reference source inspected on 2026-10-26:
  [page size and timing defaults](https://github.com/davidarroyo1234/InstagramUnfollowers/blob/master/src/constants/constants.ts)
  and [request pacing](https://github.com/davidarroyo1234/InstagramUnfollowers/blob/master/src/main.tsx).

The remainder records the original v2.6.0 review and its earlier constraints, not the current timings.

## What the website does (observed)

Observed in the owner's logged-in Brave (Claude in Chrome) by opening the Followers and Following
dialogs on the owner's profile and scrolling by hand. A temporary probe wrapped `XMLHttpRequest` to
copy responses of `/api/v1/friendships/` requests; it made no requests of its own and was removed by
closing the tab. Only structure and field names were recorded, not account data.

Each page of either dialog costs the site **two** requests:

1. `GET /api/v1/friendships/<own pk>/followers/?count=12&search_surface=follow_list_page`
   then `...&max_id=<cursor>&...` for later pages.
   `GET /api/v1/friendships/<own pk>/following/?count=12` (first page seen without
   `search_surface`), later pages with `max_id`.
   - Response: `users` (12), `page_size: 12`, `has_more`, `next_max_id`, `big_list`,
     `follow_ranking_token`, `should_limit_list_of_followers` / `..._followings` (false),
     `hidden_following_account_count` (0, following only), `status: "ok"`.
   - Cursor: followers `next_max_id` is an opaque ~120-character string; following uses a short
     numeric offset (`"12"`, `"24"`, ...).
   - User fields: `pk`, `pk_id`, `id`, `username`, `full_name`, `profile_pic_url`,
     `profile_pic_id`, `is_private`, `is_verified`, `has_anonymous_profile_picture`,
     `account_badges`, `latest_reel_media`, `fbid_v2`, `strong_id__`,
     `third_party_downloads_enabled`, and `is_favorite` (following only).
2. `POST /api/v1/friendships/show_many/` ~170 ms later, body `user_ids` (the 12 pks), `fb_dtsg`,
   `jazoest`. Returns `friendship_statuses[pk]` with `following`, `incoming_request`,
   `outgoing_request`, `is_bestie`, `is_feed_favorite`, `is_private`, `is_restricted`,
   `text_post_app_pre_following`. **There is no `followed_by`**, so this request does not help:
   whether someone follows you back can only be learned by also reading the followers list.

Headers on both: `x-ig-app-id: 936619743392459`, `x-asbd-id`, `x-csrftoken`, `x-ig-www-claim`,
`x-web-session-id`, `x-requested-with: XMLHttpRequest`, `x-ig-max-touch-points`; `show_many` adds
`x-instagram-ajax`. `intercept.js` already records the site's `x-` headers (`noteApiHeaders`).

During hand scrolling the site loaded a new page every ~5–11 s.

## Owner's numbers and estimates

Profile header on 2026-10-22: **879 followers, 1,074 following** (to be confirmed by the owner).

| Approach | Requests | Estimated time |
| --- | --- | --- |
| a) Passive, owner scrolls both dialogs | 0 by the extension (the site makes 74 + 90 list pages, plus 164 `show_many`) | ~10–15 min of manual scrolling |
| b1) Active, identical to the website (`count=12`) | 74 + 90 = **164** GETs, no `show_many` | 164 × (2–4 s + ~0.3 s) ≈ **9 min** |
| b2) Active, InstagramUnfollowers style (`count=50`) | 18 + 22 = **40** GETs | 40 × (2–4 s + ~0.5 s) ≈ **2–3 min** |

## Reference: InstagramUnfollowers (davidarroyo1234)

Read from the repository source (HEAD of 2026-10-18), not run:

- It is a script pasted into the console / bookmarklet, not an extension.
- It walks `/api/v1/friendships/<ds_user_id>/followers/` and then `/following/` with
  `count=50` and `max_id`, headers `X-IG-App-ID`, `X-ASBD-ID` (hard-coded, older value),
  `X-CSRFToken`, `X-Requested-With`. No `search_surface`, no `x-ig-www-claim`.
- It compares by id (`pk`, `pk_id`, `id`) and also by lowercase username.
- Pacing: 0.3–1 s + ~1–1.3 s between pages, plus a ~5–15 s pause every 15 requests;
  250-page cap per list.
- On 429 / `feedback_required` / `checkpoint` / network errors it **retries automatically**
  up to three times (30 / 60 / 90 s waits). It also has an unfollow feature (GraphQL mutation).
- An earlier version used a legacy GraphQL `query_hash` for `edge_follow`; its own comments say
  Instagram now answers that hash with empty lists, which is why it moved to the REST endpoints.

What can be reused: the same endpoints and comparison idea. What must not be copied for this task:
automatic retries after 429 / blocks, the unfollow feature, the faster pacing, persistence of results
in localStorage, and running on other accounts' lists (`userId` parameter).

## Approach a) passive

`intercept.js` already sees every XHR response. Add a collector for
`/api/v1/friendships/<own pk>/(followers|following)/` responses only (own pk = `ds_user_id`),
accumulate users by `pk` in tab memory, and track whether each list reached `has_more: false`.
The button shows progress ("Following 340 / 1,074") and asks the owner to scroll both dialogs to the
end; the result appears only when both lists are complete.

- Pros: zero requests by the extension; traffic is exactly what a person scrolling produces;
  keeps the "Passive first" rule; no new section needed in the store disclosures beyond
  "reads lists you open".
- Cons: tedious (164 pages of scrolling); the dialog can stall or the owner may close it early
  (the result then says "incomplete" instead of guessing); still reads data the site loaded, so the
  privacy disclosures need one line.

## Approach b) active

`intercept.js` (MAIN world) walks both lists of the logged-in account itself, only after a click
on the button on the owner's own profile:

- One request at a time, followers then following, random 2–4 s between pages, total page cap
  (proposal: 300 pages, ~3,600 accounts at `count=12`; larger accounts get an "account too large"
  message rather than a partial result presented as complete).
- Same headers the site sends (`apiHeaders` copy), same query string as observed.
- Cancel button; reloading or closing the tab also stops it. (Implemented in v2.6.0: at the owner's
  request the scan keeps running while browsing elsewhere in the same tab.)
- Any 429, non-2xx, non-JSON, `status: "fail"`, `feedback_required` / `checkpoint` / `spam`, or
  network error stops the scan for good and shows when to retry. It reuses and extends the 429
  cooldown in `intercept.js` (`retryAfterUntil`, 60 s – 15 min), which would then also pause post
  detail lookups. No automatic retries.
- Comparison by `pk` only. Results in tab memory; CSV export via `background.js` download.

b1 vs b2: b1 sends exactly the website's request (`count=12`) and is indistinguishable per request,
but makes 4× more requests. b2 makes far fewer requests but uses a page size the web client does not
send. Which one Instagram weighs more is not publicly documented; no approach can be called "safe".

## Risks

- **Instagram Terms of Use** forbid collecting information in an automated way without permission.
  Approach b does that for the user's own lists; approach a does not make requests but still
  processes the loaded lists. Enforcement is Instagram's decision and is not predictable.
- **Account risk (owner and every extension user):** temporary "Try again later" action blocks,
  forced logout or checkpoint (verify by phone / email), and in rare repeated cases restrictions or
  disablement. Reading lists is generally treated less severely than follow / unfollow automation,
  but AGENTS.md already records HTTP 429 from self-made user requests. Risk grows with list size,
  repetition (several scans a day) and accounts that already had warnings.
- **Users of the extension:** every user who presses the button takes the same risk with their own
  account; the UI must say so before the first scan, and the page cap limits the worst case.
- **Correctness:** lists change while scanning; accounts that are deactivated, restricted or hidden
  may appear in one list and not the other; Instagram may limit long lists
  (`should_limit_list_of_*`). The result is an approximation, labelled as such.
- **Privacy:** nothing leaves the browser; no storage; CSV is a local download chosen by the user.
- **Chrome Web Store review:** a feature that automates reading Instagram data with the user's
  session can draw extra scrutiny (single purpose, user-data disclosures, third-party ToS concerns).
  Several "unfollowers" extensions exist, but approval cannot be promised. The listing must disclose
  the new requests and their purpose accurately.

## Recommendation

If the lowest account risk matters most: **a) passive**. If convenience matters: **b1**, because it
matches the owner's own rule ("exactly the same request the website uses") and the existing
header-copy code, at ~9 minutes for this account. b2 (the referenced repository's page size) is
faster but deviates from the web request; not recommended unless the owner prefers fewer requests
over request fidelity.
