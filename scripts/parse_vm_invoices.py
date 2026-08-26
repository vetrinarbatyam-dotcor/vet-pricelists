"""Vetmarket consolidated tax invoices (PDF) -> _canonical/vetmarket_pdf_invoices.json

Vetmarket publishes no price list, so its rows are built from order confirmations / invoices.
Only two fields are taken per line: the product name and "מחיר ליחידה" = the LIST price BEFORE
discount. The discount column, the line total and the quantity are read only to locate the
columns and are never written out.

Visual (RTL) token order of a line, left to right:
    <total> [<discount>%] חש <unit_price> <unit> <qty> <name...> <sku> <shipment-no>

Usage: python scripts/parse_vm_invoices.py "Invoice  SI26006695.pdf" ...
"""
import json, re, sys
from pathlib import Path
import pdfplumber
from extract_pdfs import DL, OUT

DATE = re.compile(r"\b(\d{2})/(\d{2})/(\d{2})\b")
NUM  = re.compile(r"^\d[\d,]*\.\d{2}$")
# extract_text() (unlike extract_tables()) hands back brackets in VISUAL position, so once heb()
# reverses the line they point the wrong way and must be mirrored.
MIRROR = str.maketrans("()[]{}<>", ")(][}{><")
# Same visual->logical flip as extract_pdfs.heb(), but the Latin/number run may NOT swallow
# brackets here: "(1 יח')" comes back as "1( 20" if it does.
LTR_RUN = re.compile(r"""[A-Za-z0-9]+(?:[ .*/+,'"-]+[A-Za-z0-9]+)*""")

def heb(s):
    s = re.sub(r"\s+", " ", s).strip()[::-1]
    return LTR_RUN.sub(lambda m: m.group()[::-1], s).translate(MIRROR).strip()

def parse(pdf_name):
    rows = []
    with pdfplumber.open(DL / pdf_name) as pdf:
        month = None
        for pg in pdf.pages:
            for ln in (pg.extract_text() or "").split("\n"):
                t = ln.split()
                if month is None and "ךיראת" in ln:
                    m = DATE.search(ln)
                    if m: month = f"20{m.group(3)}-{m.group(2)}"
                if len(t) < 7 or "חש" not in t: continue
                i = t.index("חש")
                if i + 3 >= len(t) or not NUM.match(t[i + 1]): continue
                sku = t[-2]
                if not sku.isdigit() or not t[-1].isdigit(): continue
                name = heb(" ".join(t[i + 4:-2]))
                price = float(t[i + 1].replace(",", ""))
                if name and price > 0: rows.append((sku, name, price))
        if not month: raise SystemExit(f"no invoice date in {pdf_name}")
        return [{"sku": s, "name": n, "unit_price": p, "month": month} for s, n, p in rows]

if __name__ == "__main__":
    out = {}                                  # newest month wins per sku
    for f in sys.argv[1:]:
        rows = parse(f)
        print(f"{f}: {len(rows)} lines, {rows[0]['month']}")
        for r in rows:
            prev = out.get(r["sku"])
            if prev and prev["month"] >= r["month"]: continue
            out[r["sku"]] = r
    dest = OUT / "vetmarket_pdf_invoices.json"
    json.dump(list(out.values()), open(dest, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"-> {dest}: {len(out)} skus")
    for r in list(out.values())[:5]: print("   ", json.dumps(r, ensure_ascii=False))
