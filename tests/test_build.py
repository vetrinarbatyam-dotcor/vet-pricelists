"""Smallest check that fails if the build or the privacy rule breaks. Run: python tests/test_build.py"""
import json, sys, re
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
idx = json.load(open(ROOT / "data/index.json", encoding="utf-8"))
counts = {m["slug"]: m["item_count"] for m in idx["pricelists"]}
assert counts["beit-erez"] == 415 and counts["aml"] == 123 and counts["hamachon"] == 90, counts
assert sum(counts.values()) >= 3900
FORBID = ("customerPriceWithVat", "weighted", "invoice", "clinic_sale", "purchasePrice", "112026")
for f in (ROOT / "data").rglob("*.json"):
    s = f.read_text(encoding="utf-8")
    for w in FORBID: assert w not in s, f"{w} leaked into {f.name}"
    d = json.load(open(f, encoding="utf-8"))
    if "items" in d:
        for it in d["items"]:
            assert it["name"] and it["price_no_vat"] > 0 and it["price_with_vat"] > it["price_no_vat"], it
            assert abs(it["price_with_vat"] - it["price_no_vat"] * 1.18) < 0.011, it
            assert it["topic"], it
for f in ROOT.glob("*.html"):
    s = f.read_text(encoding="utf-8")
    assert "CLAUDEVET2026" not in s, "access code must not appear in plain text"
print("OK", sum(counts.values()), "items,", len(counts), "price lists")
