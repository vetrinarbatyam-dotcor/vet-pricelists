"""Smallest check that fails if the build or the privacy rule breaks. Run: python tests/test_build.py"""
import json, sys, re
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
idx = json.load(open(ROOT / "data/index.json", encoding="utf-8"))
counts = {m["slug"]: m["item_count"] for m in idx["pricelists"]}
assert counts["beit-erez"] + counts["beit-erez-shop"] == 415 and counts["aml"] == 123 and counts["hamachon"] == 90, counts
assert {m["type"] for m in idx["pricelists"]} == {"food", "medical", "labs", "shop"}
assert counts["idexx"] + counts["idexx-ref"] > 400 and counts["miltin-consum"] > 350, "refreshed lists shrank"
assert counts["karnieli"] > 60, "Karnieli lost its three 2025 price lists"
assert sum(counts.values()) >= 5690
vm = __import__("json").load(open(ROOT / "data/medical/vetmarket.json", encoding="utf-8"))["items"]
assert all(i.get("price_date") for i in vm), "a Vetmarket row without an invoice date = a price from the internal catalog"

# "invoices" as a source label is fine — an invoice-derived FIELD is not: the published number
# is the pre-discount list price, never what the clinic actually paid.
FORBID = ("customerPriceWithVat", "weighted", "invoice_price", "invoice_total", "net_price",
          "paid", "discount_pct", "clinic_sale", "purchasePrice", "112026")
ALLOWED_ITEM_KEYS = {"id", "name", "category", "topic", "price_no_vat", "price_with_vat", "sku",
                     "pack_qty", "price_date", "unit", "animal", "notes", "bonus", "manufacturer",
                     "source", "kind", "form", "stage", "dogsize"}
for f in (ROOT / "data").rglob("*.json"):
    s = f.read_text(encoding="utf-8")
    for w in FORBID: assert w not in s, f"{w} leaked into {f.name}"
    d = json.load(open(f, encoding="utf-8"))
    if "items" in d:
        for it in d["items"]:
            assert it["name"] and it["price_no_vat"] > 0 and it["price_with_vat"] > it["price_no_vat"], it
            assert abs(it["price_with_vat"] - it["price_no_vat"] * 1.18) < 0.011, it
            assert it["topic"], it
            assert not (set(it) - ALLOWED_ITEM_KEYS), (f.name, set(it) - ALLOWED_ITEM_KEYS)
for f in ROOT.glob("*.html"):
    s = f.read_text(encoding="utf-8")
    assert "CLAUDEVET2026" not in s, "access code must not appear in plain text"
print("OK", sum(counts.values()), "items,", len(counts), "price lists")
