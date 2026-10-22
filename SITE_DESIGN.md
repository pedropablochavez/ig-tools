# Installation website design review

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
