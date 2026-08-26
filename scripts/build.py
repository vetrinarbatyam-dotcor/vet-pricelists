"""Build the public VetPrices dataset.

Rule: PUBLIC DATA IS BUILT ONLY FROM OFFICIAL LIST PRICES (supplier price lists / public retail
sites). Never from vetmarket.db / pricer.db / clinic Postgres — those carry the clinic's actual
purchase prices, discounts, and sale prices. Fields like customerPriceWithVat are dropped on purpose.

Inputs : _canonical/*.json (from scripts/ts_to_json.js + server pulls), medimarket prices.db
Outputs: data/<type>/<slug>.json, data/index.json, site/downloads/<type>.xlsx, sources/ copies
"""
import json, re, shutil, sqlite3, sys, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAN = ROOT / "_canonical"
DATA = ROOT / "data"
SRC = ROOT / "sources"
DL = ROOT / "Downloads_stub"  # unused
VAT = 1.18
TODAY = datetime.date.today().isoformat()
HOME = Path.home()

# ---------------------------------------------------------------- taxonomy (ported from vetmarket-cli web.py)
TOPICS = [
    ("ears", "אוזניים"), ("eyes", "עיניים"), ("dental", "שיניים ופה"), ("skin", "עור ופרווה"),
    ("joints", "מפרקים וניידות"), ("kidney", "כליה ודרכי שתן"), ("gi", "מערכת עיכול"),
    ("cardio", "לב וכלי דם"), ("endocrine", "הורמונלי / סוכרת"), ("neuro", "נוירולוגיה / התנהגות"),
    ("liver", "כבד"), ("onco", "אונקולוגיה"), ("antibiotic", "אנטיביוטיקה"), ("pain", "כאב ודלקת"),
    ("parasites", "הדברה / טפילים"), ("deworm", "תילוע"), ("vaccine", "חיסונים"),
    ("nutrition", "תזונה ומזון"), ("respiratory", "נשימה"), ("anesthesia", "הרדמה והרגעה"),
    ("equipment", "ציוד ומתכלים"), ("other", "כללי / לא מסווג"),
]
LAB_TOPICS = [
    ("hematology", "המטולוגיה וספירת דם"), ("chemistry", "ביוכימיה ופאנלים"), ("endocrine", "הורמונים"),
    ("serology", "סרולוגיה וזיהומים"), ("pcr", "PCR וגנטיקה"), ("culture", "תרביות"),
    ("pathology", "פתולוגיה וציטולוגיה"), ("urine", "שתן וצואה"), ("coag", "קרישה"),
    ("drugs", "רמות תרופות"), ("other", "אחר"),
]
FOOD_IND_TOPIC = {
    "מחלות כליה": "kidney", "דרכי שתן": "kidney", "מערכת עיכול": "gi", "אלרגיה למזון": "skin",
    "השמנה / ירידה במשקל": "nutrition", "סוכרת": "endocrine", "עור ופרווה": "skin",
    "מפרקים / ניידות": "joints", "התאוששות": "nutrition", "מחלות כבד": "liver", "דלקות פרקים": "joints",
    "אפילפסיה / מערכת עצבים": "neuro", "תחליף חלב": "nutrition", "גורים": "nutrition", "מזון רגיל": "nutrition",
    "לב": "cardio", "בלוטת התריס": "endocrine", "סרטן": "onco", "שיניים": "dental",
}
BE_CANON = {"אזניים": "אוזניים", "אנטיביוטקיה": "אנטיביוטיקה", "קרדיוואסקולר": "קרדיו", "חוטים (המשך)": "חוטים",
            "דרמטולוגיה": "דרמטולוגי", "נוזלים ותמיסות": "נוזלים"}
