# -*- coding: utf-8 -*-
"""Builds downloads/vetprices-orders-guide.html — the orders guide as one standalone file
that opens from disk with no server and prints cleanly.

The text lives in exactly one place: the block between <!--GUIDE--> and <!--/GUIDE--> in
index.html (the section shown on the help page). This script wraps that block in a small
self-contained page, so the two can never drift apart.

Run after editing the guide:  python scripts/build_guide.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "downloads" / "vetprices-orders-guide.html"

PAGE = """<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VetPrices — הוראות להזמנות</title>
<style>
:root{{--ink:#22303a;--muted:#65727c;--line:#dfe4e6;--teal:#0f6e63;--teal-soft:#e6f2f0;--warn:#8a5a12;--warn-soft:#fdf3e2}}
*{{box-sizing:border-box}}
body{{margin:0;padding:34px 20px 60px;background:#f6f7f6;color:var(--ink);
  font:16px/1.7 Heebo,"Segoe UI",Arial,sans-serif}}
main{{max-width:820px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:14px;padding:28px 32px 34px}}
.head{{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;
  border-bottom:2px solid var(--teal);padding-bottom:12px;margin-bottom:22px}}
.head b{{font-size:20px;color:var(--teal)}}
.head span{{color:var(--muted);font-size:14px}}
h2{{font-size:23px;margin:0 0 10px}}
h3{{font-size:18px;margin:26px 0 8px;color:var(--teal)}}
p{{margin:0 0 10px}}
ol,ul{{margin:0 0 10px;padding-inline-start:22px}}
li{{margin-bottom:7px}}
ul.tick{{list-style:none;padding-inline-start:0}}
ul.tick li{{padding-inline-start:20px;position:relative}}
ul.tick li::before{{content:"•";position:absolute;inset-inline-start:2px;color:var(--teal);font-weight:700}}
.hint{{color:var(--muted);font-size:14.5px}}
.warn-line{{background:var(--warn-soft);border-inline-start:4px solid var(--warn);border-radius:8px;padding:11px 14px}}
footer{{max-width:820px;margin:16px auto 0;color:var(--muted);font-size:13.5px;text-align:center}}
@media print{{body{{background:#fff;padding:0}}main{{border:0;border-radius:0;padding:0}}}}
</style>
</head>
<body>
<main>
  <div class="head"><b>VetPrices · הזמנות</b><span>מוגש חינם ע"י ד"ר גיל קרן · ClaudeVet</span></div>
{body}
</main>
<footer>הגרסה המלאה והמעודכנת: <b>prices.claudevet.com</b> · שאלות: vetrinarbatyam@gmail.com</footer>
</body>
</html>
"""


def main():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    m = re.search(r"<!--GUIDE-->(.*?)<!--/GUIDE-->", html, re.S)
    if not m:
        raise SystemExit("index.html has no <!--GUIDE--> block")
    body = m.group(1)
    # the wrapper section carries app classes and an id that mean nothing here
    body = re.sub(r'<section class="box pub-only" id="ordersHelp">', "<section>", body, count=1)
    # buttons inside the guide do nothing in a static file
    body = re.sub(r'<button[^>]*class="linkish"[^>]*>.*?</button>', "", body, flags=re.S)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(PAGE.format(body=body.rstrip()), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
