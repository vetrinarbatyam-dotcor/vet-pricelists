"""Parse supplier price-list PDFs -> _canonical/<slug>.json (list prices only).

Bidi note: pdfplumber returns each table cell in VISUAL order, so a Hebrew cell comes out fully
reversed. heb() reverses the whole cell back to logical order (which also repairs embedded Latin
and numbers: "רטיל 3X2.0" -> "0.2X3 ליטר", "MD" -> "DM") and mirrors brackets.

PRIVACY RULE: only the supplier's official LIST price is taken. Negotiated-discount columns
(Purina "אחוז הנחה" / "מחיר אחרי הנחה", Ferplast "מחיר לאחר הנחה 25%") are dropped on purpose.
"""
import json, re, sys
from pathlib import Path
import pdfplumber

DL = Path.home() / "Downloads"
OUT = Path(__file__).resolve().parent.parent / "_canonical"
HEB = re.compile(r"[֐-׿]")
# Inside the visual string, Latin/number runs already read left-to-right, so reversing the whole
# cell breaks them — flip each run back ("HYDRA CARE" and "3.5" survive the round trip).
LTR_RUN = re.compile(r"""[A-Za-z0-9]+(?:[ .*/+,'"()-]+[A-Za-z0-9]+)*""")

def heb(s):
    """visual -> logical for a Hebrew cell; returns cleaned text."""
    if not s: return ""
    s = re.sub(r"\s+", " ", s.replace("\n", " ")).strip()
    if not HEB.search(s): return s                       # pure Latin/number cell: already logical
    s = s[::-1]           # brackets are stored logically by pdfplumber — do NOT mirror
    s = LTR_RUN.sub(lambda m: m.group()[::-1], s).strip()
    return re.sub(r"(?<=[֐-׿]) (?=[֐-׿]$)", "", s)   # letter-spaced tail: "כא ב" -> "כאב"

def money(c):
    if not c: return None
    t = re.sub(r"[^\d.,]", "", str(c).replace("\n", "")).replace(",", "")
    if not t: return None
    try: v = float(t)
    except ValueError: return None
    return v if v > 0 else None

def tables(pdf_name):
    with pdfplumber.open(DL / pdf_name) as pdf:
        for pg in pdf.pages:
            for t in pg.extract_tables():
                for r in t:
                    yield [(c or "").strip() for c in r]

def is_name(c):
    """a product-name cell: has letters and isn't a bare number/unit."""
    return bool(c) and bool(re.search(r"[A-Za-z֐-׿]", c)) and len(re.sub(r"\s", "", c)) > 3

# ---------------------------------------------------------------- Royal Canin (VET + SPT)
def royal_canin(pdf_name):
    """RTL cols: [RRP, LIST price, ...meta..., product, barcode, sku]. Section rows: only col0."""
    items, section = [], None
    for r in tables(pdf_name):
        if len(r) < 5: continue
        if "מחיר" in heb(r[0]) and "צרכן" in heb(r[0]): continue           # header row
        if is_name(r[0]) and not any(r[1:]):                                # section title
            section = heb(r[0]); continue
        price = money(r[1])
        if not price: continue
        sku = next((c for c in (r[-1], r[-2]) if c and re.fullmatch(r"[A-Za-z0-9]{4,}", c.strip())), None)
        mid = [c for c in r[2:-1] if is_name(c)]                            # product name among middle cols
        if not mid: continue
        name = heb(max(mid, key=len))
        w = (r[2] or "").strip()                                            # weight / pack column
        unit = heb(w) if w and len(w) < 12 and re.search(r"\d", w) else None
        items.append({"name": name, "sku": sku, "category": section,
                      "price_no_vat": price, "unit": unit})
    return items

# ---------------------------------------------------------------- Purina (VET sheet + retail sheet)
def purina(pdf_name):
    """cols: [after-discount, discount%, carton, UNIT LIST PRICE, units/carton, unit, weight, name, sku].
    Single-filled rows are brand sections (FRISKIES DRY, PRO PLAN DRY CAT …)."""
    items, section = [], None
    for r in tables(pdf_name):
        if len(r) < 9: continue
        filled = [c for c in r if c and c.strip()]
        if len(filled) == 1:                                                # brand section header
            section = heb(filled[0]); continue
        if "הנחה" in heb(r[1]): continue
        name, sku = heb(r[7]), re.sub(r"\s+", "", r[8] or "")
        price = money(r[3])                                                 # מחיר ליח' = list price
        if not is_name(r[7]) or not price or not sku: continue
        w, u, per = heb(r[6]), heb(r[5]), heb(r[4])
        unit = " ".join(x for x in (w, u) if x) + (f" × {per} בקרטון" if per else "")
        items.append({"name": name, "sku": sku, "price_no_vat": price, "unit": unit.strip() or None,
                      "category": section,
                      "animal": "חתול" if ("לחתול" in name or "CAT" in (section or "")) else
                                ("כלב" if ("לכלב" in name or "DOG" in (section or "")) else None)})
    return items