BE_TOPIC = {
    "אוזניים": "ears", "עיניים": "eyes", "עיניים ושיניים": "eyes", "דנטלי": "dental", "דרמטולוגי": "skin",
    "הדברה": "parasites", "תילוע": "deworm", "חיסונים": "vaccine", "תרכיבים": "vaccine",
    "אנטיביוטיקה": "antibiotic", "NSAID": "pain", "נוגדי דלקת": "pain", "הורמונלי": "endocrine",
    "נוירולוגיה": "neuro", "התנהגות": "neuro", "כבד": "liver", "כליות ושתן": "kidney",
    "מערכת עיכול": "gi", "מערכת עיכול - ארנבונים": "gi", "מפרקים": "joints", "קרדיו": "cardio",
    "ויטמינים": "nutrition", "מינרלים ושומן": "nutrition", "תחליפי חלב": "nutrition", "חטיפים למתן כדורים": "nutrition",
    "הרדמה": "anesthesia",
}
VM_TOPIC = {
    "מזון רפואי": "nutrition", "בדיקות מעבדה": "equipment", "אנטיביוטיקה": "antibiotic", "חומרים מתכלים": "equipment",
    "עיניים ואוזניים": None, "הדברה": "parasites", "מערכת עיכול": "gi", "דרמטולוגיה / אלרגיה": "skin",
    "שיכוך כאב": "pain", "אנדוקרינולוגיה": "endocrine", "חיסונים": "vaccine", "תוספי תזונה": "nutrition",
    "נוירולוגיה": "neuro", "חטיפים": "nutrition", "לב ולחץ דם": "cardio", "פסיכיאטריה והרגעה": "neuro",
    "נשימה / שיעול": "respiratory", "הרדמה": "anesthesia", "סטרואידים": "pain",
}
KW_TOPIC = [
    ("ears", ("אוזני", "אוזן", "otic", "אקרי", "אזני", "auris", "ear ")),
    ("eyes", ("עיני", "עין ", "ophth", "ocular", "דמעות", "eye", "lash", "idrop", "tear")),
    ("dental", ("שיני", "דנטל", "dental", "אבנית", "פה ", "oral", "breath", "teeth", "orocare", "oratene")),
    ("joints", ("מפרק", "גלוקוזאמין", "כונדרו", "joint", "ניידות", "wejoint", "mobility", "cartil")),
    ("kidney", ("כליה", "כלייתי", "renal", "שתן", "urinary", "flutd")),
    ("skin", ("עור", "פרוה", "פרווה", "דרמט", "אלרגי", "derma", "skin", "שמפו", "shampoo", "topical", "paw", "keto-c", "zoo ")),
    ("cardio", ("~לב", "קרדי", "cardio", "cardiac")),
    ("endocrine", ("סוכרת", "אינסולין", "תריס", "הורמון", "diabet", "thyro")),
    ("parasites", ("פרעוש", "קרצי", "flea", "tick", "נקסגארד", "ברוולין", "פרונטליין", "סימפריקה", "ברווקטו")),
    ("deworm", ("תולעים", "תילוע", "דרונטל", "worm", "dewor", "מילבמקס")),
    ("vaccine", ("חיסון", "תרכיב", "vaccin")),
    ("antibiotic", ("אנטיביו", "amoxi", "אמוקסי", "ציפרו", "doxy", "cephal", "clav", "metronid", "מטרוניד")),
    ("anesthesia", ("הרדמה", "anesth", "sedat", "propofol", "פרופופול", "isoflur", "קטמין", "ketamin")),
    ("pain", ("meloxi", "מלוקסי", "carprof", "רימדיל", "gabapent", "nsaid", "כאב")),
    ("respiratory", ("שיעול", "נשימ", "cough", "bronch")),
    ("nutrition", ("מזון", "food", "פחית", "שק ", 'ק"ג', "ויטמין", "תוסף", "חטיף", "diet")),
    ("equipment", ("מזרק", "מחט", "כפפ", "חוט", "syring", "needle", "glove", "sutur", "קטטר", "cathet",
                   "תחבוש", "gauze", "גזה", "swab", "bandag", "catgut", "clinisorb", "clinisolv", "splint",
                   "microchip", "reader", "test", "pill", "cutanplast", "collar", "מתלה", "display")),
]
LAB_CAT_TOPIC = {
    "ביוכימיה": "chemistry", "פאנלים": "chemistry", "בדיקות כלליות": "chemistry", "פאנלים - חתולים": "chemistry",
    "פאנלים - כלבים": "chemistry", "פאנלים - עופות": "chemistry", "כליות": "chemistry", "לבלב": "chemistry",
    "לב": "chemistry", "GI": "chemistry", "דלקת": "chemistry",
    "המטולוגיה": "hematology", "ספירת דם": "hematology",
    "הורמונים": "endocrine", "תיירואיד": "endocrine",
    "סרולוגיה": "serology", "זיהומים": "serology", "חיסון": "serology", "סרולוגיה/PCR": "serology",
    "PCR": "pcr", "תרביות": "culture", "פתולוגיה": "pathology", "ציטולוגיה": "pathology",
    "שתן/צואה/תרביות": "urine", "שתן": "urine", "קרישה": "coag",
    "רמת תרופות בדם": "drugs", "תרופות": "drugs", "בדיקות מיוחדות": "other",
}

