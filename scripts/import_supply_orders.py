# -*- coding: utf-8 -*-
"""One-time import of the open order lines from clinic-pal-hub into the VetPrices orders file.

Runs on the server (it needs Postgres and the built price lists):
    python3 scripts/import_supply_orders.py --dry-run
    python3 scripts/import_supply_orders.py

Only lines that are still open move over — anything already 'ordered' or 'received' stays behind
in clinic-pal-hub, which is left completely untouched. Re-running is safe: a line already
imported (same source id) is skipped.
"""
import argparse
import json
import re
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

SQL = """select coalesce(json_agg(t), '[]') from (
  select id::text, item_name, quantity, status, notes, created_at
  from supply_orders
  where status not in ('ordered','received') and item_name is not null
  order by created_at) t"""

CAT_PREFIX = [("[מזון] ", "food"), ("[ניקיון] ", "clean")]
CLIENT_RE = re.compile(r"\[לקוח:(.+?)\]")
PHONE_RE = re.compile(r"\[טל:(.+?)\]")
# "[מזון] Hill's PD - i/d חתול (1.5 ק"ג)" — the company sits before the first " - "
FOOD_CO_RE = re.compile(r"^(.+?)\s+-\s+(.+)$")
# clinic-pal-hub spells the food company its own way; these are the same suppliers as ours.
# Even when the exact item does not match a price-list row, the supplier is worth keeping —
# filtering by supplier is the whole point of the new list.
FOOD_CO_SLUG = {"hill's pd": "hills-pd", "hill's ve": "hills-ve", "hill's": "hills-pd",
                "rc vet": "rc-vet", "rc חנויות": "rc-retail", "monge": "monge",
                "monge vet": "monge-vet", "purina": "purina-vet", "purina חנויות": "purina-retail",
                "vetlife": "vetlife", "foodiez": "foodiez"}


def norm(s):
    s = unicodedata.normalize("NFKC", s or "").lower()
    return re.sub(r"\W+", "", s)


def fetch(db):
    out = subprocess.run(["sudo", "-u", "postgres", "psql", "-d", db, "-tAc", SQL],
                         capture_output=True, text=True, encoding="utf-8")
    if out.returncode:
        sys.exit("psql failed: " + (out.stderr or "").strip())
    return json.loads(out.stdout.strip())


def catalog(data_dir):
    """name -> (supplier, slug, sku, price) for every item in every price list."""
    by = {}
    sup_by_slug = {}
    for f in sorted(Path(data_dir).glob("*/*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        meta = d.get("meta", {})
        for it in d.get("items", []):
            by.setdefault(norm(it.get("name")), (meta.get("supplier", ""), meta.get("slug", ""),
                                                 it.get("sku", ""), it.get("price_no_vat")))
        sup_by_slug[meta.get("slug", "")] = meta.get("supplier", "")
    return by, sup_by_slug


def convert(row, cat, sup_by_slug):
    name = row["item_name"]
    kind = "general"
    for pre, k in CAT_PREFIX:
        if name.startswith(pre):
            name, kind = name[len(pre):].strip(), k
            break
    name = re.sub(r"^חופשי\|", "", name).strip()

    notes = row.get("notes") or ""
    mc, mp = CLIENT_RE.search(notes), PHONE_RE.search(notes)
    client = mc.group(1).strip() if mc else ""
    phone = mp.group(1).strip() if mp else ""

    supplier = slug = sku = ""
    price = None
    hit = cat.get(norm(name))
    if not hit and kind == "food":
        # food rows carry the company in front: "Hill's PD - i/d חתול (1.5 ק"ג)"
        m = FOOD_CO_RE.match(name)
        if m:
            hit = cat.get(norm(m.group(2)))
            if not hit:
                sl = FOOD_CO_SLUG.get(m.group(1).strip().lower())
                if sl and sl in sup_by_slug:
                    supplier, slug = sup_by_slug[sl], sl
    if hit:
        supplier, slug, sku, price = hit
    created = row["created_at"].replace(" ", "T")[:26]
    try:
        iso = datetime.fromisoformat(created).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "id": "imp-" + row["id"],
        "cat": kind,
        "name": name,
        "qty": max(1, int(row.get("quantity") or 1)),
        "status": row["status"],
        "supplier": supplier,
        "slug": slug,
        "sku": sku or "",
        "price": price,
        "client": client,
        "phone": phone,
        "paid": False,
        "note": "",
        "created_at": iso,
        "updated_at": iso,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--db", default="clinicpal")
    ap.add_argument("--data", default="/var/www/prices/data")
    ap.add_argument("--out", default="/var/lib/vetprices/orders.json")
    a = ap.parse_args()

    rows = fetch(a.db)
    cat, sup_by_slug = catalog(a.data)
    lines = [convert(r, cat, sup_by_slug) for r in rows]

    by_cat, matched = {}, sum(1 for l in lines if l["supplier"])
    for l in lines:
        by_cat[l["cat"]] = by_cat.get(l["cat"], 0) + 1
    print(f"{len(lines)} open lines · by category: {by_cat}")
    print(f"supplier matched from the price lists: {matched}/{len(lines)}")
    print(f"with a client: {sum(1 for l in lines if l['client'])}")
    for l in lines[:5]:
        print("  ", json.dumps(l, ensure_ascii=False))

    out = Path(a.out)
    cur = {"v": 1, "cats": ["general", "food", "clean", "lab"], "lines": []}
    if out.exists():
        try:
            cur = json.loads(out.read_text(encoding="utf-8")) or cur
        except json.JSONDecodeError:
            pass
    have = {l["id"] for l in cur.get("lines", [])}
    fresh = [l for l in lines if l["id"] not in have]
    print(f"new to add: {len(fresh)} (file already holds {len(have)})")

    if a.dry_run:
        print("dry run — nothing written")
        return
    cur.setdefault("lines", []).extend(fresh)
    cur.setdefault("cats", ["general", "food", "clean", "lab"])
    cur["v"] = 1
    out.write_text(json.dumps(cur, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out} — {len(cur['lines'])} lines")


if __name__ == "__main__":
    main()
