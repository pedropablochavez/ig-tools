# Installation website design review

## Desktop experience refresh — 2026-10-26

The owner requested a small redesign using `design-taste-frontend` and Vercel's
`web-design-guidelines`, with the argument centered on improving Instagram on PC.
The first screen now says **Instagram on PC. Made better.** Its supporting sentence
names follow-back checks, photo music, downloads and chat themes. The existing dark
neutral / bronze palette, system type, English UI and manual GitHub installation remain.

Direction: **The product performs**, seed **2000449599**, selected from Loud and flat,
The sentence is the layout and The product performs. Palette and type were kept;
no redraws. The existing guide and native FAQ are retained for this modest refresh
instead of adding draggable installation steps or an invented founder letter.

Idea: IG Tools' actual follow-back results and in-post controls become the evidence
for its desktop improvements. The live element is a three-way preview of non-followers,
photo music and the profile viewer. Preview and browser selections still have shareable
query parameters, keyboard controls and a useful no-JavaScript fallback.

Non-followers now leads the preview and has its own section covering scanning on the
own profile, Keep / whitelist, the verified filter, CSV export and profile follow labels.
The copy explains that this compares current lists and cannot date or prove a historical
unfollow. It never promises automatic unfollowing. A linked FAQ explains scan limits and
account risk; the anchor opens the native disclosure. Chat themes have their own section.
Privacy copy now includes the user-started list requests, local preferences and existing
conversation request flag. Extension runtime and policy files are unchanged.

The new `site/assets/nonfollowers-demo.png` renders the **shipped** `content.js` panel
and `content.css` with 3 fictional accounts. It contains no real user data or observed
scan outcome. `scripts/prepare_nonfollowers_asset.mjs` reproduces it using Node 22+
and a supplied absolute path to the taste skill's `scripts/lib/cdp.mjs` helper. Its
fixture blocks network access with CSP and never loads `intercept.js` or starts a scan.
The existing 4 product crops and original landscape artwork are retained. No found
images or clips were used, no external credits apply, and no fictional proof needs
to be replaced before launch: all sample accounts and media are explicitly labeled.

Render critique:

- Before: the music-only headline hid the newer desktop utilities. The sample landscape
  dominated the promise; mobile source notes consumed unnecessary space. Overall 7.4.
- Round 1: the new headline and non-followers panel communicate the broader product.
  Fixes: removed unrelated floating controls behind the panel, exported a real PNG,
  and retained concise sample / no-scan labels. The source note is now a single sentence.
- Final: the product's own result is the focal point; section shapes alternate between
  a split preview, tone field, explanatory columns, interface rows and native guide / FAQ.
  Design 8, usability 8.5, creativity 7, content 8.5; weighted overall **8.0** (self-assessed).
  Creativity is capped at 7 because a product-demo composition can suit other extensions.
  Small raster labels on narrow screens and repeated sample artwork remain limitations.

Validation:

- Source lint: 0 FAIL, 0 WARN. Browser inspector at 1440 / 768 / 390 CSS pixels:
  0 FAIL, 2 intentional WARNs: interface fragments instead of unrelated photography,
  and no honest recorded product video. Existing finite motion respects reduced motion.
- Desktop, tablet and mobile fold / page screenshots inspected visually.
- 74 browser checks passed, including all previews, URL state, browser selection by
  keyboard, clipboard success / failure, risk disclosure, privacy layout, 320px overflow,
  reduced motion, no-JavaScript and a temporary fixture for a future store link.
  Clipboard success is simulated; these are local site checks, not a logged-in IG test.
- All 118 extension regression tests pass. Distribution build and site JS syntax pass.
  Runtime ZIP remains 58,300 bytes with SHA-256
  `a57a141fea6ed42b9fcc0f8e6e8515215148ab35d67c45b4ecdcc010cc415adf`.
  Site artwork stays outside the extension ZIP. Store URL is still null.
- Vercel Web Interface Guidelines fetched from the upstream source for this review:
  https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
  `site/index.html`, `site/styles.css`, `site/app.js`: pass after review of labels,
  semantic controls, image dimensions, focus, native keyboard behavior, URL state,
  responsive content, contrast, reduced motion and finite interruptible animations.
  Sentence case follows taste's explicit house style, as in the prior design review.

The rest of this document records the previous design and its historical validation.

Reviewed on 2026-10-22 with the requested `design-taste-frontend` (tasteskill v2)
and `web-design-guidelines` skills. Extension behavior and version remain 2.3.3.

## Direction and idea

The draw offered Product performs, Split stage and Quiet instrument.
Selected **The product performs**, seed **1331020704**, with the **Lunar and bronze** palette.
The extension's actual in-post controls become the demonstration instead of decorative feature cards.
A switchable feed / profile preview shows the bundled UI; browser selection and address copying
make the installation guide work with the visitor's browser. All controls work with a keyboard.

The main composition takes precedence over the sheet's conflicting narrow, mostly empty hero
blueprint, following the sheet's priority order. Use readable product UI and a first-screen download.
Use the product's existing Segoe UI / system stack instead of fetching Switzer. No external fonts.
The unsigned privacy explanation replaces the founder-letter text; no founder quotation is invented.
Native details replace the question index implementation so every answer works without JavaScript.
No direction redraws were made.