def _hit(kw, name, low):
    if kw.startswith("~"): return re.search(r"(?<![א-ת])" + kw[1:] + r"(?![א-ת])", name) is not None
    return kw in name or kw in low

def kw_topic(name):
    low = name.lower()
    for t, kws in KW_TOPIC:
        if any(_hit(k, name, low) for k in kws): return t
    return "other"

# Vet-diet food names carry the indication in the product line name (Renal / רינאל / Gastro …).
FOOD_KW = [
    ("kidney", ("רינאל", "renal", "urinary", "אורינרי", "שתן", "כליה", "s/o", "uc ", "ct urin")),
    ("gi", ("גסטרו", "gastro", "intestinal", "אנטריק", "enteric", "digest", "פיברה", "fibre", "fiber",
            "ריקברי", "recovery", "קונבלסנס", "convalescence", "דל שומן", "low fat", "en ", "ha ", "hypo")),
    ("liver", ("הפאטיק", "hepatic", "כבד", "hp ")),
    ("skin", ("דרמו", "derma", "סקין", "skin", "אלרג", "allerg", "sensitiv", "סנסיטיב", "אטופיק", "atopic", "hf ")),
    ("joints", ("מוביליטי", "mobility", "מפרק", "joint", "ja ")),
    ("dental", ("דנטל", "dental", "שיניים", "oral", "ds ")),
    ("endocrine", ("דיאבטיק", "diabetic", "סוכרת", "glycobalance", "dm ", "היפרתירואיד", "thyro")),
    ("cardio", ("קרדיאק", "cardiac", "~לב", "ck ")),
    ("neuro", ("neuro", "אפילפ", "epilep", "calm", "קאלם")),
    ("onco", ("onco", "סרטן", "tumor")),
]
def food_topic(name):
    low = name.lower()
    for t, kws in FOOD_KW:
        if any(_hit(k, name, low) for k in kws): return t
    return "nutrition"

