"""Render original promotional artwork and actual bundled UI on clearly labeled sample content.

Usage: python scripts/prepare_store_assets.py --browser /path/to/chromium
The browser runs headlessly with a separate temporary profile, never the owner's account.
"""
from pathlib import Path
import argparse
import base64
import json
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def render(browser, page, output, width, height):
    with tempfile.TemporaryDirectory(prefix="igt-store-browser-") as profile:
        if not Path(profile).resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()):
            raise ValueError("Unexpected temporary browser profile path")
        args = [browser, "--headless", "--no-sandbox", "--disable-gpu", "--disable-extensions",
                "--disable-component-update", "--no-first-run", "--no-default-browser-check",
                "--disable-background-networking", f"--user-data-dir={profile}", "--hide-scrollbars",
                "--virtual-time-budget=2000", f"--window-size={width},{height}",
                f"--screenshot={output}", page.as_uri()]
        startup = None
        if os.name == "nt":
            startup = subprocess.STARTUPINFO()
            startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startup.wShowWindow = subprocess.SW_HIDE
        subprocess.run(args, capture_output=True, timeout=30, check=True, startupinfo=startup)
    if not output.is_file():
        raise RuntimeError(f"Browser did not produce {output}")
    print(output.name, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser", required=True)
    args = parser.parse_args()
    previews = ROOT / "dist/store-previews"
    assets = ROOT / "store/assets"
    previews.mkdir(parents=True, exist_ok=True)
    assets.mkdir(parents=True, exist_ok=True)
    art = (ROOT / "site/assets/landscape.svg").read_text(encoding="utf-8")
    image = "data:image/svg+xml;base64," + base64.b64encode(art.encode()).decode()
    profile_art = art.replace('width="600" height="500"', 'width="1600" height="1600"')
    profile_image = "data:image/svg+xml;base64," + base64.b64encode(profile_art.encode()).decode()
    css = (ROOT / "content.css").read_text(encoding="utf-8")
    content = (ROOT / "content.js").read_text(encoding="utf-8")
    content = content.rsplit("})();", 1)[0] + "window.storeDemo={openViewer,mediaByCode,seen,addPostButtons};})();"
    adapter = (ROOT / "music-player.js").read_text(encoding="utf-8")
    setup = """class DemoAudio extends EventTarget {
      constructor(){super();this.src='';this.paused=true;this.currentTime=0;this.volume=.7;this.readyState=1}
      play(){this.paused=false;this.dispatchEvent(new Event('play'));return Promise.resolve()}
      pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'))}}
      removeAttribute(k){if(k==='src')this.src=''} load(){this.currentTime=0}
    }
    window.Audio=DemoAudio;
    window.chrome={runtime:{getManifest:()=>({version:'2.5.0'}),sendMessage:(_m,fn)=>fn?.({ok:true})}};
    const nativePost=window.postMessage;window.postMessage=m=>nativePost.call(window,m,'*');
    """
    style = """body{margin:0;background:#f4f6f0;color:#173c34;font-family:Arial,sans-serif}
      .layout{display:grid;grid-template-columns:390px 500px;gap:80px;align-items:center;margin:84px 100px}
      .wordmark{font-size:15px;font-weight:bold;letter-spacing:1px;margin-bottom:40px}
      .wordmark small{font-size:9px;letter-spacing:2px;display:block;margin-top:6px;color:#7b8971}
      h1{font-size:52px;line-height:1.08;letter-spacing:-2.5px;font-weight:600;margin:0 0 24px}
      .lead{font-size:17px;line-height:1.7;color:#667c6a}
      .points{font-size:13px;line-height:2.6;color:#456547;margin-top:32px}
      article{background:#fff;border:1px solid #dbe3d3;border-radius:12px;overflow:hidden;box-shadow:0 18px 45px #1c412311}
      .header{display:flex;align-items:center;gap:12px;padding:18px}
      .avatar{width:36px;height:36px;background:#d8d5b6;border-radius:50%}
      .identity{display:flex;flex-direction:column;flex:1;min-width:0;font-size:12px}
      .author{display:flex;align-items:center;gap:6px;height:20px;font-size:13px}
      a{color:inherit;text-decoration:none}.author a{font-weight:bold}.author span{color:#98a28d}
      .subtitle{font-size:11px;line-height:18px}.media,.media>img{display:block;width:500px;height:400px;object-fit:cover}
      .actions{display:flex;align-items:center;gap:13px;padding:10px 14px}.actions button{color:inherit}
      .caption{font-size:12px;line-height:1.8;padding:0 18px 18px;margin:0}.permalink{display:none}
      .demo-label{position:fixed;left:24px;bottom:18px;color:#7c8d75;font-size:10px;letter-spacing:.3px;z-index:2147483647}
      .profile-background{margin:80px auto;width:820px}.profile-background h1{font-size:30px}
      .profile-background p{color:#657c62}.profile-demo .demo-label{color:#afbaaa;background:#18211bcc;padding:8px 12px;border-radius:4px}
    """
    post = f"""<article><div class="header"><div class="avatar"></div><div class="identity"><div class="author"><a href="/sample.creator/">sample.creator</a><span>· 1 h</span></div><div class="subtitle">Suggested for you</div></div><span>•••</span></div><div class="media"><img src="{image}" alt="Original sample landscape artwork"></div><div class="actions"><svg width="24" height="24" aria-label="Like" viewBox="0 0 24 24"><path d="M12 21 3 12C-2 3 8-1 12 6 16-1 26 3 21 12Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><svg width="24" height="24" aria-label="Comment" viewBox="0 0 24 24"><path d="M20 17 22 22 15 20A9 9 0 1 1 20 17Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span>↗</span></div><p class="caption"><strong>sample.creator</strong> A view worth keeping.<br>Original sample artwork. Fictional account and audio credits.</p><a class="permalink" href="/p/Sample123/">Sample post</a></article>"""
    for kind in ("music", "profile"):
        location = {"origin": "https://www.instagram.com", "pathname": "/sample.creator/" if kind == "profile" else "/"}
        if kind == "music":
            body = f"<div class='layout'><div><div class='wordmark'>IG Tools<small>UNOFFICIAL</small></div><h1>Photo posts,<br>with their music.</h1><p class='lead'>The soundtrack belongs with the moment.</p><div class='points'>✓ Automatic playback as you scroll<br>✓ Song and artist credits<br>✓ Pause and volume controls</div></div>{post}</div>"
            action = f"storeDemo.mediaByCode.set('Sample123',{{code:'Sample123',username:'sample.creator',items:[{{type:'image',url:{json.dumps(image)}}}],audio:{{title:'Daylight',artist:'Sample artist'}},music:{{url:'https://s.cdninstagram.com/sample-demo.m4a',start:0,duration:30000,title:'Daylight',artist:'Sample artist'}}}});storeDemo.addPostButtons();"
        else:
            body = "<div class='profile-background'><h1>sample.creator</h1><p>A fictional profile for this extension demo.</p></div>"
            action = f"storeDemo.seen.set('sample.creator',{{url:{json.dumps(profile_image)},hd:true}});storeDemo.openViewer('sample.creator');"
        page = previews / f"{kind}.html"
        page.write_text(f"<!doctype html><meta charset='utf-8'><style>{css}{style}</style><body class='{kind}-demo'>{body}<div class='demo-label'>Illustrative demo · fictional profile and original sample artwork · actual bundled extension controls</div><script>{setup}</script><script>{adapter}</script><script>{{const location={json.dumps(location)};{content}}}{action}</script>", encoding="utf-8")
        render(args.browser, page, assets / f"screenshot-{kind}-1280x800.png", 1280, 800)
    promo = previews / "promo.html"
    promo.write_text("""<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:440px;height:280px;overflow:hidden}</style><svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#174b3d"/><stop offset="1" stop-color="#0c292a"/></linearGradient></defs><path fill="url(#g)" d="M0 0h440v280H0z"/><circle cx="365" cy="45" r="140" fill="#34664e" opacity=".4"/><circle cx="30" cy="285" r="160" fill="#386848" opacity=".25"/><g transform="rotate(-9 160 140)"><rect x="70" y="60" width="170" height="160" rx="20" fill="#e4ebd8"/><circle cx="145" cy="120" r="35" fill="none" stroke="#2b644b" stroke-width="12"/><path d="m172 148 28 28" stroke="#2b644b" stroke-width="14" stroke-linecap="round"/></g><g transform="rotate(8 310 120)"><rect x="245" y="48" width="112" height="100" rx="16" fill="#c8db9a"/><path d="M282 108V78l39-7v30m-39-19 39-7" fill="none" stroke="#34583a" stroke-width="5" stroke-linecap="round"/><ellipse cx="276" cy="111" rx="10" ry="7" fill="#34583a"/><ellipse cx="315" cy="104" rx="10" ry="7" fill="#34583a"/></g><rect x="251" y="172" width="87" height="64" rx="16" fill="#fffdf5" transform="rotate(-7 295 204)"/><path d="M295 188v27m-12-11 12 12 12-12" fill="none" stroke="#38674b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>""", encoding="utf-8")
    render(args.browser, promo, assets / "promo-440x280.png", 440, 280)


if __name__ == "__main__":
    main()
