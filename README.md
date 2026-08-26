# VetPrices — המחירון הווטרינרי הפתוח

מחירוני ספקים לווטרינרים (מזון · מוצרים ותרופות · מעבדות) במקום אחד, עם חיתוך לפי נושא ומתמחר פרטי שחי רק בדפדפן.
מוגש חינם ע"י ד"ר גיל קרן · [ClaudeVet](https://claudevet.com). אתר: https://prices.claudevet.com

**כלל הנתונים:** רק מחירי מחירון רשמיים של הספקים (או מחירי אתר ציבוריים). אין כאן מחירי קנייה בפועל, הנחות או מחירי מכירה של אף מרפאה.

## מבנה
- `data/index.json` — כל המחירונים + תאריך + סטטוס + טקסונומיה · `data/<type>/<slug>.json` — הפריטים
- `sources/` — צילומי המקור (PDF/xlsx/docx) · `downloads/` — xlsx לכל סקציה עם נוסחאות תמחור
- `index.html · app.js · style.css` — האתר (סטטי, ללא backend) · `config.json` — hash של קוד הגישה
- `scripts/build.py` — בונה הכל מ-`_canonical/` (לא בריפו) · `tests/test_build.py` — בדיקת ספירות + פרטיות

## עדכון מחירון
1. קובץ חדש → פרסור ל-`_canonical/` (ראה סקיל `supplier-catalog-import`) 2. `REG` ב-`scripts/build.py`: תאריך + קובץ מקור 3. `python scripts/build.py && python tests/test_build.py` 4. commit + push → השרת מושך.

## החלפת קוד גישה
`python -c "import hashlib;print(hashlib.sha256(b'claudevet-prices::NEWCODE').hexdigest())"` → `config.json`.