# ---------------------------------------------------------------- price-list registry (dates + sources = manual truth)
DLD = HOME / "Downloads"
REG = {
    # slug: (type, supplier label, price_list_date, source_file_path or None, vat_basis of the raw list, notes)
    "beit-erez":  ("medical", "בית ארז (מילטין)", "2026-07", DLD / "מחירון - חיות קטנות יולי 2026.pdf", "no_vat", "מחירון חיות קטנות יולי 2026"),
    "zoetis":     ("medical", "זואטיס (Zoetis)", "2026", (DLD / "זואטיס תרופות 2026.PDF", DLD / "זואטיס סימפריקה סטרונגהולד 2026.PDF"), "no_vat", "מחיר לווטרינר 2026 — תרופות + סימפריקה/סטרונגהולד"),
    "ferplast":   ("medical", "פרפלסט (Ferplast)", "2026-02", DLD / "מחירון מוצרי פרפלסט 24.2.26.pdf", "no_vat", "מחירון 24.2.2026 — מחיר מחירון (ללא הנחות)"),
    "vetmarket":  ("medical", "וטמרקט", "2026-08", DLD / "מחירון וטמרקט מלא.xlsx", "no_vat", "מחיר מחירון רשמי (לפני הנחה) מאישורי הזמנה עד 08/2026 + מחירון מלא 03/2026; תאריך לכל פריט"),
    "medi-market": ("medical", "מדי-מרקט", "2026-06", None, "with_vat", "מחירי אתר medi-market.co.il (נאספו 30/06/2026)"),
    "petvet":     ("medical", "פט-וט ביומד", "2026-05", DLD / "PRICE LIST 2026.pdf", "no_vat", "מחירון 2026 — כל המותגים (DermatoVet, Zymox, WePharm, VetInnov, Uranotest ועוד)"),
    "rc-vet":     ("food", "Royal Canin VET", "2026-06", DLD / "RC VET Price list JUNE.pdf", "no_vat", "מחירון קמעונאי יוני 2026"),
    "rc-retail":  ("food", "Royal Canin חנויות", "2026-01", DLD / "RC SPT Price list Jan_2026.pdf", "no_vat", "מחירון קמעונאי ינואר 2026"),
    "hills-pd":   ("food", "Hill's Prescription Diet", "2026-04", DLD / "PD_priceList_Apr26.PDF", "no_vat", None),
    "hills-ve":   ("food", "Hill's Vet Essentials", "2026-04", DLD / "PD_priceList_Apr26.PDF", "no_vat", None),
    "vetlife":    ("food", "VetLife", "2025-02", DLD / "PDF" / "מחירון וטלייף 02.25 (1).pdf", "no_vat", None),
    "purina-vet": ("food", "Purina Pro Plan VET", "2026-06", DLD / "פורינה.pdf", "no_vat", "מחיר מחירון ליחידה (ללא הנחות)"),
    "purina-retail": ("food", "Purina Pro Plan חנויות", None, None, "no_vat", None),
    "monge-vet":  ("food", "Monge Vet Solution", "2025-01", DLD / "PDF" / "מחירון מונג וט סלושיין  - ינואר 2025 (1).pdf", "no_vat", None),
    "monge":      ("food", "Monge", "2025-01", DLD / "PDF" / "מחירון מונג  פיש יבשים - ינואר 2025 (1).pdf", "no_vat", None),
    "foodiez":    ("food", "Foodiez", None, None, "no_vat", None),
    "aml":        ("labs", "AML", "2026-06", DLD / "מחירון 2026.pdf", "with_vat", "בתוקף מ-1.6.2026"),
    "hamachon":   ("labs", "המכון (מעבדה חיצונית)", "2026-01", DLD / "מחירון מעבדה חיצונית לשנת 2026 (1) (1).docx", "no_vat", None),
    "idexx":      ("labs", "IDEXX", "2025-01", DLD / "PDF" / "מחירון רפרנס איידקס 2025.pdf", "no_vat", None),
    "karnieli":   ("labs", "קרניאלי", "2025-01", DLD / "PDF" / "מחירון פאנלים 2025 (2).pdf", "no_vat", None),
    "banet":      ("labs", "פרופ' בנעט", None, None, "no_vat", None),
}
FOOD_COMPANY_SLUG = {"RC VET": "rc-vet", "RC חנויות": "rc-retail", "Hill's PD": "hills-pd", "Hill's VE": "hills-ve",
                     "VetLife": "vetlife", "Purina": "purina-vet", "Purina חנויות": "purina-retail",
                     "Monge Vet": "monge-vet", "Monge": "monge", "Foodiez": "foodiez"}
FROM_PDF = {"rc-vet", "rc-retail", "purina-vet"}   # dated PDF replaces the undated TS rows
LAB_SLUG = {"AML": "aml", "המכון": "hamachon", "IDEXX": "idexx", "קרניאלי": "karnieli", "פרופ בנעט": "banet"}

