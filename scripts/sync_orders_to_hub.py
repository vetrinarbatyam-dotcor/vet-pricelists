# -*- coding: utf-8 -*-
"""One-time cutover: move the VetPrices order lines into the clinic-pal-hub database.

From here on the hub table `supply_orders` is the list — the portal and the clinic copy of
VetPrices both read and write it, so there is nothing left to keep in sync. This script only
moves what is still sitting in the old file and adds the columns VetPrices needs.

Runs on the server, as root (it reads the hub's .env for the database password):
    python3 scripts/sync_orders_to_hub.py --dry-run
    python3 scripts/sync_orders_to_hub.py

A line that came from the portal in the first place (id `imp-<uuid>`) is written back onto its
own row. Its extras (supplier, price, ...) always go in; the name, quantity, status and notes go
in only if somebody actually edited the line here since the import — otherwise the portal, which
has kept working all along, is the newer of the two. A line deleted here is reported, never
deleted there: the portal is the older system and this is not the place to throw its rows away.
"""
import argparse
import json
import os
import shutil
from datetime import datetime

import psycopg2

ORDERS = "/var/lib/vetprices/orders.json"
ENV = "/home/claude-user/clinic-pal-hub/backend/.env"
DDL = """
alter table supply_orders add column if not exists cat text;
alter table supply_orders add column if not exists supplier text;
alter table supply_orders add column if not exists slug text;
alter table supply_orders add column if not exists sku text;
alter table supply_orders add column if not exists price numeric;
alter table supply_orders add column if not exists paid boolean default false;
"""
CAT_PREFIX = {"food": "[מזון] ", "clean": "[ניקיון] "}
EXTRAS = ("cat", "supplier", "slug", "sku", "price", "paid")


def env(path):
    out = {}
    with open(path, encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if ln and not ln.startswith("#") and "=" in ln:
                k, v = ln.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def to_row(l):
    """The same encoding as toRow() in app.js — keep the two in step."""
    name = ((l.get("supplier") or "") + " - " + l["name"]) if l.get("cat") == "food" and l.get("supplier") else l["name"]
    notes = " ".join(x for x in (
        l.get("note") or "",
        "[לקוח:%s]" % l["client"] if l.get("client") else "",
        "[טל:%s]" % l["phone"] if l.get("client") and l.get("phone") else "") if x).strip()
    return {
        "item_name": CAT_PREFIX.get(l.get("cat"), "") + name,
        "quantity": l.get("qty") or 1,
        "status": l.get("status") or "pending",
        "notes": notes,
        "cat": l.get("cat") or "general",
        "supplier": l.get("supplier") or "",
        "slug": l.get("slug") or "",
        "sku": l.get("sku") or "",
        "price": l.get("price"),
        "paid": bool(l.get("paid")),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--orders", default=ORDERS)
    ap.add_argument("--env", default=ENV)
    a = ap.parse_args()

    doc = json.load(open(a.orders, encoding="utf-8"))
    lines = doc.get("lines") or []
    e = env(a.env)
    cn = psycopg2.connect(host=e.get("DB_HOST", "localhost"), port=int(e.get("DB_PORT", "5432")),
                          dbname=e.get("DB_NAME", "clinicpal"), user=e.get("DB_USER", "clinicpal_user"),
                          password=e.get("DB_PASSWORD", ""))
    cur = cn.cursor()
    if not a.dry_run:
        cur.execute(DDL)

    cur.execute("select id::text, status from supply_orders")
    known = dict(cur.fetchall())

    n_up, n_extras, n_new, gone, tombs, clash = 0, 0, 0, [], [], []
    for l in lines:
        if l.get("deleted"):
            if l["id"].startswith("imp-") and l["id"][4:] in known:
                tombs.append(l["id"][4:])
            continue
        row = to_row(l)
        if l["id"].startswith("imp-"):
            uid = l["id"][4:]
            if uid not in known:
                gone.append(uid)          # somebody deleted it in the portal — let that stand
                continue
            # edited here since the import? then this side is the newer one
            edited = (l.get("updated_at") or "") > (l.get("created_at") or "")
            if edited and known[uid] != row["status"]:
                clash.append("%s: %s here, %s in the portal" % (l["name"][:40], row["status"], known[uid]))
            cols = list(row) if edited else list(EXTRAS)
            if edited:
                cols.append("updated_at")
                row["updated_at"] = l["updated_at"]
            sql = "update supply_orders set %s where id = %%(id)s" % ", ".join("%s = %%(%s)s" % (c, c) for c in cols)
            if not a.dry_run:
                cur.execute(sql, dict(row, id=uid))
            if edited:
                n_up += 1
            else:
                n_extras += 1
        else:
            row["created_at"] = l.get("created_at")
            row["updated_at"] = l.get("updated_at")
            cols = list(row)
            sql = "insert into supply_orders (%s) values (%s)" % (
                ", ".join(cols), ", ".join("%%(%s)s" % c for c in cols))
            if not a.dry_run:
                cur.execute(sql, row)
            n_new += 1

    if not a.dry_run:
        cn.commit()
        stamp = datetime.now().strftime("%Y-%m-%d-%H%M")
        shutil.copy2(a.orders, "%s.bak-hub-%s" % (a.orders, stamp))
        # the file keeps the category switches and nothing else: the lines live in the database
        # now. Written beside and moved into place — never opened over a live file.
        tmp = a.orders + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"v": 1, "cats": doc.get("cats") or ["general", "food", "clean"]}, f, ensure_ascii=False)
        shutil.chown(tmp, "www-data", "www-data")   # without this the browser's PUT dies
        os.chmod(tmp, 0o664)
        os.replace(tmp, a.orders)
    cn.close()

    print("%s%d lines edited here → written back, %d only got their extras, %d new lines inserted"
          % ("dry run: " if a.dry_run else "", n_up, n_extras, n_new))
    if gone:
        print("%d lines are gone from the portal, so they were skipped: %s" % (len(gone), ", ".join(gone)))
    if clash:
        print("%d lines carry a different status on each side; this list won: %s"
              % (len(clash), "; ".join(clash)))
    if tombs:
        print("%d lines were deleted in VetPrices but still exist in the portal — left alone on "
              "purpose, delete them there if they should go: %s" % (len(tombs), ", ".join(tombs)))


if __name__ == "__main__":
    main()