# ---------------------------------------------------------------- simple [price, name, barcode, sku] sheets
def simple_table(pdf_name, i_price, i_name, i_sku, min_cols, category=None, skip=("מחירון", "תיאור", "תאור")):
    items = []
    for r in tables(pdf_name):
        if len(r) < min_cols: continue
        head = heb(r[i_name])
        if not is_name(r[i_name]) or any(k in head for k in skip): continue
        price = money(r[i_price])
        if not price: continue
        sku = (r[i_sku] or "").replace(" ", "") if i_sku is not None else None
        items.append({"name": head, "sku": sku or None, "price_no_vat": price, "category": category})
    return items

# ---------------------------------------------------------------- IDEXX reference list
def idexx(pdf_name):
    """cols: [not-available-in-IL flag, price ex-VAT, test description, Test Code]"""
    items = []
    for r in tables(pdf_name):
        if len(r) < 4: continue
        name, code = heb(r[2]), (r[3] or "").strip()
        price = money(r[1])
        if not price or not is_name(r[2]) or "תיאור" in name: continue
        items.append({"name": name, "sku": code or None, "price_no_vat": price,
                      "category": None, "notes": "אינה זמינה בישראל" if (r[0] or "").strip() else None})
    return items

# ---------------------------------------------------------------- Miltin (Beit Erez) consumables
def miltin_consumables(pdf_name):
    """cols: [active ingredient, price, product, sku, company, family]; single-cell rows = section."""
    items, section = [], None
    for r in tables(pdf_name):
        filled = [c for c in r if c and c.strip()]
        if len(filled) == 1 and is_name(filled[0]):
            section = heb(filled[0]); continue
        if len(r) < 5: continue
        name = heb(r[2]); price = money(r[1])
        if not is_name(r[2]) or not price or "שם המוצר" in name: continue
        fam = heb(r[5]) if len(r) > 5 else ""
        items.append({"name": name, "sku": (r[3] or "").strip() or None, "price_no_vat": price,
                      "category": fam or section, "manufacturer": heb(r[4]) or None,
                      "notes": heb(r[0]) or None})
    return items

# ---------------------------------------------------------------- MSD Bravecto
def bravecto(pdf_name):
    """rows are either [price, weight range, name] or one merged cell holding all three."""
    items = []
    for r in tables(pdf_name):
        filled = [heb(c) for c in r if c and c.strip()]
        if not filled or any("מחיר לווטרינר" in f for f in filled): continue
        blob = " ".join(filled)
        price = None
        m = re.search(r"(\d[\d.,]*)\s*₪|₪\s*(\d[\d.,]*)", blob)
        if m: price = money(m.group(1) or m.group(2))
        name = re.sub(r"₪\s*[\d.,]+|[\d.,]+\s*₪", "", blob).strip(" -|")
        if not price or not re.search(r"ברבקטו|ברווקטו", name): continue
        sku = None
        ms = re.search(r"[)(](\d{5,})[)(]?", name)
        if ms: sku = ms.group(1); name = name.replace(ms.group(0), " ")
        mw = re.search(r"(\d[\d.]*\s*-\s*\d[\d.]*\s*ק\"ג|עד\s*\d[\d.]*\s*ק\"ג|\+\s*\d+\s*ק\"ג)", name)
        weight = mw.group(1).strip() if mw else None
        if mw: name = name.replace(mw.group(0), " ")
        name = re.sub(r"[)(]", " ", name)
        name = re.sub(r"\s+", " ", name).strip(" -·")
        if weight: name = f"{name} · {weight}"
        items.append({"name": re.sub(r"\s+", " ", name), "sku": sku, "price_no_vat": price,
                      "category": "הדברה / טפילים"})
    return items

# ---------------------------------------------------------------- Ferplast
def ferplast(pdf_name):
    """cols: [after 25% discount, LIST, description, barcode, sku] — discount column dropped."""
    items = []
    for r in tables(pdf_name):
        if len(r) < 5: continue
        price, name, sku = money(r[1]), heb(r[2]), (r[4] or "").strip()
        if not is_name(r[2]) or not price or "מחירון" in name: continue
        items.append({"name": name, "sku": sku or None, "price_no_vat": price, "category": "ציוד ואביזרים"})
    return items