def r2(x): return round(float(x) + 1e-9, 2)

def item(slug, name, no_vat, with_vat, category, topic, **kw):
    if no_vat is None and with_vat is not None: no_vat = with_vat / VAT
    if with_vat is None and no_vat is not None: with_vat = no_vat * VAT
    if not no_vat or no_vat < 0.1: return None  # 0 / 0.01 = placeholder, not a price
    with_vat = no_vat * VAT  # single 18% basis everywhere (raw lists mix 17%/18%)
    d = {"name": name.strip(), "category": (category or "").strip() or None, "topic": topic,
         "price_no_vat": r2(no_vat), "price_with_vat": r2(with_vat)}
    for k, v in kw.items():
        if v not in (None, "", []): d[k] = v
    return d

def add(lst, it):
    if it is not None: lst.append(it)

def load(name): return json.load(open(CAN / name, encoding="utf-8"))

def pack_qty(name):
    m = re.search(r"(\d+)\s*(טבל|קפס|כדור|אמפול|פיפט|יח|tab|cap|caps|amp|unit|pcs|ml|מ\"ל|ml)", name, re.I)
    return int(m.group(1)) if m else None

def build():
    lists = {s: [] for s in REG}
    # --- Beit Erez (list price, ex-VAT, bonuses are supplier-published quantity bonuses = public)
    for it in load("beit_erez.json"):
        cat = BE_CANON.get(it["category"], it["category"])
        topic = BE_TOPIC.get(cat) or ("equipment" if any(k in cat for k in ("מעבדה", "בדיקות", "חוטים", "כפפות", "ניתוח", "טובוס", "מזרק", "מחט", "נוזל", "עירוי", "פרפר", "קטטר", "קולר", "חביש")) else kw_topic(it["item_name"]))
        bonus = " / ".join(b for b in (it.get("bonus1"), it.get("bonus2"), it.get("bonus3")) if b)
        notes = re.sub(r"\s*·\s*בונוס:.*$", "", it.get("notes") or "")
        add(lists["beit-erez"], item("beit-erez", it["item_name"], it["price_no_vat"], None, cat, topic,
                                       sku=it.get("code"), animal=it.get("animal"), manufacturer=it.get("manufacturer"),
                                       bonus=bonus, notes=notes, pack_qty=pack_qty(it["item_name"])))
    # --- Vetmarket: TS list (03/2026) + official list price (unit_price BEFORE discount) from order confirmations — newer wins.
    pull = load("server_pull.json")
    inv = {r["sku"]: r for r in pull["vetmarket_invoice_list"]}
    seen = set()
    for it in load("vetmarket.json"):
        topic = VM_TOPIC.get(it["category"]) or kw_topic(it["item_name"])
        r = inv.get(it.get("code")); seen.add(it.get("code"))
        price, pdate = (r["unit_price"], r["date"][:7]) if r else (it["price_no_vat"], "2026-03")
        add(lists["vetmarket"], item("vetmarket", it["item_name"], price, None, it["category"], topic,
                                       sku=it.get("code"), notes=it.get("notes"), pack_qty=pack_qty(it["item_name"]), price_date=pdate))
    for sku, r in inv.items():
        if sku in seen: continue
        add(lists["vetmarket"], item("vetmarket", r["name"], r["unit_price"], None, r.get("category"), kw_topic(r["name"]),
                                       sku=sku, pack_qty=pack_qty(r["name"]), price_date=r["date"][:7]))
    # --- Pet-Vet Biomed: full 2026 price list (PDF, all brands). category = brand.
    for it in load("importer_2026.json"):
        add(lists["petvet"], item("petvet", it["name"], it["price_no_vat"], None, it.get("category"),
                                    kw_topic(it["name"]), sku=it.get("sku"), bonus=it.get("bonus"),
                                    pack_qty=pack_qty(it["name"])))
    # --- Zoetis 2026 (two sheets: meds + parasiticides)
    for it in load("zoetis_2026.json"):
        cat = it.get("category") or ""
        add(lists["zoetis"], item("zoetis", it["name"], it["price_no_vat"], None, cat,
                                    kw_topic(cat) if kw_topic(cat) != "other" else kw_topic(it["name"]),
                                    pack_qty=pack_qty(it["name"])))
    # --- Ferplast (equipment/accessories); the "25% off" column in the source is dropped on purpose.
    for it in load("ferplast_2026_02.json"):
        add(lists["ferplast"], item("ferplast", it["name"], it["price_no_vat"], None, it.get("category"),
                                      kw_topic(it["name"]) if kw_topic(it["name"]) != "other" else "equipment",
                                      sku=it.get("sku")))
    # --- Medi-Market: PUBLIC WEBSITE prices (regular_price, incl. VAT). medimarket_ts.json is NOT used (negotiated prices).
    for r in pull["medimarket"]:
        cl = json.loads(r["categories"] or "[]"); name = r["name"].replace("&quot;", '"').replace("&amp;", "&")
        add(lists["medi-market"], item("medi-market", name, None, r["regular_price"], cl[0] if cl else None,
                                         kw_topic(name), sku=r["sku"], pack_qty=pack_qty(name)))
    # --- Food from the clinic TS catalog: purchasePriceNoVat only (customerPriceWithVat = clinic sale
    #     price, deliberately dropped). Companies that now have a dated PDF are skipped here.
    for it in load("vet_food_catalog.json"):
        slug = FOOD_COMPANY_SLUG[it["company"]]
        if slug in FROM_PDF: continue
        add(lists[slug], item(slug, it["name"], it["purchasePriceNoVat"], None, it["indication"],
                                FOOD_IND_TOPIC.get(it["indication"], "nutrition"), animal=it.get("animal"), unit=it.get("weight")))
    # --- Food from dated supplier PDFs (list price, ex-VAT) — replaces the undated TS rows above.
    for slug, src in (("rc-vet", "rc_vet_2026_06.json"), ("rc-retail", "rc_spt_2026_01.json"),
                      ("purina-vet", "purina_2026_06.json")):
        for it in load(src):
            name = it["name"]
            add(lists[slug], item(slug, name, it["price_no_vat"], None, it.get("category"), food_topic(name),
                                    sku=it.get("sku"), unit=it.get("unit"),
                                    animal=it.get("animal") or ("חתול" if "חתול" in name else ("כלב" if "כלב" in name else None))))
    # --- Labs
    for it in load("lab_catalog.json"):
        slug = LAB_SLUG[it["lab"]]
        add(lists[slug], item(slug, it["name"], it.get("price_no_vat"), it.get("price_with_vat"), it["category"],
                                LAB_CAT_TOPIC.get(it["category"], "other"), sku=it.get("code"), notes=it.get("notes")))

    # --- write
    for d in ("food", "medical", "labs"): (DATA / d).mkdir(parents=True, exist_ok=True)
    index = []
    for slug, (typ, label, date, src, vat_basis, note) in REG.items():
        items = lists[slug]
        if not items: continue                           # nothing priced -> not a price list
        for i, it in enumerate(items, 1): it["id"] = f"{slug}-{i}"
        src_rel = None
        if slug == "hills-ve": src_rel = "sources/food/hills-pd-2026-04.pdf"  # same PDF as PD — don't duplicate
        elif src:
            paths = list(src) if isinstance(src, tuple) else [src]
            rels = []
            for i, sp in enumerate(paths):
                if not sp.exists(): continue
                (SRC / typ).mkdir(parents=True, exist_ok=True)
                dst = SRC / typ / f"{slug}-{date}{'' if i == 0 else f'-{i+1}'}{sp.suffix.lower()}"
                if not dst.exists(): shutil.copy2(sp, dst)
                rels.append(f"sources/{typ}/{dst.name}")
            src_rel = rels[0] if rels else None
            if len(rels) > 1: extra_srcs = rels[1:]
        extra_srcs = locals().get("extra_srcs") if False else None
        status = "missing_source" if not date else ("stale" if date < stale_cutoff() else "current")
        meta = {"slug": slug, "type": typ, "supplier": label, "price_list_date": date, "source_file": src_rel,
                "vat_basis": vat_basis, "vat_rate": 18, "item_count": len(items), "status": status,
                "imported_at": TODAY, "notes": note}
        json.dump({"meta": meta, "items": items}, open(DATA / typ / f"{slug}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        index.append(meta)
    tax = {"topics": TOPICS, "lab_topics": LAB_TOPICS, "food_indications": sorted({i["category"] for s in FOOD_COMPANY_SLUG.values() for i in lists[s] if i["category"]})}
    json.dump({"built_at": TODAY, "vat_rate": 18, "pricelists": index, "taxonomy": tax}, open(DATA / "index.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return lists, index

def stale_cutoff():
    d = datetime.date.today() - datetime.timedelta(days=365)  # annual lists are normal; >12 months = stale
    return d.strftime("%Y-%m")

def xlsx(lists, index):
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
    except ImportError:
        print("openpyxl missing — skipping xlsx"); return
    out = ROOT / "downloads"; out.mkdir(parents=True, exist_ok=True)
    by_type = {}
    for m in index: by_type.setdefault(m["type"], []).append(m["slug"])
    heb = {"food": "מזון", "medical": "מוצרים ותרופות", "labs": "מעבדות"}
    for typ, slugs in by_type.items():
        wb = Workbook(); ws = wb.active; ws.title = "הגדרות"; ws.sheet_view.rightToLeft = True
        ws.append(["ספק", "ההנחה שלי %", "מרווח %", "מרווח ₪ קבוע"])
        for c in ws[1]: c.font = Font(bold=True)
        sup_rows = {}
        for s in slugs:
            m = next(x for x in index if x["slug"] == s)
            ws.append([m["supplier"], 0, 0, 0]); sup_rows[s] = ws.max_row
        ws.append([]); ws.append(["נוסחה: עלות = מחיר ללא מע\"מ × (1 − הנחה) × 1.18 ; מחיר ללקוח = עלות × (1 + מרווח %) + מרווח ₪"])
        ws2 = wb.create_sheet(heb[typ]); ws2.sheet_view.rightToLeft = True
        hdr = ["ספק", "פריט", "קטגוריה", "מק\"ט", "תאריך מחירון", "מחיר ללא מע\"מ", "מחיר כולל מע\"מ", "הנחה %", "עלות אחרי הנחה (כולל מע\"מ)", "מרווח %", "מרווח ₪", "מחיר ללקוח"]
        ws2.append(hdr)
        for c in ws2[1]: c.font = Font(bold=True); c.fill = PatternFill("solid", fgColor="DCEFEB")
        for s in slugs:
            m = next(x for x in index if x["slug"] == s); r = sup_rows[s]
            for it in lists[s]:
                row = ws2.max_row + 1
                ws2.append([m["supplier"], it["name"], it.get("category"), it.get("sku"), m["price_list_date"], it["price_no_vat"], it["price_with_vat"],
                            f"=הגדרות!B{r}", f"=F{row}*(1-H{row}/100)*1.18", f"=הגדרות!C{r}", f"=הגדרות!D{r}", f"=I{row}*(1+J{row}/100)+K{row}"])
        for col, w in zip("ABCDEFGHIJKL", (18, 55, 20, 12, 12, 14, 14, 9, 18, 9, 9, 14)): ws2.column_dimensions[col].width = w
        wb.save(out / f"{typ}.xlsx")

if __name__ == "__main__":
    lists, index = build()
    xlsx(lists, index)
    for m in index: print(f'{m["type"]:8} {m["slug"]:14} {m["item_count"]:5} {m["price_list_date"] or "—":8} {m["status"]}')
    print("total", sum(m["item_count"] for m in index))
