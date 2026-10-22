# First publication

GitHub Pages hosts the installation page; the Chrome Web Store supplies the normal confirmed install
flow. A downloaded ZIP cannot silently install itself from a website. Brave can install from the same
Chrome Web Store listing.

## Prepared here

- `site/`: static, responsive landing page with no third-party fonts, scripts or analytics.
- `scripts/build_distribution.py`: creates a minimal extension ZIP with manifest.json at the root,
  plus a static site with that ZIP, a checksum and privacy policy generated from PRIVACY.md.
- `store/LISTING.md`: listing text, single purpose, permission explanations and reviewer notes.
- `store/assets/`: prepared store graphics; inspect before submitting.
- `.github/workflows/pages.yml`: test, build and publish the site on main pushes.

## Owner steps that require an account

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Register a developer account using a public-facing email you choose. Google requires a one-time
   registration fee and acceptance of its developer agreement; do this personally. Registration was
   not performed, paid or accepted by Codex. Do not put account credentials or tokens in this repo.
3. Run `python scripts/build_distribution.py`, choose New item and upload the generated ZIP under dist/.
4. Use LISTING.md, the supplied images and the live Pages / privacy URLs for the listing. Inspect all
   images, read the dashboard's current questions and certify accurate privacy disclosures yourself.
5. Complete Google's account / distribution requirements and submit for review. Approval is controlled
   by Google; it is not guaranteed and no review time is promised here.
6. After the listing is public, copy its full `https://chromewebstore.google.com/detail/...` URL into
   `distribution.json` as `chrome_web_store_url`, replacing null. Commit and push. The Pages build
   switches the real primary button from Download extension to Install from Chrome Web Store.
7. Test that public link in Brave and Chrome. Installation still requires the browser's confirmation.

Until then, the site clearly offers manual installation and does not pretend a ZIP is a store install.
Update images / listing copy if behavior changes, and increase the extension version before future
store uploads. GitHub Pages receives the current ZIP on every successful main build.

## Source references

- [Extension ZIP and 132-character description](https://developer.chrome.com/docs/webstore/prepare)
- [Required 440×280 promotional image and 1280×800 screenshots](https://developer.chrome.com/docs/webstore/images)
- [Registration and developer fee](https://developer.chrome.com/docs/webstore/register)
- [Permission and privacy declarations](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Installation distribution constraints](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)
- [Brave store installation](https://support.brave.app/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave)