## Assets and sample content

Four crops of existing screenshots show the actual bundled controls on a synthetic fixture:

- `site/assets/feed-demo.png`: post, song credits, pause and download controls.
- `site/assets/audio-demo.png`: audio credits in the post header.
- `site/assets/download-demo.png`: post download action.
- `site/assets/profile-demo.png`: full-size viewer.

Reproduce them with `scripts/prepare_site_assets.ps1`, after regenerating the store demos if needed.
The screenshots' source, `store/assets/`, uses original sample landscape artwork and fictional
`sample.creator`, `Daylight` and `Sample artist` metadata. The page labels this explicitly.
These are intentional examples, not real accounts or endorsements, and need no private-content
replacement before launch. No found photographs or clips are used; no external image credits apply.
Existing project licensing applies. The magnifier is the project's own icon, not Instagram branding.

## Render critique

ROUND 1 (static redesign)
Seen in one second: soundtrack headline and a large post demo.
Idea: demonstrate the controls next to the action they enable.
Live thing: browser picker; the preview was still awaiting interaction wiring.
Layout words by section: hero=split / showcase=rows / installation=call-response / privacy=letter / faq=index.
Scores: design 7 · usability 7 · creativity 7 · content 8 → overall 7.1 before caps.
Caps applied: inspector FAILs cap overall at 6.0.
Top three problems:
1. Desktop and tablet fold: headline wrapped into three lines. Shorten to Photos. With sound.
2. Desktop tail: privacy / FAQ / footer created two sparse screens. Tighten spacing and group FAQ on a tone field.
3. All widths: still page and inactive preview. Wire the preview and add finite entrances.

ROUND 2 (working redesign)
Seen in one second: Photos. With sound. and the bundled photo-post UI.
Idea: use the extension's own scroll-and-view functions as the presentation material.
Live thing: change feed / profile view; select a browser and copy its settings address.
Layout words by section: hero=split / showcase=rows / installation=call-response / privacy=letter / faq=index.
Scores: design 7.5 · usability 8 · creativity 7 · content 8 → overall 7.6.
Caps applied: creativity capped at 7; the demonstration approach also suits related browser tools.
Top three problems:
1. Desktop fold: final demo caption fell below the fold. Reduce hero top spacing by 28px.
2. Motion sampling saw only 9 moving elements. Slightly lengthen once-only entrances for a readable sequence.
3. Small screenshot labels are rasterized. Preserve their alt descriptions and readable explanatory captions.

ROUND 3 (final)
Seen in one second: a clear music claim and a real extension demo.
Idea: the actual bundled controls carry the claim; the guide carries installation through to the browser.
Live thing: switchable preview and browser-specific installation with address copying.
Layout words by section: hero=split / showcase=rows / installation=call-response / privacy=letter / faq=index.
Scores: design 7.5 · usability 8 · creativity 7 · content 8 → overall 7.6 (self-assessed, not an external award).
Caps applied: creativity capped at 7 because other utility extensions can share this demonstration model.
Top three problems: no remaining blocking issues; the repeated sample artwork and small labels within
screenshot crops limit visual richness. Captions and descriptions remain readable at every tested width.

## Verification

- Skill source lint: 0 FAIL, 0 WARN.
- Real Edge render inspection at 1440, 768 and 390 CSS pixels: 0 FAIL, 2 WARN.
- Both warnings are intentional: interface fragments rather than unrelated real-world photographs;
  no video because there is no honest recorded product clip. No autoplaying video or sound is fetched.
- Screenshots at all three widths and full-page sheets were visually reviewed.
- 45 browser checks: manual links, images, browser selection by keyboard, copy success / denial,
  preview changes, deep links, native FAQ, privacy layout, reduced motion, no-JavaScript fallback,
  and a fixture-only future approved-store flow. Clipboard success was simulated in the fixture.
- Existing extension regression suite: 70 passing tests. Site JavaScript syntax check passes.
- The four PNG assets total 85,261 bytes, all served locally. No framework, external font,
  third-party script, analytics, persistent animation loop or polling was added.
- Motion uses transform / opacity, runs once, respects reduced motion and finishes when the tab hides.
- Local build keeps the extension ZIP at 43,249 bytes, with the same local checksum as before this redesign.
  The website assets are outside the extension ZIP. The approved store URL remains null.

## Web Interface Guidelines review

Rules retrieved from the upstream source on the review date:
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

- `site/index.html`: pass after fixes; semantic controls, labels, image dimensions / alternatives,
  polite updates, skip link and heading hierarchy.
- `site/styles.css`: pass after fixes; contrast, focus states, responsive layout, touch targets,
  dark native controls and no motion dependency.
- `site/app.js`: pass after fixes; URL reflects browser / preview selections, finite animation,
  reduced-motion support, async error fallback and no telemetry.
- `site/privacy.template.html`: pass after fixes; shared styling, first skip link, complete policy,
  readable tables, accurate hosting disclosure.

Sentence case follows the taste skill's house style; the two skills disagree on title capitalization.
The native FAQ uses browser semantics rather than scripted tab behavior.