# ---------------------------------------------------------------- multi-brand importer (PRICE LIST 2026)
# Brand headers bleed across pages, so the brand is taken from the SKU prefix instead.
PREFIX_BRAND = {"DERMA": "DermatoVet", "DZOO": "DermaZoo", "IMED": "I-MED", "WEPHARM": "WePharm",
                "VETIN": "VetInnov", "FIONA": "Fiona", "CLINISUT": "חוטי תפירה Clinisut",
                "AIP": "חוטי תפירה AIP", "URANO": "Uranotest", "BIOGUARD": "BioGuard",
                "SION": "Cutanplast", "SIOM": "Cutanplast", "GENIA": "Genia", "ADEQID": "שבבי זיהוי",
                "MEDBONE": "MedBone", "PR": "Pet Remedy"}
BONUS_TAIL = re.compile(r"((?:\d+\s*\+\s*\d+)(?:\s*,\s*\d+\s*\+\s*\d+)*)\s*$")
ROW = re.compile(r"^([A-Z][A-Z0-9]*[-–][A-Za-z0-9*/.\-]+)\s*(.*?)\s*₪\s*([\d ,.]+)$")
def importer(pdf_name):
    """text lines: '<CODE> <name> ₪ <price> [bonus]'. Prices can carry stray spaces ('₪ 1 02' = 102),
    so the trailing bonus ('6+1, 10+2') is stripped BEFORE the price is read."""
    items = []
    with pdfplumber.open(DL / pdf_name) as pdf:
        for pg in pdf.pages:
            for raw in (pg.extract_text() or "").split("\n"):
                line = raw.strip()
                if not line or "₪" not in line or "מחירים אינם כוללים" in heb(line): continue
                bm = BONUS_TAIL.search(line)
                bonus = re.sub(r"\s+", "", bm.group(1)) if bm else None
                if bm: line = line[:bm.start()].rstrip()
                m = ROW.match(line)
                if not m: continue
                code, name = m.group(1), m.group(2).strip()
                price = money(m.group(3).replace(" ", ""))
                if not price: continue
                if not name and HEB.search(m.group(2)): name = heb(m.group(2))
                prefix = re.split(r"[-–]", code)[0]
                brand = PREFIX_BRAND.get(prefix, prefix)
                if prefix == "PKB":
                    brand = "Zymox" if re.search(r"ZY|RZ|^PKB-\d", code) else "Oratene"
                items.append({"name": re.sub(r"\s+", " ", name) or code, "sku": code,
                              "price_no_vat": price, "category": brand, "bonus": bonus})
    return items

# ---------------------------------------------------------------- Zoetis (two 2026 sheets)
# ---------------------------------------------------------------- Hill's (PD / Science Plan)
# No table grid: 3 numeric columns (price | 8-digit SKU | pack weight) plus a product-name cell
# that is vertically merged across its size rows, so the name is matched by nearest baseline.
def hills(pdf_name):
    """No table grid: 3 numeric columns (price | 8-digit SKU | pack size) plus a product-name cell
    that is vertically merged across its size rows, so the name is matched by nearest baseline.
    A name that wraps to a second line is merged first (lines <14pt apart)."""
    NUM = re.compile(r"[\d.,]+g?$")
    items = []
    with pdfplumber.open(DL / pdf_name) as pdf:
        for pg in pdf.pages:
            groups = {}
            for w in pg.extract_words():
                if w["top"] < 140 or w["top"] > 770: continue      # header / footer
                groups.setdefault(round(w["top"] / 3), []).append(w)
            sizes, names = [], []
            for _, g in sorted(groups.items()):
                g.sort(key=lambda w: w["x0"])
                nm = [w for w in g if 380 < w["x0"] < 530]         # name column (x>530 = side band)
                num = [w for w in g if w["x0"] < 380]
                sku = next((w["text"] for w in num if re.fullmatch(r"\d{8}", w["text"])), None)
                if sku:
                    vals = [w["text"] for w in num if NUM.fullmatch(w["text"])]
                    if len(vals) >= 3: sizes.append((g[0]["top"], vals[0], sku, vals[-1]))
                if nm: names.append([nm[0]["top"], heb(" ".join(w["text"] for w in nm)), bool(sku)])
            # Join a name that wrapped to a second line. A name sharing its row with a size row is a
            # single-size product and is complete; only two name-only lines close together are one name.
            merged = []
            for top, txt, own in names:
                prev = merged[-1] if merged else None
                if prev and not prev[2] and not own and top - prev[0] < 14:
                    merged[-1] = [(prev[0] + top) / 2, prev[1] + " " + txt, False]
                else: merged.append([top, txt, own])
            if not merged: continue
            for top, price, sku, wt in sizes:
                name = min(merged, key=lambda n: abs(n[0] - top))[1]
                name = re.sub(r"([A-Za-z])/\s+([A-Za-z])", r"\1/\2", name)     # "i/ d" -> "i/d"
                name = re.sub(r"\b([A-Za-z]{3,}) ([a-z])\b", r"\1\2", name)    # "stres s" -> "stress"
                price = money(price)
                if not price or not name: continue
                grams = wt.endswith("g")
                try: n = float(wt.rstrip("g"))
                except ValueError: continue
                unit = f"{n:g} ג'" if grams or n > 30 else f'{n:g} ק"ג'
                items.append({"name": f"{name} {unit}", "sku": sku, "price_no_vat": price,
                              "category": None, "unit": unit})
    return items

