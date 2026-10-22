"""Build a minimal store/upload ZIP and a self-contained GitHub Pages site (stdlib only)."""
from pathlib import Path
import hashlib
import html
import json
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dist"
SITE = OUT / "site"


def inline(text):
    text = html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    return re.sub(r"`([^`]+)`", r"<code>\1</code>", text)


def policy_html(markdown):
    """Render the trusted policy's paragraphs, bullet list and permissions table."""
    blocks = []
    for block in re.split(r"\n\s*\n", markdown.strip()):
        if block.startswith("# "):
            continue
        if block.startswith("## "):
            blocks.append(f"<h2>{inline(block[3:])}</h2>")
        elif block.startswith("- "):
            items = re.split(r"\n- ", block[2:])
            blocks.append("<ul>" + "".join(f"<li>{inline(item.replace(chr(10), ' '))}</li>" for item in items) + "</ul>")
        elif block.startswith("|"):
            rows = []
            for i, line in enumerate(block.splitlines()):
                if i == 1:
                    continue
                tag = "th" if i == 0 else "td"
                cells = line.strip().strip("|").split("|")
                rows.append("<tr>" + "".join(f"<{tag}>{inline(cell.strip())}</{tag}>" for cell in cells) + "</tr>")
            blocks.append("<table>" + "".join(rows) + "</table>")
        else:
            blocks.append(f"<p>{inline(block.replace(chr(10), ' '))}</p>")
    return "\n".join(blocks)


def build():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    if not re.fullmatch(r"\d+(?:\.\d+){1,3}", version) or len(manifest["description"]) > 132:
        raise ValueError("Invalid store version or description longer than 132 characters")
    distribution = json.loads((ROOT / "distribution.json").read_text(encoding="utf-8"))
    store_url = distribution.get("chrome_web_store_url")
    if store_url is not None and not re.fullmatch(r"https://chromewebstore\.google\.com/detail/(?:[^/]+/)?[a-p]{32}", store_url):
        raise ValueError("Supply the actual published Chrome Web Store URL, or null")

    files = {"manifest.json", "LICENSE", "PRIVACY.md", "offscreen.html", "offscreen.js"}
    files.update(manifest["icons"].values())
    files.add(manifest["background"]["service_worker"])
    for script in manifest["content_scripts"]:
        files.update(script.get("js", []))
        files.update(script.get("css", []))
    for name in files:
        source = (ROOT / name).resolve()
        if not source.is_relative_to(ROOT) or not source.is_file():
            raise ValueError(f"Missing or unsafe package path: {name}")

    OUT.mkdir(exist_ok=True)
    # Validate resolved targets before removing our own previous site output on Windows.
    if not OUT.resolve().is_relative_to(ROOT) or SITE.resolve().parent != OUT.resolve():
        raise ValueError("Output path leaves this workspace")
    if SITE.exists():
        shutil.rmtree(SITE)
    shutil.copytree(ROOT / "site", SITE)
    (SITE / "assets").mkdir(exist_ok=True)
    shutil.copyfile(ROOT / "icons/icon128.png", SITE / "assets/icon128.png")

    package = OUT / f"ig-tools-v{version}.zip"
    with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(files):
            entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, (ROOT / name).read_bytes())
    with zipfile.ZipFile(package) as archive:
        if archive.testzip() or "manifest.json" not in archive.namelist():
            raise ValueError("Invalid extension archive")
        if any(name.startswith(("site/", "tests/", ".git/")) for name in archive.namelist()):
            raise ValueError("Development files leaked into the extension ZIP")

    (SITE / "downloads").mkdir(exist_ok=True)
    shutil.copyfile(package, SITE / "downloads/ig-tools.zip")
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    (SITE / "downloads/SHA256SUMS.txt").write_text(f"{digest}  ig-tools.zip\n", encoding="utf-8")
    config = {"version": version, "zipBytes": package.stat().st_size, "chromeWebStoreUrl": store_url}
    (SITE / "config.js").write_text("window.IG_TOOLS = " + json.dumps(config) + ";\n", encoding="utf-8")
    (SITE / ".nojekyll").touch()
    policy = policy_html((ROOT / "PRIVACY.md").read_text(encoding="utf-8"))
    template = (ROOT / "site/privacy.template.html").read_text(encoding="utf-8")
    (SITE / "privacy.html").write_text(template.replace("<!-- POLICY -->", policy), encoding="utf-8")
    (SITE / "privacy.template.html").unlink()
    print(json.dumps({"version": version, "package": str(package), "bytes": package.stat().st_size,
                      "sha256": digest, "site": str(SITE), "store_url": store_url}, indent=2))


if __name__ == "__main__":
    build()
