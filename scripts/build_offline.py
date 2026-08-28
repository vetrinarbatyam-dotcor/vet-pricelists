# -*- coding: utf-8 -*-
"""Bundles the whole site into downloads/vetprices-offline.html — one file that opens
from the user's disk with no server and no network.

Everything the app fetches (config.json, data/index.json, every price list) is embedded
as window.__VP_EMBED, and getJSON() reads from there instead of the network. The embedded
config carries mode:"offline", which skips the access gate — whoever holds the file has
already passed it — and keeps the settings in localStorage exactly like the public site.

Run after scripts/build.py:  python scripts/build_offline.py
"""
import json
import re
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "downloads" / "vetprices-offline.html"

OFFLINE_CONFIG = {
    "mode": "offline",
    "product": "VetPrices · עותק מקומי",
    "contact": "vetrinarbatyam@gmail.com",
    "site": "https://claudevet.com",
}


def read(p):
    return (ROOT / p).read_text(encoding="utf-8")


def main():
    embed = {"config.json": OFFLINE_CONFIG, "data/index.json": json.loads(read("data/index.json"))}
    for f in sorted((ROOT / "data").glob("*/*.json")):
        embed[f"data/{f.parent.name}/{f.name}"] = json.loads(f.read_text(encoding="utf-8"))

    html = read("index.html")
    # the stylesheet and the script become inline; the Google Fonts link stays a link, and
    # simply falls back to the local stack when the file is opened offline.
    # the logo sits next to index.html, not next to the bundle — inline it or it 404s on disk
    for svg in ("claudevet-wordmark.svg", "claudevet-mark.svg"):
        uri = "data:image/svg+xml;utf8," + quote(read(svg))
        html = html.replace(f'"{svg}"', f'"{uri}"')

    # the replacement has to be a function: as a plain string re.sub would eat the backslashes
    # in the source, and the \n inside out.join('\n') became a real newline — an unterminated
    # string literal that killed the whole bundle.
    html = re.sub(r'<link rel="stylesheet" href="style\.css[^"]*">',
                  lambda m: "<style>\n" + read("style.css") + "\n</style>", html, count=1)
    html = re.sub(r'<script src="app\.js[^"]*"></script>',
                  lambda m: "<script>\n" + read("app.js") + "\n</script>", html, count=1)
    # </ inside the JSON would close the script tag early
    payload = json.dumps(embed, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = html.replace("</head>", f"<script>window.__VP_EMBED={payload};</script>\n</head>", 1)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    mb = OUT.stat().st_size / 1048576
    lists = len(embed) - 2
    print(f"wrote {OUT.relative_to(ROOT)} — {mb:.1f} MB, {lists} price lists embedded")


if __name__ == "__main__":
    main()