def zoetis(meds_pdf, parasite_pdf):
    items, cat = [], None
    for r in tables(meds_pdf):                       # [price, product, (section)]
        cells = [c for c in r if c and c.strip()]
        if len(cells) < 2 or "מחיר" in heb(cells[0]): continue
        price, name = money(cells[0]), heb(cells[1])
        if len(cells) > 2: cat = heb(cells[2])
        if not price or not is_name(cells[1]): continue
        items.append({"name": name, "price_no_vat": price, "category": cat, "sku": None})
    for r in tables(parasite_pdf):                   # one merged cell: "<name> <price> ₪"
        cells = [c for c in r if c and c.strip()]
        if not cells: continue
        txt = heb(cells[0])
        m = re.search(r"(.*?)\s*([\d.]+)\s*₪\s*$", txt)
        if not m or "מחיר" in txt: continue
        name, price = m.group(1).strip(), money(m.group(2))
        if not price or not name: continue
        items.append({"name": name, "price_no_vat": price, "sku": None,
                      "category": "טיפולים מונעים"})
    return items

DLP = "Downloads/PDF/"
JOBS = {
    "purina_retail_2026_06": lambda: purina("הצעת מחיר וטרינר 2026.pdf"),
    "vetlife_2025_02":  lambda: simple_table("PDF/מחירון וטלייף 02.25 (1).pdf", 0, 1, 3, 4),
    # Monge / Kong (same importer layout: [img, LIST price, description, barcode, sku])
    "monge_2026_07":    lambda: (simple_table("מחירון מונג יבש - יולי 2026.pdf", 1, 2, 4, 5)
                                 + simple_table("מחירון מונג ביווילד - יולי 2026.pdf", 1, 2, 4, 5, category="BeWild")),
    "monge_vet_2026_07": lambda: simple_table("מחירון מונג וט סלושיין יבש+רטוב - יולי 2026.pdf", 1, 2, 4, 5),
    "hills_pd_2026_04": lambda: hills("PD_priceList_Apr26.PDF"),
    "hills_sp_2026_04": lambda: hills("SP_PriceList_Apr26_2.PDF"),
    "kong_2026_08":     lambda: simple_table("מחירון קונג מלאי - אוגוסט 2026 .pdf", 1, 2, 4, 5),
    "idexx_2025":       lambda: idexx("PDF/מחירון רפרנס איידקס 2025.pdf"),
    "miltin_consum_2025_11": lambda: miltin_consumables("PDF/מחירון חטיבה וטרינרית קבוצת מילטין ציוד מתכלה - נובמבר 2025.pdf"),
    "msd_2026":         lambda: bravecto("../pricecmp/pdf/new_bravecto.pdf"),
    "zoetis_2026":      lambda: zoetis("זואטיס תרופות 2026.PDF", "זואטיס סימפריקה סטרונגהולד 2026.PDF"),
    "rc_vet_2026_06":   lambda: royal_canin("RC VET Price list JUNE.pdf"),
    "rc_spt_2026_01":   lambda: royal_canin("RC SPT Price list Jan_2026.pdf"),
    "purina_2026_06":   lambda: purina("פורינה.pdf"),
    "ferplast_2026_02": lambda: ferplast("מחירון מוצרי פרפלסט 24.2.26.pdf"),
    "importer_2026":    lambda: importer("PRICE LIST 2026.pdf"),
}

if __name__ == "__main__":
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for k, fn in JOBS.items():
        if only and only != k: continue
        seen, uniq = set(), []
        for x in fn():
            key = (x["name"], x.get("sku"), x["price_no_vat"])
            if key in seen: continue
            seen.add(key); uniq.append(x)
        json.dump(uniq, open(OUT / f"{k}.json", "w", encoding="utf-8"), ensure_ascii=False)
        print(f"\n=== {k}: {len(uniq)} items")
        for x in uniq[:5]: print("   ", json.dumps(x, ensure_ascii=False)[:160])
