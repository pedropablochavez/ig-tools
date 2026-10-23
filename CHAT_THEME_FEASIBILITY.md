# Chat theme feasibility check

Checked on 2026-10-22 in the owner's authenticated Brave session (extension v2.4.0), using a
temporary page probe on `/direct/`: copies of fetch / XHR responses, embedded JSON, WebSocket message
events, and a text search of the site's own already-loaded JavaScript. Only conversations the owner
named or already-read conversations were opened. No message content is recorded here.

## Passive result

The theme cannot be read passively for this account. The web client has a chat theme implementation,
but its conversation query only selects the theme when an Instagram experiment is on:

```text
as_ig_direct_thread.theme_data            (IGDirectLoadableThreadTheme)
as_ig_direct_thread.theme_data.alternative_themes
```

is guarded by a Relay `Condition` on the provider `IGDEnableOffMsysChatThemesQE` (`passingValue: true`).
`require('IGDEnableOffMsysChatThemesQE.relayprovider').get()` returned `false`, so the request was
sent with `__relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider: false` and no response
contained `theme`. WebSocket frames were keep-alives only. The details panel had no theme option.

## Test with the flag enabled (owner-approved)

The owner approved a temporary test in the group chat that has a theme. With the provider forced to
`true` in the page, the site's own conversation query (`POST /api/graphql`, persisted `doc_id`) was
sent with that variable `true` and returned HTTP 200 with:

```text
data.get_slide_thread_nullable.as_ig_direct_thread.thread_key   = the id in /direct/t/<id>/
data.get_slide_thread_nullable.as_ig_direct_thread.theme_data   = theme (null for chats without one)
```

`theme_data` (and each `alternative_themes[]` entry, one per color mode) had `app_color_mode`
(`NORMAL` / `DARK`), ARGB hex colors (`gradient_colors[]`, `incoming_message_bubble_color`,
`inbound_message_text_color`, `outbound_message_text_color`, `thread_background_color`,
`navigation_bar_*`, `composer_*`, `fallback_color`) and `thread_background_asset.url_480 / url_1024`
on fbcdn.net. A chat without a theme returned `theme_data: null`; another returned a non-null theme.

The site did not render the theme itself even with the flag on. Its stylesheets do use color
variables: setting `--chat-outgoing-message-bubble-background-color`, `--ig-outgoing-message-bubble`,
`--chat-incoming-message-bubble-background-color` and `--ig-incoming-message-bubble` on the
conversation pane recolored bubbles. Text colors are not variables (outgoing text stayed white on a
light bubble). The atomic class painting each bubble color was found by giving each class of a
matching bubble to a test element and comparing its computed background. A background image on the
message list's (non-scrolling) parent covered the pane without moving with the messages.

No chat-level song field was found; music names in the bundles belong to music stickers sent as
messages, which the website already plays.

## Implementation (v2.5.0)

`intercept.js` changes only that one variable from `false` to `true` in request bodies containing it
(XHR and string fetch bodies); everything else is re-serialized unchanged. It publishes
`{ thread: thread_key, theme: { variants } | null }` as `ighd-themes`, keeping only valid ARGB colors
and HTTPS Instagram CDN images. `content.js` applies the variant matching the site's color scheme
(`__fb-dark-mode` / `color-scheme`) to the open `/direct/t/<id>/` chat and restores the page when
leaving it. This depends on internal names (`IGDEnableOffMsysChatThemesQE`, the CSS variables) that
Instagram can change without notice.
