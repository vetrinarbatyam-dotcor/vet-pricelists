/* VetPrices — static app. Data: data/index.json + data/<section>/<slug>.json.
   All pricing lives in localStorage only; nothing is ever sent to a server. */
(() => {
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const VAT = 1.18, PAGE = 150;
const SEC_HEB = { medical: 'מוצרים ותרופות', food: 'מזון', labs: 'מעבדות', shop: 'מוצרי חנויות' };

let INDEX = null, CONFIG = null, cache = {};
let S = { type: null, vat: 'incl', view: 'supplier', mode: 'list', supplier: null, category: null, topic: null, q: '', shown: PAGE, f: {}, margins: true };
let rows = [];

// ---------- pricing store ----------
const PK = 'vp_pricing';
// Tiered pricing: the higher the cost, the smaller the mark-up. A band is defined by its upper
// bound (the last one has none), and prices as cost × mult + add.
const TIERS = [{ to: 100, mult: 2, add: 0 }, { to: 200, mult: 1.8, add: 0 }, { to: 300, mult: 1.6, add: 0 },
               { to: 600, mult: 1.4, add: 0 }, { to: null, mult: 1.3, add: 0 }];
const EMPTY = { sections: {}, suppliers: {}, rows: {}, round: 0, clinicView: 'full',
                tiers: { on: false, bands: TIERS.map(b => ({ ...b })) } };
let P = load();
function load() {
  let p; try { p = Object.assign({}, EMPTY, JSON.parse(localStorage.getItem(PK) || '{}')); } catch { p = { ...EMPTY }; }
  if (!p.tiers || !Array.isArray(p.tiers.bands) || !p.tiers.bands.length) p.tiers = { on: false, bands: TIERS.map(b => ({ ...b })) };
  return p;
}
function bandFor(cost) {
  const bs = P.tiers.bands;
  return bs.find(b => b.to == null || cost <= +b.to) || bs[bs.length - 1];
}
const bandLabel = (b, i) => {
  const from = i ? +P.tiers.bands[i - 1].to || 0 : 0;
  return b.to == null ? `מעל ${fmt0(from)} ₪` : `${fmt0(from)} – ${fmt0(b.to)} ₪`;
};
const fmt0 = n => (+n || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 });
// Where the pricing settings live. The public site keeps them in the browser and nothing ever
// leaves it. The clinic copy (config.json says mode:"clinic") keeps one file on the server, so
// every computer in the clinic sees the same discounts and margins.
// which money columns the clinic price list shows. 'full' is the editable wide table; the rest
// are read-only, and each one drops another column from the left.
const CVIEW = { compact: ['list', 'cost', 'sale'], buysale: ['cost', 'sale'], sale: ['sale'] };
const cview = () => S.margins ? 'full' : (CVIEW[P.clinicView] ? P.clinicView : 'compact');
// entering a price list starts from the stored default; only 'full' opens the editable table
const defMargins = () => (P.clinicView || 'full') === 'full';
const CLINIC_STORE = 'store/clinic-pricing.json';
// which screen the site opens on. The clinic opens on its order list; a vet who came for the
// price lists gets the price lists — and either can change it in the gear.
const startPage = () => P.startPage || (clinicMode ? 'orders' : 'list');
const clinicName = () => (P.clinicName || (clinicMode ? 'מרפאת פט קייר' : '')).trim();
let clinicMode = false, putTimer = null;
function toast(msg, bad) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', bad ? 6000 : 1800);
}
function save() {
  if (!clinicMode) { try { localStorage.setItem(PK, JSON.stringify(P)); } catch {} return; }
  // debounced: typing in a margin box fires save() on every keystroke
  clearTimeout(putTimer);
  putTimer = setTimeout(async () => {
    try {
      const r = await fetch(CLINIC_STORE, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(P) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast('נשמר בשרת ✓');
    } catch (e) { toast('⚠️ השמירה נכשלה (' + e.message + ') — ההגדרות לא נשמרו', true); }
  }, 600);
}
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const fmt = n => n == null ? '' : n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baseSlug = s => s.replace(/-shop$/, '');
// one predicate for every item search in the app — the catalog box and the two item pickers
// used to disagree about which fields count.
const matches = (i, low) => `${i.name} ${i.sku || ''} ${i.notes || ''} ${i.category || ''} ${i.supplier}`.toLowerCase().includes(low);

function params(r) {
  const sec = P.sections[r.sec] || {}, sup = P.suppliers[r.slug] || {}, o = P.rows[r.id] || {};
  const mode = sup.mode || 'pct';
  return {
    discount: o.discount ?? sup.discount ?? 0,
    pct: o.pct ?? (mode === 'pct' ? sup.pct : null) ?? sec.pct ?? 0,
    flat: o.flat ?? (mode === 'flat' ? sup.flat : null) ?? sec.flat ?? 0,
    ovr: Object.keys(o).length > 0,
    // an explicit rule anywhere beats the tiers; the tiers are the fallback default
    ruled: [o.pct, o.flat, mode === 'pct' ? sup.pct : sup.flat, sec.pct, sec.flat].some(v => v != null),
  };
}
function roundTo(v) { const r = +P.round || 0; return r ? Math.ceil(v / r) * r : v; }
function calc(r) {
  const p = params(r);
  const cost = r.price_no_vat * (1 - p.discount / 100) * VAT;
  let { pct, flat } = p, tier = null;
  if (P.tiers.on && !p.ruled) {
    tier = bandFor(cost);
    pct = ((+tier.mult || 1) - 1) * 100; flat = +tier.add || 0;
  }
  return { ...p, pct, flat, tier, cost, sale: roundTo(cost * (1 + pct / 100) + flat) };
}
function setRow(r, field, val) {
  const o = P.rows[r.id] || (P.rows[r.id] = {}), cur = calc(r);
  if (field === 'discount') o.discount = val ?? 0;
  else if (field === 'cost') o.discount = +(100 * (1 - (val ?? cur.cost) / (r.price_no_vat * VAT))).toFixed(2);
  else if (field === 'pct') o.pct = val ?? 0;
  else if (field === 'flat') o.flat = val ?? 0;
  // invert against the flat that will apply once the override exists: a tier's ₪-add stops
  // the moment o.pct is set, so cur.flat (which may be the tier's) would miss the typed price
  else if (field === 'sale' && cur.cost) o.pct = +(100 * (((val ?? cur.sale) - params(r).flat) / cur.cost - 1)).toFixed(2);
  save();
}

// ---------- data ----------
// no-cache = revalidate every load, so a rebuilt price list shows up without a version stamp.
async function getJSON(u) {
  // the offline bundle carries every file inline, so it never touches the network
  const emb = window.__VP_EMBED;
  if (emb && Object.prototype.hasOwnProperty.call(emb, u)) return JSON.parse(JSON.stringify(emb[u]));
  const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) throw new Error(u); return r.json();
}
async function loadSec(sec) {
  if (cache[sec]) return cache[sec];
  const metas = INDEX.pricelists.filter(m => m.type === sec);
  const lists = await Promise.all(metas.map(m => getJSON(`data/${sec}/${m.slug}.json`)));
  lists.forEach(l => l.items.forEach(it => Object.assign(it, {
    slug: l.meta.slug, supplier: l.meta.supplier, sec, date: l.meta.price_list_date,
    status: l.meta.status, src: it.source || l.meta.source_file, kind: MARK[l.meta.source_kind] ? l.meta.source_kind : null,
  })));
  cache[sec] = lists; return lists;
}
const topicsFor = sec => sec === 'labs' ? INDEX.taxonomy.lab_topics : sec === 'shop' ? INDEX.taxonomy.shop_topics : INDEX.taxonomy.topics;
const statusCls = s => s === 'current' ? 'ok' : s === 'stale' ? 'stale' : 'missing';
const statusHeb = s => s === 'current' ? 'עדכני' : s === 'stale' ? 'ישן' : 'אין מקור';

// ---------- pages ----------
function show(page) {
  ['home', 'catalog', 'settings', 'calc', 'status', 'help', 'orders'].forEach(p => $('#' + p).hidden = p !== page);
  $('.tabs').style.visibility = page === 'home' ? 'hidden' : '';
  // in the clinic copy the section tabs are a second bar that only exists over a price list
  document.body.classList.toggle('on-catalog', page === 'catalog');
  // the three header buttons — הזמנות · מחירונים · מחירון המרפאה — are the same everywhere
  $('.mode-seg').style.visibility = '';
}
function goHome() {
  S.type = null; $$('#tabs button').forEach(b => b.classList.remove('on'));
  const p = startPage();
  if (p === 'orders') { show('orders'); renderOrders(); return; }
  setModeSeg(p === 'clinic' ? 'clinic' : 'list');
  if (p === 'clinic' && clinicMode) return openSec('medical');
  show('home');
}
function setModeSeg(m) {
  S.mode = m; S.margins = defMargins();
  $$('[data-mode]').forEach(x => x.classList.toggle('on', x.dataset.mode === m));
}

async function openSec(sec) {
  S.type = sec; S.supplier = S.category = S.topic = null; S.q = ''; S.shown = PAGE; S.f = {};
  S.margins = defMargins();
  $('#q').value = '';
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.type === sec));
  show('catalog'); await render();
}

// ---------- catalog ----------
async function render() {
  const lists = await loadSec(S.type);
  const chips = $('#chips'); chips.innerHTML = '';
  if (S.view === 'supplier') {
    chips.appendChild(mk('הכל', !S.supplier, () => { S.supplier = S.category = null; S.shown = PAGE; render(); }));
    lists.forEach(l => chips.appendChild(mk(l.meta.supplier, S.supplier === l.meta.slug,
      () => { S.supplier = l.meta.slug; S.category = null; S.shown = PAGE; render(); }, l.items.length, l.meta.status,
      l.meta.source_kind)));

    const sub = $('#subchips'); sub.innerHTML = ''; sub.hidden = true;
    if (S.supplier) {
      const l = lists.find(x => x.meta.slug === S.supplier), cats = {};
      l.items.forEach(i => { if (i.category) cats[i.category] = (cats[i.category] || 0) + 1; });
      const keys = Object.keys(cats).sort((a, b) => cats[b] - cats[a]);
      if (keys.length > 1) {
        sub.hidden = false;
        sub.appendChild(mk(`הכל — ${l.meta.supplier}`, !S.category, () => { S.category = null; S.shown = PAGE; render(); }));
        keys.forEach(k => sub.appendChild(mk(k, S.category === k, () => { S.category = k; S.shown = PAGE; render(); }, cats[k])));
      }
    }
  } else {
    $('#subchips').hidden = true;
    const counts = {}; lists.forEach(l => l.items.forEach(i => counts[i.topic] = (counts[i.topic] || 0) + 1));
    chips.appendChild(mk('כל הנושאים', !S.topic, () => { S.topic = null; S.shown = PAGE; render(); }));
    topicsFor(S.type).forEach(([k, lab]) => counts[k] && chips.appendChild(mk(lab, S.topic === k,
      () => { S.topic = k; S.shown = PAGE; render(); }, counts[k])));
  }
  renderFacets(lists);
  const q = S.q.trim().toLowerCase();
  rows = [];
  lists.forEach(l => l.items.forEach(i => {
    if (S.view === 'supplier' && S.supplier && i.slug !== S.supplier) return;
    if (S.view === 'supplier' && S.category && i.category !== S.category) return;
    if (S.view === 'topic' && S.topic && i.topic !== S.topic) return;
    if (!facetOk(i)) return;
    if (q && !matches(i, q)) return;
    rows.push(i);
  }));
  if (S.view === 'topic' || !S.supplier) rows.sort((a, b) => a.supplier.localeCompare(b.supplier, 'he') || a.name.localeCompare(b.name, 'he'));
  $('#count').textContent = `${rows.length.toLocaleString('he-IL')} פריטים`;
  const l1 = S.supplier && lists.find(x => x.meta.slug === S.supplier);
  $('#listNote').textContent = l1 ? `מחירון ${l1.meta.price_list_date || 'ללא תאריך'}${l1.meta.notes ? ' · ' + l1.meta.notes : ''}` : '';
  $('#dl').href = `downloads/${S.type}.xlsx`;
  $('#clinicBar').hidden = S.mode !== 'clinic';
  $('#marginsBtn').hidden = S.mode !== 'clinic';
  $('#marginsBtn').textContent = S.margins ? '🙈 הסתר מרווחים' : '👁 הצג מרווחים';
  $('.cb-formula').textContent = P.tiers.on
    ? 'תמחור לפי טווחי מחיר פעיל — מחיר ללקוח = עלות × מכפיל הטווח + תוספת. מרווח שהוגדר לספק/סקציה/שורה גובר.'
    : 'עלות = מחיר מחירון × (1 − הנחה) × 1.18 · מחיר ללקוח = עלות × (1 + מרווח %) + מרווח ₪';
  renderTable();
}
// Food-only facets. A row that has no value for a facet shows under "הכל" and disappears once a
// specific value is picked — a therapeutic diet has no life stage, and a cat food has no dog size.
const FACET_LABEL = { kind: 'סוג המזון', form: 'יבש / רטוב', stage: 'שלב חיים',
                      animal: 'חיה', dogsize: 'גודל הכלב' };
const ANIMALS = [['כלב', 'כלב'], ['חתול', 'חתול']];
function facetOk(i) {
  return Object.entries(S.f).every(([k, v]) => !v || i[k] === v);
}
function renderFacets(lists) {
  const box = $('#facets');
  if (S.type !== 'food') { box.hidden = true; box.innerHTML = ''; return; }
  const defs = INDEX.taxonomy.food_facets || {};
  const order = [['kind', defs.kind], ['form', defs.form], ['stage', defs.stage],
                 ['animal', ANIMALS], ['dogsize', defs.dogsize]];
  box.hidden = false; box.innerHTML = '';
  order.forEach(([key, vals]) => {
    if (!vals) return;
    // count against every other facet, so each row's numbers stay true for the current view
    const rest = { ...S.f }; delete rest[key];
    const n = {};
    lists.forEach(l => l.items.forEach(i => {
      if (!Object.entries(rest).every(([k, v]) => !v || i[k] === v)) return;
      if (S.supplier && i.slug !== S.supplier) return;
      if (i[key]) n[i[key]] = (n[i[key]] || 0) + 1;
    }));
    if (!vals.some(([k]) => n[k])) return;
    const g = document.createElement('div');
    g.className = 'facet';
    g.innerHTML = `<span class="flab">${FACET_LABEL[key]}</span>`;
    const pick = v => { S.f[key] = S.f[key] === v ? null : v; S.shown = PAGE; render(); };
    g.appendChild(mk('הכל', !S.f[key], () => pick(null)));
    vals.forEach(([k, lab]) => n[k] && g.appendChild(mk(lab, S.f[key] === k, () => pick(k), n[k])));
    box.appendChild(g);
  });
}
// Vetmarket has no published price list — its prices are parsed out of order confirmations.
// Rows that came that way are marked so nobody reads them as a supplier price list.
const MARK = {
  invoices: { sym: '✻', text: 'מפורסר מאישורי הזמנה — אין מחירון מפורסם לספק הזה' },
  internal: { sym: '*', text: 'ללא מקור — מחירים מקובץ המרפאה, אין מחירון מפורסם ולא אומתו מול הספק' },
};
const INV = MARK.invoices.sym;
const INV_TEXT = MARK.invoices.text;
function mk(label, on, fn, n, status, kind) {
  const m = MARK[kind];
  const b = document.createElement('button');
  b.className = 'chip' + (on ? ' on' : '') + (m ? ' parsed ' + kind : '');
  b.innerHTML = esc(label) + (m ? `<i class="inv ${kind}" title="${m.text}">${m.sym}</i>` : '') +
    (n != null ? `<small>${n}</small>` : '') +
    (status ? `<span class="st ${statusCls(status)}" title="${statusHeb(status)}"></span>` : '');
  b.onclick = fn; return b;
}
function renderTable() {
  const incl = S.vat === 'incl', pr = S.mode === 'clinic';
  const wide = pr && S.margins;
  const cols = pr && !wide ? CVIEW[cview()] : null;
  const showList = !cols || cols.includes('list');
  // on a phone the full header wraps to four lines and eats the column; the מע״מ toggle
  // sitting right above the table already says which basis is showing.
  const narrow = matchMedia('(max-width:700px)').matches;
  const th = [['ספק', 0], ['פריט', 0], ['קטגוריה', 0], ['מק״ט', 0]];
  if (showList) th.push([narrow ? 'מחיר' : (incl ? 'מחיר מחירון (כולל מע״מ)' : 'מחיר מחירון (ללא מע״מ)'), 1]);
  th.push(['מחירון', 0]);
  if (wide) th.push(['הנחה %', 1], ['עלות', 1], ['מרווח %', 1], ['₪ קבוע', 1], ['מחיר ללקוח', 1], ['', 1]);
  else if (pr) {
    if (cols.includes('cost')) th.push(['מחיר קנייה (כולל מע״מ)', 1]);
    th.push(['מחיר ללקוח', 1]);
  }
  $('#thead').innerHTML = th.map(([h, n]) => `<th class="${n ? 'num' : ''}">${h}</th>`).join('');
  const tb = $('#tbody'); tb.innerHTML = '';
  const frag = document.createDocumentFragment();
  rows.slice(0, S.shown).forEach(r => {
    const tr = document.createElement('tr'), c = pr ? calc(r) : null;
    if (c && c.ovr) tr.className = 'ovr';
    const extra = [r.unit, r.animal, r.bonus ? 'בונוס ' + r.bonus : '', r.manufacturer, r.notes].filter(Boolean);
    let h = `<td class="sup">${esc(r.supplier)}</td>` +
      `<td class="name">${esc(r.name)}${extra.length ? `<small>${extra.map(esc).join(' · ')}</small>` : ''}</td>` +
      `<td>${esc(r.category || '')}</td><td class="num">${esc(r.sku || '')}</td>` +
      (showList ? `<td class="num price">${fmt(incl ? r.price_with_vat : r.price_no_vat)}</td>` : '') +
      `<td><span class="date ${statusCls(r.status)}${r.kind ? ' parsed ' + r.kind : ''}"${r.kind ? ` title="${MARK[r.kind].text}"` : ''}>` +
      `${r.kind ? MARK[r.kind].sym + ' ' : ''}${r.price_date || r.date || 'ללא תאריך'}</span>` +
      `${r.src ? ` <a class="src" href="${r.src}" target="_blank" rel="noopener" title="צילום המקור">📄</a>` : ''}</td>`;
    if (pr && !S.margins) {
      if (cols.includes('cost')) h += `<td class="num buyprice">${fmt(c.cost)}</td>`;
      h += `<td class="num price cust-ro">${fmt(c.sale)}</td>`;
    } else if (pr) {
      const o = P.rows[r.id] || {};
      const inp = (f, v, step, on) => `<td class="edit"><input type="number" step="${step}" data-f="${f}" value="${v}"${on ? ' class="ovr"' : ''}></td>`;
      h += inp('discount', +c.discount.toFixed(1), 0.5, o.discount != null) +
        inp('cost', +c.cost.toFixed(2), 0.1, o.discount != null) +
        inp('pct', +c.pct.toFixed(1), 1, o.pct != null) +
        inp('flat', +c.flat.toFixed(0), 1, o.flat != null) +
        `<td class="edit cust"><input type="number" step="0.5" data-f="sale" value="${+c.sale.toFixed(2)}"${o.pct != null ? ' class="ovr"' : ''}></td>` +
        `<td>${c.ovr ? '<button class="ghost small" data-clear title="חזרה לברירת המחדל">↺</button>' : ''}</td>`;
    }
    tr.innerHTML = h;
    if (wide) {
      tr.querySelectorAll('input').forEach(i => i.addEventListener('change', () => { setRow(r, i.dataset.f, num(i.value)); renderTable(); }));
      tr.querySelector('[data-clear]')?.addEventListener('click', () => { delete P.rows[r.id]; save(); renderTable(); });
    }
    frag.appendChild(tr);
  });
  tb.appendChild(frag);
  $('#more').hidden = rows.length <= S.shown;
  $('#empty').hidden = rows.length > 0;
}

// ---------- settings ----------
function renderSettings() {
  const sg = $('#secGrid'); sg.innerHTML = '';
  Object.entries(SEC_HEB).forEach(([k, heb]) => {
    const s = P.sections[k] || {}, d = document.createElement('div');
    d.className = 'sec-card';
    d.innerHTML = `<b>${heb}</b>
      <label>מרווח % <input type="number" step="1" data-sec="${k}" data-k="pct" value="${s.pct ?? ''}" placeholder="0"></label>
      <label>₪ קבוע <input type="number" step="1" data-sec="${k}" data-k="flat" value="${s.flat ?? ''}" placeholder="0"></label>`;
    d.querySelectorAll('input').forEach(i => i.addEventListener('change', () => {
      const o = P.sections[k] || (P.sections[k] = {}), v = num(i.value);
      if (v == null) delete o[i.dataset.k]; else o[i.dataset.k] = v;
      save(); renderSettings(); cache && renderTableIfOpen();
    }));
    sg.appendChild(d);
  });
  const q = ($('#supQ').value || '').trim();
  const metas = INDEX.pricelists.filter(m => !q || m.supplier.includes(q));
  $('#supCount').textContent = `${metas.length} מחירונים`;
  const tb = $('#supBody'); tb.innerHTML = '';
  metas.forEach(m => {
    const s = P.suppliers[m.slug] || {}, mode = s.mode || 'pct';
    const tr = document.createElement('tr');
    // the sample must go through the same calc() as the real table — a hand-rolled formula here
    // applied pct XOR flat and skipped the tiers, and understated whenever both were set
    const sale = calc({ id: '', sec: m.type, slug: m.slug, price_no_vat: 100 }).sale;
    tr.innerHTML = `<td>${esc(m.supplier)}</td><td>${SEC_HEB[m.type]}</td><td class="num">${m.item_count}</td>
      <td class="edit buy"><input type="number" step="0.5" data-s="${m.slug}" data-k="discount" value="${s.discount ?? ''}" placeholder="0"> <span class="pc">%</span></td>
      <td><select data-s="${m.slug}" data-k="mode">
            <option value="pct"${mode === 'pct' ? ' selected' : ''}>אחוז מהעלות</option>
            <option value="flat"${mode === 'flat' ? ' selected' : ''}>תוספת קבועה ₪</option></select></td>
      <td class="edit"><input type="number" step="1" data-s="${m.slug}" data-k="${mode}" value="${(mode === 'pct' ? s.pct : s.flat) ?? ''}" placeholder="ברירת מחדל"></td>
      <td class="hint">מחירון 100₪ → <b>${fmt(sale)} ₪</b></td>`;
    tr.querySelectorAll('input,select').forEach(el => el.addEventListener('change', () => {
      const o = P.suppliers[m.slug] || (P.suppliers[m.slug] = {}), k = el.dataset.k;
      if (k === 'mode') o.mode = el.value;
      else { const v = num(el.value); if (v == null) delete o[k]; else o[k] = v; }
      save(); renderSettings(); renderTableIfOpen();
    }));
    tb.appendChild(tr);
  });
  const oc = $('#ordCats');
  if (oc) {
    oc.innerHTML = '';
    CATS.forEach(([k, lab, ico]) => {
      const w = document.createElement('label');
      w.className = 'ordcat';
      w.innerHTML = `<input type="checkbox"${O.cats.includes(k) ? ' checked' : ''}> ${ico} ${esc(lab)}`;
      w.querySelector('input').addEventListener('change', e => {
        const cur = new Set(O.cats);
        if (e.target.checked) cur.add(k); else cur.delete(k);
        O.cats = CATS.map(([c]) => c).filter(c => cur.has(c));
        if (OS.cat && !O.cats.includes(OS.cat)) OS.cat = null;
        fillOrderCats(); renderOrders(); saveCats();
      });
      oc.appendChild(w);
    });
  }
  $$('#startSeg button').forEach(b => b.classList.toggle('on', b.dataset.start === startPage()));
  $('#clinicName').value = P.clinicName || '';
  $$('#roundSeg button').forEach(b => b.classList.toggle('on', +b.dataset.round === (+P.round || 0)));
  $$('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.cview === (P.clinicView || 'full')));
}
function renderTableIfOpen() { if (!$('#catalog').hidden && S.mode === 'clinic') renderTable(); }

// ---------- calculator ----------
let ALL = null;
async function calcSuggest(q) {
  if (!ALL) {
    const lists = (await Promise.all(Object.keys(SEC_HEB).map(loadSec))).flat();
    ALL = lists.flatMap(l => l.items);
  }
  const low = q.toLowerCase();
  return ALL.filter(i => matches(i, low)).slice(0, 8);
}
function calcRun(from) {
  const list = +$('#cList').value || 0, disc = +$('#cDisc').value || 0;
  const costNo = list * (1 - disc / 100), cost = costNo * VAT;
  let pct = +$('#cPct').value || 0, flat = +$('#cFlat').value || 0, sale;
  if (from === 'sale') {
    sale = +$('#cSale').value || 0;
    pct = cost ? +(100 * ((sale - flat) / cost - 1)).toFixed(1) : 0;
    $('#cPct').value = pct;
  } else {
    sale = cost * (1 + pct / 100) + flat;
    $('#cSale').value = +sale.toFixed(2);
  }
  const profit = sale - cost;
  $('#rCostNo').textContent = fmt(costNo) + ' ₪';
  $('#rCost').textContent = fmt(cost) + ' ₪';
  $('#rSale').textContent = fmt(sale) + ' ₪';
  $('#rSaleNo').textContent = fmt(sale / VAT) + ' ₪';
  $('#rProfit').textContent = fmt(profit) + ' ₪';
  // what actually stays in the pocket: the VAT share of the margin goes to the state
  $('#rProfitNet').textContent = fmt(profit / VAT) + ' ₪';
  $('#rMarkup').textContent = cost ? (100 * profit / cost).toFixed(1) + '%' : '—';
  $('#rMargin').textContent = sale ? (100 * profit / sale).toFixed(1) + '%' : '—';
}

// ---------- advanced calculator: price bands ----------
const PREVIEW_COSTS = [50, 120, 250, 450, 900, 1800];
function renderAdv() {
  const tb = $('#advBody'); tb.innerHTML = '';
  P.tiers.bands.forEach((b, i) => {
    const last = i === P.tiers.bands.length - 1;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(bandLabel(b, i))}` +
      (last ? '' : ` <input type="number" step="10" class="tin" data-i="${i}" data-f="to" value="${b.to}">`) +
      `</td>` +
      `<td class="num"><input type="number" step="0.05" class="tin" data-i="${i}" data-f="mult" value="${b.mult}"></td>` +
      `<td class="num"><input type="number" step="1" class="tin" data-i="${i}" data-f="add" value="${b.add || 0}"></td>` +
      `<td class="num">${(((+b.mult || 1) - 1) * 100).toFixed(0)}%</td>` +
      `<td class="num">${P.tiers.bands.length > 1 && !last ? `<button class="ghost small trm" data-i="${i}">הסר</button>` : ''}</td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('.tin').forEach(inp => inp.addEventListener('input', () => {
    const b = P.tiers.bands[+inp.dataset.i];
    b[inp.dataset.f] = inp.value === '' ? (inp.dataset.f === 'add' ? 0 : b[inp.dataset.f]) : +inp.value;
    save(); advPreview(); if (S.mode === 'clinic') renderTable();
  }));
  // bounds typed out of order (300 then 200) would make bandFor pick the wrong band; re-sort
  // on blur, not on every keystroke — mid-typing "3" of "300" must not reshuffle the table
  tb.querySelectorAll('.tin[data-f="to"]').forEach(inp => inp.addEventListener('change', () => {
    P.tiers.bands.sort((a, b) => (a.to == null) - (b.to == null) || +a.to - +b.to);
    save(); renderAdv(); if (S.mode === 'clinic') renderTable();
  }));
  tb.querySelectorAll('.trm').forEach(btn => btn.addEventListener('click', () => {
    P.tiers.bands.splice(+btn.dataset.i, 1); save(); renderAdv();
  }));
  $('#advOn').checked = !!P.tiers.on;
  $('#advNote').textContent = P.tiers.on
    ? 'הטווחים פעילים. הם משמשים כברירת מחדל — מרווח שהגדרתם לספק, לסקציה או לשורה בודדת גובר עליהם.'
    : 'הטווחים כבויים כרגע ומשמשים רק להדגמה כאן.';
  advPreview();
}
function advPreview() {
  const tb = $('#advPrev'); tb.innerHTML = '';
  PREVIEW_COSTS.forEach(cost => {
    const i = P.tiers.bands.findIndex(b => b.to == null || cost <= +b.to);
    const b = P.tiers.bands[i < 0 ? P.tiers.bands.length - 1 : i];
    const sale = roundTo(cost * (+b.mult || 1) + (+b.add || 0)), profit = sale - cost;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="num">${fmt(cost)} ₪</td><td>${esc(bandLabel(b, i < 0 ? P.tiers.bands.length - 1 : i))}</td>` +
      `<td class="num price">${fmt(sale)} ₪</td><td class="num">${fmt(profit)} ₪</td>` +
      `<td class="num">${(100 * profit / cost).toFixed(0)}%</td>` +
      `<td class="num">${sale ? (100 * profit / sale).toFixed(0) : 0}%</td>`;
    tb.appendChild(tr);
  });
}

// ---------- status page ----------
const ACT_HEB = { ok: 'מעודכן', refresh: 'צריך מחירון חדש', partial: 'חלקי', no_source: 'חסר קובץ מקור', check: 'לאימות' };
const ACT_CLS = { ok: 'ok', refresh: 'stale', partial: 'stale', no_source: 'missing', check: 'stale' };
function srcCell(m) {
  if (m.source_kind === 'invoices') return `<span class="date parsed invoices" title="${MARK.invoices.text}">${MARK.invoices.sym} מפורסר מחשבוניות</span>`;
  if (m.source_kind === 'internal') return `<span class="date parsed internal" title="${MARK.internal.text}">${MARK.internal.sym} מקובץ המרפאה</span>`;
  const files = m.source_files && m.source_files.length ? m.source_files : (m.source_file ? [m.source_file] : []);
  if (!files.length) return '<span class="date missing">אין קובץ</span>';
  return files.map((f, i) => `<a href="${f}" target="_blank" rel="noopener">📄 ${files.length > 1 ? `מקור ${i + 1}` : 'צילום המקור'}</a>`).join(' · ');
}
function renderStatus() {
  show('status');
  const all = INDEX.pricelists;
  const byAct = {}; all.forEach(m => byAct[m.action] = (byAct[m.action] || 0) + 1);
  const items = all.reduce((s, m) => s + m.item_count, 0);
  const y26 = all.filter(m => (m.price_list_date || '').startsWith('2026')).length;
  $('#statusKpi').innerHTML = [
    [items.toLocaleString('he-IL'), 'פריטים בסך הכל'],
    [`${all.length}`, 'מחירונים טעונים'],
    [`${y26}`, 'מחירונים מ-2026'],
    [`${(byAct.refresh || 0) + (byAct.partial || 0) + (byAct.no_source || 0)}`, 'דורשים טיפול'],
  ].map(([n, l]) => `<div class="kpi"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
  const todo = all.filter(m => m.action !== 'ok').sort((a, b) => a.supplier.localeCompare(b.supplier, 'he'));
  $('#statusTodo').innerHTML = todo.map(m => `<tr>
      <td>${SEC_HEB[m.type]}</td><td>${esc(m.supplier)}</td><td class="num">${m.price_list_date || '—'}</td>
      <td class="num">${m.item_count}</td>
      <td><span class="badge ${ACT_CLS[m.action]}">${ACT_HEB[m.action]}</span></td>
      <td>${esc(m.action_note)}</td></tr>`).join('') || '<tr><td colspan="6">הכל מעודכן.</td></tr>';
  $('#statusOk').innerHTML = all.filter(m => m.action === 'ok')
    .sort((a, b) => (b.price_list_date || '').localeCompare(a.price_list_date || ''))
    .map(m => `<tr><td>${SEC_HEB[m.type]}</td><td>${esc(m.supplier)}</td>
      <td class="num">${m.price_list_date || '—'}</td><td class="num">${m.item_count}</td><td>${srcCell(m)}</td></tr>`).join('');
}

// ---------- orders (clinic copy only) ----------
// The clinic list IS the clinic-pal-hub list: both read and write the same `supply_orders` rows
// in the hub database, so the portal's order centre and this page are one list on every computer.
// The file below is left holding only the category switches — the table has no place for them.
const ORD_STORE = 'store/orders.json';
// nginx on the clinic vhost proxies this one table to the hub API and injects the gateway key,
// so the key never reaches the browser and the public site has no such path (404, like /store/).
const ORD_API = '/api/data/supply_orders';
// the public copy has no server behind it — there the list lives in this browser only,
// exactly like the pricing settings do.
const ORD_LK = 'vp_orders';
const CATS = [['general', 'כללי', '📦'], ['food', 'מזון', '🍖'], ['clean', 'ניקיון', '🧽'],
              ['shop', 'חנות', '🛍️'], ['lab', 'מעבדה חיצונית', '🧪']];
const CAT_HEB = Object.fromEntries(CATS.map(([k, l]) => [k, l]));
const CAT_ICO = Object.fromEntries(CATS.map(([k, , i]) => [k, i]));
const DEF_CATS = ['general', 'food', 'clean', 'lab'];
const SEC_CAT = { medical: 'general', food: 'food', shop: 'shop', labs: 'lab' };
// external labs are not suppliers: a lab line picks from the labs list, everything else from
// the drugs and food price lists — the two the clinic actually places orders with
const SUP_GROUPS = { lab: [['מעבדות חיצוניות', 'labs']],
                     def: [['תרופות וציוד', 'medical'], ['מזון', 'food'], ['מוצרי חנויות', 'shop']] };
// you order from a distributor, not from a price list: Vetmarket distributes Zoetis and MSD,
// and בית ארז's two lists are one account. The price lists keep their own names; this is only
// the name an order is placed under.
const SUP_MERGE = { 'וטמרקט': 'Vetmarket', 'זואטיס (Zoetis)': 'Vetmarket', 'MSD (ברווקטו)': 'Vetmarket',
                    'בית ארז (מילטין)': 'בית ארז', 'בית ארז — ציוד מתכלה': 'בית ארז',
                    // one order goes to the brand, not to each of its lines
                    "Hill's Prescription Diet": "Hill's", "Hill's Science Plan": "Hill's",
                    "Hill's Vet Essentials": "Hill's", 'Monge Vet Solution': 'Monge',
                    'Royal Canin VET': 'Royal Canin', 'Royal Canin חנויות': 'Royal Canin',
                    'Purina Pro Plan VET': 'Purina', 'פורינה (חנויות)': 'Purina',
                    // both Farmina lines come off one price list and one account
                    'VetLife (פרמינה)': 'פרמינה', 'פרמינה N&D': 'פרמינה', 'VetLife': 'פרמינה' };
const supAlias = n => SUP_MERGE[n] || n;
const supNames = type => [...new Set(INDEX.pricelists.filter(m => m.type === type).map(m => supAlias(m.supplier)))]
  .sort((a, b) => a.localeCompare(b, 'he'));
function supOptions(cat, curRaw) {
  const cur = supAlias(curRaw), seen = new Set();
  let html = '<option value="">— ללא ספק —</option>';
  (cat === 'lab' ? SUP_GROUPS.lab : SUP_GROUPS.def).forEach(([lab, type]) => {
    const names = supNames(type).filter(n => !seen.has(n));
    names.forEach(n => seen.add(n));
    html += `<optgroup label="${esc(lab)}">` + names.map(n =>
      `<option value="${esc(n)}"${n === cur ? ' selected' : ''}>${esc(n)}</option>`).join('') + '</optgroup>';
  });
  // the lines imported from clinic-pal carry supplier names that predate these price lists —
  // without this the select would silently drop the one the row already has
  if (cur && !seen.has(cur)) html += `<option value="${esc(cur)}" selected>${esc(cur)}</option>`;
  return html + '<option value="__other">אחר… (הקלדה)</option>';
}
// which price lists a category orders from — 'clean' has none yet, and will fill itself the
// day a cleaning price list lands in data/
const SEC_FOR_CAT = { general: ['medical'], food: ['food'], clean: ['clean'], shop: ['shop'], lab: ['labs'] };
const ALL_SEC = ['medical', 'food', 'shop', 'labs'];
const heSort = ns => ns.sort((a, b) => a.localeCompare(b, 'he'));
function fillSupSeg() {
  const cur = $('#oSup').value;
  const mine = heSort([...new Set((SEC_FOR_CAT[$('#oCat').value] || []).flatMap(supNames))]);
  if (cur && !mine.includes(cur)) mine.unshift(cur);
  // everyone else sits in one dropdown at the end of the row, so the common case stays one click
  const rest = heSort([...new Set(ALL_SEC.flatMap(supNames))].filter(n => !mine.includes(n)));
  $('#oSupSeg').innerHTML = mine.map(n =>
      `<button type="button" data-os="${esc(n)}"${n === cur ? ' class="on"' : ''}>${esc(n)}</button>`).join('') +
    '<select id="oSupOther" aria-label="ספק אחר"><option value="">ספק אחר…</option>' +
    rest.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('') +
    '<option value="__type">＋ הקלדה…</option></select>';
  $$('#oSupSeg button').forEach(b => b.addEventListener('click', () =>
    setSupVal($('#oSup').value === b.dataset.os ? '' : b.dataset.os)));   // pressing the pressed one clears it
  $('#oSupOther').addEventListener('change', e => setSupVal(e.target.value === '__type'
    ? (prompt('שם הספק:', $('#oSup').value) || '').trim() : e.target.value));
}
function setSupVal(name) { $('#oSup').value = supAlias(name) || ''; fillSupSeg(); }
function setSup(sel, nameRaw) {
  const name = supAlias(nameRaw);
  if (name && ![...sel.options].some(o => o.value === name))
    sel.insertAdjacentHTML('afterbegin', `<option value="${esc(name)}">${esc(name)}</option>`);
  sel.value = name || '';
}
// a select cannot hold a name that is not on the list; this is the way out
function supOther(sel, cur) {
  const v = (prompt('שם הספק:', cur || '') || '').trim();
  setSup(sel, v);
  return v;
}
// the statuses the staff already knows from clinic-pal-hub, verbatim
const ST = { pending: 'ממתין', missing: 'חסר', in_delivery: 'במשלוח', ordered: 'הוזמן', received: 'התקבל' };
const LAB_ST = { taken: 'נלקח', sent: 'נשלח', back: 'חזר', reported: 'דווח' };
// what was ordered sinks to the bottom of the list — same order the staff is used to
const ST_ORDER = { pending: 0, missing: 1, in_delivery: 2, received: 3, ordered: 4,
                   taken: 0, sent: 1, back: 2, reported: 3 };
const DONE = { received: 1, reported: 1 }, STRUCK = { received: 1, ordered: 1, reported: 1 };
const OPEN_ST = { pending: 1, missing: 1, taken: 1, sent: 1 };
const stFor = cat => cat === 'lab' ? LAB_ST : ST;
const DAY = 864e5, HIDE_DONE_AFTER = 30 * DAY, TOMB_TTL = 90 * DAY;

let O = { v: 1, cats: DEF_CATS.slice(), lines: [] };
let OS = { cat: null, sup: null, filter: 'active', q: '', hist: false };
let ordTimer = null, sheetIds = null, picked = null;

const oid = () => 'o-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
const dShort = ts => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }); };

// --- pure helpers (also exercised by tests/test_orders.js) ---
function sortLines(ls) {
  return ls.slice().sort((x, y) => (ST_ORDER[x.status] ?? 9) - (ST_ORDER[y.status] ?? 9) ||
    (y.created_at || '').localeCompare(x.created_at || ''));
}
function sheetText(lines, today, clinic) {
  const by = {};
  lines.forEach(l => (by[l.supplier || 'ללא ספק'] = by[l.supplier || 'ללא ספק'] || []).push(l));
  const d = today || new Date().toLocaleDateString('he-IL');
  const out = [];
  Object.keys(by).sort((a, b) => a.localeCompare(b, 'he')).forEach(sup => {
    out.push(`📦 הזמנה — ${sup}`, d, '');
    by[sup].forEach(l => out.push(`• ${l.name} — ${l.qty} יח'` + (l.client ? ` (ל${l.client})` : '')));
    out.push('', `סה"כ פריטים: ${by[sup].length}`, '');
  });
  if (clinic) out.push(clinic);
  return out.join('\n');
}

// --- the hub row <-> our line ---
// clinic-pal-hub keeps the category in front of the item name and the client inside the notes;
// its own tabs filter on exactly these strings, so a line written without them disappears from
// the portal. Everything the portal has no concept of (supplier, slug, sku, price, paid, and the
// two categories it never had) sits in columns of its own.
const CAT_PREFIX = { food: '[מזון] ', clean: '[ניקיון] ' };
const CLIENT_RE = /\[לקוח:(.+?)\]/, PHONE_RE = /\[טל:(.+?)\]/;
const isoOf = t => { const d = new Date(t); return isNaN(d) ? new Date().toISOString() : d.toISOString(); };

function fromRow(r) {
  let name = (r.item_name || '').trim(), cat = r.cat || 'general';
  for (const k in CAT_PREFIX) if (name.startsWith(CAT_PREFIX[k])) {
    name = name.slice(CAT_PREFIX[k].length).trim();
    if (!r.cat) cat = k;      // a row the portal created carries its category only here
    break;
  }
  name = name.replace(/^חופשי\|/, '').trim();
  const sup = (r.supplier || '').trim();
  // a food line is written "<brand> - <item>" so the portal shows which brand it is; here the
  // brand is already the supplier chip, so it is only noise in the name
  if (sup && name.startsWith(sup + ' - ')) name = name.slice(sup.length + 3).trim();
  const notes = r.notes || '', cl = notes.match(CLIENT_RE), ph = notes.match(PHONE_RE);
  return { id: r.id, cat, name, qty: Math.max(1, parseInt(r.quantity, 10) || 1),
    status: r.status || 'pending', supplier: sup, slug: r.slug || '', sku: r.sku || '',
    price: r.price == null || r.price === '' ? null : +r.price,
    client: cl ? cl[1].trim() : '', phone: ph ? ph[1].trim() : '', paid: !!r.paid,
    note: notes.replace(new RegExp(CLIENT_RE.source, 'g'), '').replace(new RegExp(PHONE_RE.source, 'g'), '').trim(),
    created_at: isoOf(r.created_at), updated_at: isoOf(r.updated_at || r.created_at) };
}
function toRow(l) {
  const nm = (l.cat === 'food' && l.supplier ? l.supplier + ' - ' : '') + l.name;
  return { item_name: (CAT_PREFIX[l.cat] || '') + nm, quantity: l.qty, status: l.status,
    notes: [l.note, l.client ? `[לקוח:${l.client}]` : '', l.client && l.phone ? `[טל:${l.phone}]` : '']
      .filter(Boolean).join(' ').trim(),
    cat: l.cat, supplier: l.supplier || '', slug: l.slug || '', sku: l.sku || '',
    price: l.price, paid: !!l.paid, updated_at: l.updated_at };
}

// --- storage ---
async function ordApi(path, method, body) {
  const r = await fetch(ORD_API + path, { cache: 'no-cache', method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return method === 'DELETE' ? null : r.json();
}
// ponytail: the whole table in one call (~630 rows today, ~30 more a month). Page it if it ever
// drags — the history toggle wants the old rows anyway, so a 30-day cut would not do.
const ordFetch = () => ordApi('?limit=5000&order_by=created_at&order_dir=asc').then(rs => rs.map(fromRow));

async function loadOrders() {
  const cut = new Date(Date.now() - TOMB_TTL).toISOString();
  const take = s => (O = { v: 1, cats: Array.isArray(s.cats) ? s.cats : DEF_CATS.slice(),
        // ponytail: tombstones expire after 90d; if the file ever gets big, split per line
        lines: (Array.isArray(s.lines) ? s.lines : []).filter(l => !(l.deleted && (l.updated_at || '') < cut)) });
  if (!clinicMode) {
    try { take(JSON.parse(localStorage.getItem(ORD_LK) || '{}')); } catch { take({}); }
    return true;
  }
  try { take(await getJSON(ORD_STORE)); } catch { take({}); }   // categories only; lines follow
  try { O.lines = await ordFetch(); return true; }
  catch { toast('⚠️ לא הצלחנו לטעון את ההזמנות מהשרת', true); return false; }
}
// One row per call. The database is the list, so there is nothing to merge and nothing to read
// back: an update either lands on its row or fails loudly, and two computers cannot overwrite
// each other's lines the way two writers of one file could.
async function saveOrders(ids) {
  if (!clinicMode) {
    try { localStorage.setItem(ORD_LK, JSON.stringify({ v: 1, cats: O.cats, lines: O.lines })); return true; }
    catch (e) { toast('⚠️ השמירה בדפדפן נכשלה (' + e.message + ') — ההזמנה לא נשמרה', true); return false; }
  }
  let ok = true, renumbered = false;
  for (const id of ids) {
    const l = O.lines.find(x => x.id === id);
    if (!l) continue;
    try {
      if (l.deleted) { await ordApi('/' + id, 'DELETE'); O.lines = O.lines.filter(x => x.id !== id); }
      // a line born here carries a local id until the database hands out the real one
      else if (/^o-/.test(id)) { const row = await ordApi('', 'POST', { ...toRow(l), created_at: l.created_at }); l.id = row.id; renumbered = true; }
      else await ordApi('/' + id, 'PUT', toRow(l));
    } catch (e) {
      ok = false;
      toast('⚠️ השמירה נכשלה (' + e.message + ') — "' + (l.name || '') + '" לא נשמר', true);
    }
  }
  // the row on screen still carries the local id it was drawn with, and a click on it would
  // look up a line that no longer answers to that name
  if (renumbered) renderOrders();
  return ok;
}
// the category switches are a display setting, not order data, so they stay in the shared file
async function saveCats() {
  if (!clinicMode) return saveOrders([]);
  try {
    const r = await fetch(ORD_STORE, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                       body: JSON.stringify({ v: 1, cats: O.cats }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return true;
  } catch (e) { toast('⚠️ שמירת הקטגוריות נכשלה (' + e.message + ')', true); return false; }
}
function ordPoll() {
  if (!clinicMode) return;   // one browser, one list — there is nobody to poll against
  clearTimeout(ordTimer);
  ordTimer = setTimeout(async () => {
    if (!$('#orders').hidden && document.visibilityState === 'visible') {
      // the database is the truth: take it whole rather than merge, or a row someone deleted
      // on another computer would live on here
      try { O.lines = await ordFetch(); } catch {}
      try { const s = await getJSON(ORD_STORE); if (Array.isArray(s.cats)) O.cats = s.cats; } catch {}
      // never re-render under someone's fingers — it would wipe a half-typed quantity
      if (!$('#ordList').contains(document.activeElement)) renderOrders();
    }
    ordPoll();
  }, 30000);
}

// --- list ---
function ordLines(skip) {
  const q = OS.q.trim().toLowerCase();
  const cut = new Date(Date.now() - HIDE_DONE_AFTER).toISOString();
  return sortLines(O.lines.filter(l => !l.deleted
    && (OS.hist || (O.cats.includes(l.cat) && !(DONE[l.status] && (l.updated_at || '') < cut)))
    && (skip === 'cat' || !OS.cat || l.cat === OS.cat)
    && (skip === 'sup' || !OS.sup || (l.supplier || '') === OS.sup)
    && (OS.filter === 'active' || (OS.filter === 'open' ? OPEN_ST[l.status]
        : OS.filter === 'missing' ? l.status === 'missing' : !!l.client))
    && (!q || `${l.name} ${l.supplier || ''} ${l.client || ''}`.toLowerCase().includes(q))));
}
function renderOrders() {
  const cc = $('#oCats'); cc.innerHTML = '';
  const open = {};
  O.lines.forEach(l => { if (!l.deleted && OPEN_ST[l.status]) open[l.cat] = (open[l.cat] || 0) + 1; });
  const all = mk('הכל', !OS.cat, () => { OS.cat = null; OS.sup = null; renderOrders(); });
  all.classList.add('cat-all'); cc.appendChild(all);
  CATS.filter(([k]) => O.cats.includes(k)).forEach(([k, lab, ico]) => {
    const c = mk(`${ico} ${lab}`, OS.cat === k, () => { OS.cat = k; OS.sup = null; renderOrders(); }, open[k] || 0);
    c.classList.add('cat-' + k); cc.appendChild(c);
  });

  const sc = $('#oSups'); sc.innerHTML = '';
  const sup = {};
  ordLines('sup').forEach(l => { if (l.supplier) sup[l.supplier] = (sup[l.supplier] || 0) + 1; });
  // with a category chosen, list that category's whole supplier roster — the staff wants to see
  // who they order from, not only whoever happens to have an open line right now
  if (OS.cat) (SEC_FOR_CAT[OS.cat] || []).flatMap(supNames).forEach(n => { if (!(n in sup)) sup[n] = 0; });
  const names = Object.keys(sup).sort((a, b) => sup[b] - sup[a] || a.localeCompare(b, 'he'));
  sc.hidden = !names.length;
  if (names.length) {
    sc.appendChild(mk('כל הספקים', !OS.sup, () => { OS.sup = null; renderOrders(); }));
    names.forEach(n => sc.appendChild(mk(n, OS.sup === n, () => { OS.sup = n; renderOrders(); }, sup[n])));
  }

  const ls = ordLines();
  $('#oSheet').hidden = !ls.some(l => l.status === 'pending' || l.status === 'missing');
  $('#oSheet').textContent = OS.sup ? `📋 הזמנה ל${OS.sup}` : '📋 גיליון הזמנה';
  $('#oCount').textContent = `${ls.length} שורות · ${ls.filter(l => OPEN_ST[l.status]).length} פתוחות`;
  const box = $('#ordList'); box.innerHTML = '';
  const frag = document.createDocumentFragment();
  ls.forEach(l => {
    const d = document.createElement('div');
    d.className = 'ord-row cat-' + l.cat + (STRUCK[l.status] ? ' done' : '') + (DONE[l.status] ? ' gone' : '');
    // the supplier and the client are editable after the fact: a free-text line added in a
    // hurry with no supplier would otherwise never show up in that supplier's order sheet.
    const tags = [
      `<button class="ord-tag sup${l.supplier ? '' : ' empty'}" data-e="sup" title="שינוי ספק">` +
        `${l.supplier ? esc(l.supplier) : '＋ ספק'}</button>`,
      `<button class="ord-tag cli${l.client ? '' : ' empty'}" data-e="cli" title="שיוך ללקוח">` +
        `${l.client ? '🧑 ' + esc(l.client) + (l.phone ? ' · ' + esc(l.phone) : '') : '＋ לקוח'}</button>`,
      l.cat === 'lab' ? `<span class="ord-tag${l.paid ? ' paid' : ''}">${l.paid ? '✔ שולם' : 'לא שולם'}</span>` : ''
    ].join('');
    const opts = Object.entries(stFor(l.cat)).map(([k, v]) =>
      `<option value="${k}"${l.status === k ? ' selected' : ''}>${v}</option>`).join('');
    d.innerHTML = `<div class="ord-main"><b>${esc(l.name)}</b><small>${tags}</small></div>
      <div class="ord-ctl">
        ${l.cat === 'lab'
          ? `<label class="ord-chk"><input type="checkbox" data-a="paid"${l.paid ? ' checked' : ''}> שולם</label>`
          : `<label class="ord-chk"><input type="checkbox" data-a="ordered"${l.status === 'ordered' ? ' checked' : ''}> הוזמן</label>`}
        <input class="qty" type="number" min="1" step="1" data-a="qty" value="${l.qty}" aria-label="כמות">
        <span class="ord-date">${dShort(l.created_at)}</span>
        <select data-a="status" aria-label="סטטוס">${opts}</select>
        <button class="ghost small" data-a="del" title="מחיקה">🗑</button>
      </div>`;
    d.querySelectorAll('[data-a]').forEach(el => el.addEventListener('change', () => {
      const a = el.dataset.a;
      if (a === 'ordered') setLine(l.id, 'status', el.checked ? 'ordered' : 'pending');
      else if (a === 'qty') setLine(l.id, 'qty', Math.max(1, parseInt(el.value, 10) || 1));
      else if (a === 'paid') setLine(l.id, 'paid', el.checked);
      else setLine(l.id, 'status', el.value);
    }));
    d.querySelector('[data-a="del"]').addEventListener('click', () => delLine(l.id, l.name));
    d.querySelector('[data-e="sup"]').addEventListener('click', ev => {
      const sel = document.createElement('select');
      sel.className = 'ord-tag-sel';
      sel.innerHTML = supOptions(l.cat, l.supplier || '');
      ev.currentTarget.replaceWith(sel);
      sel.focus();
      let taken = false;
      sel.addEventListener('change', () => {
        taken = true;
        setLine(l.id, 'supplier', sel.value === '__other' ? supOther(sel, l.supplier) : sel.value);
      });
      sel.addEventListener('blur', () => setTimeout(() => { if (!taken) renderOrders(); }, 120));
    });
    d.querySelector('[data-e="cli"]').addEventListener('click', () => {
      const n = prompt('שם הלקוח (ריק = ביטול השיוך):', l.client || '');
      if (n == null) return;
      const ph = n.trim() ? prompt('טלפון:', l.phone || '') : '';
      l.phone = (ph || '').trim();
      setLine(l.id, 'client', n.trim());
    });
    frag.appendChild(d);
  });
  box.appendChild(frag);
  $('#oEmpty').hidden = ls.length > 0;
}
function setLine(id, field, val) {
  const l = O.lines.find(x => x.id === id); if (!l) return;
  l[field] = val; l.updated_at = new Date().toISOString();
  renderOrders(); saveOrders([id]);
}
function delLine(id, name) {
  if (!confirm(`למחוק את "${name}" מהרשימה?`)) return;
  const i = O.lines.findIndex(x => x.id === id); if (i < 0) return;
  // a tombstone, not a splice: without it a computer holding a stale list resurrects the row
  O.lines[i] = { id, deleted: true, updated_at: new Date().toISOString() };
  renderOrders(); saveOrders([id]);
}
function addLine() {
  const name = ($('#oName').value.trim() || $('#oPick').value.trim());
  if (!name) return void toast('צריך שם פריט', true);
  const cat = $('#oCat').value, now = new Date().toISOString();
  const p = picked && picked.name === name ? picked : null;
  const l = { id: oid(), cat, name, qty: Math.max(1, parseInt($('#oQty').value, 10) || 1),
    status: cat === 'lab' ? 'taken' : 'pending',
    supplier: $('#oSup').value.trim(), slug: p ? p.slug : '', sku: p ? (p.sku || '') : '',
    price: p ? p.price_no_vat : null,
    client: '', phone: '', paid: false, note: '',
    created_at: now, updated_at: now };
  O.lines.push(l);
  picked = null;
  ['oPick', 'oName'].forEach(id => $('#' + id).value = '');
  $('#oQty').value = 1; $('#oSug').hidden = true;
  ordCatChanged();
  renderOrders(); saveOrders([l.id]);
  toast('נוסף ✓');
}
function ordCatChanged() { fillSupSeg(); }
// the sheet picks its own supplier: the chips above filter what you look at, this picks what
// you actually send — so one click gives either everything or one supplier's list
const NO_SUP = 'ללא ספק';
const sheetSrc = sup => ordLines('sup').filter(l => (l.status === 'pending' || l.status === 'missing')
  && (!sup || (l.supplier || NO_SUP) === sup));
function openSheet() {
  const src = sheetSrc('');
  if (!src.length) return void toast('אין שורות ממתינות בסינון הזה', true);
  const sups = [...new Set(src.map(l => l.supplier || NO_SUP))].sort((a, b) => a.localeCompare(b, 'he'));
  $('#oSheetSup').innerHTML = `<option value="">הכל — ${sups.length} ספקים, ${src.length} שורות</option>` +
    sups.map(s => `<option value="${esc(s)}">${esc(s)} (${src.filter(l => (l.supplier || NO_SUP) === s).length})</option>`).join('');
  $('#oSheetSup').value = OS.sup && sups.includes(OS.sup) ? OS.sup : '';
  buildSheet();
  $('#oSheetBox').hidden = false;
  $('#oSheetBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function buildSheet() {
  const sup = $('#oSheetSup').value, src = sheetSrc(sup);
  // freeze the set: the list may re-poll between generating the sheet and marking it ordered
  sheetIds = src.map(l => l.id);
  const txt = sheetText(src, null, clinicName());
  $('#oSheetText').value = txt;
  $('#oSheetTitle').textContent = sup ? `גיליון הזמנה — ${sup}` : 'גיליון הזמנה — כל הספקים';
  $('#oWa').href = 'https://wa.me/?text=' + encodeURIComponent(txt);
  $('#oMail').href = 'mailto:?subject=' + encodeURIComponent('הזמנה' + (sup ? ' — ' + sup : '')) +
    '&body=' + encodeURIComponent(txt);
  $('#oSheetMsg').textContent = '';
}
async function markSheetOrdered() {
  if (!sheetIds || !sheetIds.length) return;
  const now = new Date().toISOString();
  const hit = O.lines.filter(l => sheetIds.includes(l.id) && !l.deleted);
  hit.forEach(l => { l.status = 'ordered'; l.updated_at = now; });
  renderOrders();
  await saveOrders(hit.map(l => l.id));
  $('#oSheetMsg').textContent = `${hit.length} שורות סומנו כהוזמנו.`;
}

// ---------- gate + wiring ----------
async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }

// The clinic copy: no access gate (the vhost is password-protected), settings come from the
// server instead of the browser, and the privacy panels say what is actually true here.
async function startClinic() {
  clinicMode = true;
  document.body.classList.add('mode-clinic');
  document.title = CONFIG.product || 'מחירון המרפאה';
  const brand = $('.brand .product'); if (brand) brand.textContent = CONFIG.product || 'VetPrices';
  try {
    const s = await getJSON(CLINIC_STORE);
    P = Object.assign({}, EMPTY, s);
    if (!P.tiers || !Array.isArray(P.tiers.bands) || !P.tiers.bands.length) P.tiers = { on: false, bands: TIERS.map(b => ({ ...b })) };
  } catch { toast('⚠️ לא הצלחנו לטעון את ההגדרות מהשרת — שינויים עלולים לא להישמר', true); }
  await loadOrders();
  $$('.privacy').forEach(p => {
    p.innerHTML = '<h2>🔒 העותק הפנימי של המרפאה</h2><ul>' +
      '<li><b>ההגדרות נשמרות בשרת המרפאה</b> ומשותפות לכל המחשבים — מה שתשנו כאן יופיע גם בכל עמדה אחרת ובבית.</li>' +
      '<li><b>הדף מוגן בסיסמה.</b> ההנחות והמרווחים האמיתיים שלכם נמצאים כאן ורק כאן — הם לעולם לא מגיעים לאתר הציבורי.</li>' +
      '<li><b>המחירונים עצמם זהים לאתר הציבורי</b> ומתעדכנים יחד איתו — אותו מקור נתונים בדיוק.</li></ul>';
  });
  // the public footer promises nothing leaves the browser; here settings and orders — including
  // client names and phones — do live on the clinic's own server, and the line has to say so.
  const fp = $('.foot-privacy');
  if (fp) fp.innerHTML = '🔒 <b>עותק פנימי:</b> ההגדרות וההזמנות — כולל שמות וטלפונים של לקוחות — ' +
    'נשמרות בשרת המרפאה ומשותפות לכל המחשבים. הן לעולם לא מגיעות לאתר הציבורי.';
  (CONFIG.links || []).forEach(l => {
    const a = document.createElement('a');
    a.className = 'ghost icon extlink'; a.href = l.url; a.target = '_blank'; a.rel = 'noopener';
    a.title = l.label; a.innerHTML = `${l.icon} <span>${esc(l.label)}</span>`;
    $('.top-actions').prepend(a);
  });
  start();
}

async function init() {
  [INDEX, CONFIG] = await Promise.all([getJSON('data/index.json'), getJSON('config.json')]);
  const mail = `mailto:${CONFIG.contact}?subject=`;
  $('#reportLink').href = mail + encodeURIComponent('VetPrices — דיווח על טעות / בקשת הסרה');
  $('#gateAsk').href = mail + encodeURIComponent('VetPrices — בקשת קוד גישה');
  $('#cloudLink').href = mail + encodeURIComponent('VetPrices — מעוניין בהגדרות ששמורות בשרת');
  if (CONFIG.mode === 'clinic') return startClinic();
  if (CONFIG.mode === 'offline') {
    document.body.classList.add('mode-offline');
    const brand = $('.brand .product'); if (brand) brand.textContent = CONFIG.product || 'VetPrices';
    return start();
  }
  let ok = false; try { ok = localStorage.getItem('vp_access') === CONFIG.access_hash; } catch {}
  if (ok) return start();
  $('#gate').hidden = false;
  if (!window.isSecureContext) $('#gateErr').textContent = 'הדפדפן דורש חיבור מאובטח (https) לבדיקת הקוד.';
  $('#gateForm').addEventListener('submit', async e => {
    e.preventDefault();
    const h = await sha256(CONFIG.salt + $('#gateCode').value.trim().toUpperCase());
    if (h !== CONFIG.access_hash) return void ($('#gateErr').hidden = false);
    try { localStorage.setItem('vp_access', h); } catch {}
    $('#gate').hidden = true; start();
  });
}

async function start() {
  $('#app').hidden = false;
  if (!clinicMode) await loadOrders();
  const counts = {};
  INDEX.pricelists.forEach(m => counts[m.type] = (counts[m.type] || 0) + m.item_count);
  Object.keys(SEC_HEB).forEach(k => $('#c-' + k).textContent = `${(counts[k] || 0).toLocaleString('he-IL')} פריטים`);

  $$('#tiles .tile').forEach(b => b.addEventListener('click', () => {
    const g = b.dataset.go;
    if (g === 'calc') { show('calc'); calcRun(); renderAdv(); }
    else if (g === 'orders') { show('orders'); renderOrders(); }
    else openSec(g);
  }));
  $('#homeBtn').addEventListener('click', e => { e.preventDefault(); goHome(); });
  $$('#tabs button').forEach(b => b.addEventListener('click', () => openSec(b.dataset.type)));
  $$('[data-vat]').forEach(b => b.addEventListener('click', () => { S.vat = b.dataset.vat; $$('[data-vat]').forEach(x => x.classList.toggle('on', x === b)); renderTable(); }));
  $$('[data-view]').forEach(b => b.addEventListener('click', () => { S.view = b.dataset.view; S.supplier = S.category = S.topic = null; S.shown = PAGE; $$('[data-view]').forEach(x => x.classList.toggle('on', x === b)); render(); }));
  $$('[data-mode]').forEach(b => b.addEventListener('click', () => {
    S.mode = b.dataset.mode; $$('[data-mode]').forEach(x => x.classList.toggle('on', x === b));
    S.margins = defMargins();   // every entry into the clinic view starts from the stored default
    if ($('#catalog').hidden) { if (S.type) openSec(S.type); else if (clinicMode) openSec('medical'); else show('home'); } else { renderTable(); render(); }
  }));
  $('#marginsBtn').addEventListener('click', () => { S.margins = !S.margins; renderTable(); render(); });
  let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { S.q = $('#q').value; S.shown = PAGE; render(); }, 200); });
  $('#more').addEventListener('click', () => { S.shown += PAGE; renderTable(); });
  $$('#viewSeg button').forEach(b => b.addEventListener('click', () => {
    P.clinicView = b.dataset.cview; save(); renderSettings();
    S.margins = defMargins(); renderTableIfOpen();
  }));
  $$('.helpLink').forEach(b => b.addEventListener('click', () => { $('#helpMsg').textContent = ''; show('help'); }));
  $('#helpBtn').addEventListener('click', () => { $('#helpMsg').textContent = ''; show('help'); });
  $('#helpBtn2').addEventListener('click', () => { $('#helpMsg').textContent = ''; show('help'); });
  $('#statusBtn').addEventListener('click', renderStatus);
  $('#statusBtn2').addEventListener('click', renderStatus);
  const openSettings = () => { show('settings'); renderSettings(); };
  $('#setBtn').addEventListener('click', openSettings);
  $('#setBtn2').addEventListener('click', openSettings);
  $('#calcBtn').addEventListener('click', () => { show('calc'); calcRun(); renderAdv(); });
  $('#advBtn').addEventListener('click', () => {
    const box = $('#adv'); box.hidden = !box.hidden;
    $('#advBtn').textContent = box.hidden ? '📐 מחשבון מתקדם — תמחור לפי טווחי מחיר' : '📐 הסתר את המחשבון המתקדם';
    if (!box.hidden) { renderAdv(); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  $('#advAdd').addEventListener('click', () => {
    const bs = P.tiers.bands, last = bs[bs.length - 1], prev = bs.length > 1 ? +bs[bs.length - 2].to || 0 : 0;
    bs.splice(bs.length - 1, 0, { to: prev + 100, mult: +last.mult || 1.3, add: 0 });
    save(); renderAdv();
  });
  $('#advReset').addEventListener('click', () => {
    P.tiers = { on: P.tiers.on, bands: TIERS.map(b => ({ ...b })) }; save(); renderAdv();
    if (S.mode === 'clinic') renderTable();
  });
  $('#advOn').addEventListener('change', e => {
    P.tiers.on = e.target.checked; save(); renderAdv();
    if (S.mode === 'clinic') renderTable();
  });
  $$('#startSeg button').forEach(b => b.addEventListener('click', () => {
    P.startPage = b.dataset.start; save(); renderSettings();
  }));
  $('#clinicName').addEventListener('change', () => { P.clinicName = $('#clinicName').value.trim(); save(); });
  $('#supQ').addEventListener('input', renderSettings);
  $$('#roundSeg button').forEach(b => b.addEventListener('click', () => { P.round = +b.dataset.round; save(); renderSettings(); renderTableIfOpen(); }));
  // the same two actions are offered on the settings page and on the help page
  let msgTarget = '#setMsg';
  const setMsg = t => { const el = $(msgTarget); if (el) el.textContent = t; };
  function doExport() {
    // in the public copy this file is the only backup there is, and the orders live in the same
    // browser — leaving them out would make the promise on the help page false
    const payload = clinicMode ? P : { ...P, orders: { v: 1, cats: O.cats, lines: O.lines } };
    const a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 1));
    a.download = 'vetprices-pricing.json'; a.click();
    setMsg('ההגדרות יוצאו לקובץ. שמרו אותו במקום בטוח.');
  }
  $('#exportBtn').addEventListener('click', () => { msgTarget = '#setMsg'; doExport(); });
  $('#exportBtn2').addEventListener('click', () => { msgTarget = '#helpMsg'; doExport(); });
  $('#importBtn').addEventListener('click', () => { msgTarget = '#setMsg'; $('#importFile').click(); });
  $('#importBtn2').addEventListener('click', () => { msgTarget = '#helpMsg'; $('#importFile').click(); });
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text()), ords = j.orders; delete j.orders;
      P = Object.assign({}, EMPTY, j); save();
      const withOrders = !clinicMode && ords && Array.isArray(ords.lines);
      if (withOrders) {
        O = { v: 1, cats: Array.isArray(ords.cats) ? ords.cats : DEF_CATS.slice(), lines: ords.lines };
        saveOrders([]); fillOrderCats(); renderOrders();
      }
      renderSettings(); applyOrdIntro();
      setMsg(withOrders ? 'ההגדרות וההזמנות יובאו.' : 'ההגדרות יובאו.');
    }
    catch { setMsg('הקובץ אינו קובץ הגדרות תקין.'); }
    e.target.value = '';
  });
  $('#resetBtn').addEventListener('click', () => {
    const alsoOrders = !clinicMode && O.lines.some(l => !l.deleted);
    if (!confirm('לאפס את כל ההנחות, המרווחים והדריסות' +
                 (alsoOrders ? ' — וגם למחוק את כל ההזמנות' : '') + '? לא ניתן לבטל.')) return;
    P = { ...EMPTY }; save();
    if (alsoOrders) { O = { v: 1, cats: DEF_CATS.slice(), lines: [] }; saveOrders([]); fillOrderCats(); renderOrders(); }
    renderSettings(); applyOrdIntro();
    $('#setMsg').textContent = 'הכל אופס.';
  });
  ['cList', 'cDisc', 'cPct', 'cFlat'].forEach(id => $('#' + id).addEventListener('input', () => calcRun()));
  $('#cSale').addEventListener('input', () => calcRun('sale'));
  let ct; $('#cPick').addEventListener('input', () => {
    clearTimeout(ct); ct = setTimeout(async () => {
      const q = $('#cPick').value.trim(); const box = $('#cSug');
      if (q.length < 2) return void (box.hidden = true);
      const hits = await calcSuggest(q);
      box.innerHTML = hits.map(h => `<button data-p="${h.price_no_vat}">${esc(h.name)} <small>${esc(h.supplier)} · ${fmt(h.price_no_vat)} ₪</small></button>`).join('') || '<p class="hint">לא נמצא</p>';
      box.hidden = false;
      box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        $('#cList').value = b.dataset.p; box.hidden = true; $('#cPick').value = b.textContent.trim(); calcRun();
      }));
    }, 250);
  });
  wireOrders();
  goHome();
  // deep link — prices.claudevet.com/#labs lands straight on the labs price lists.
  // VetForms links here that way; anything else falls back to the home tiles.
  const deep = location.hash.replace('#', '');
  if (ALL_SEC.includes(deep)) openSec(deep);
}

function fillOrderCats() {
  const live = CATS.filter(([k]) => O.cats.includes(k));
  $('#oCatSeg').innerHTML = live.map(([k, lab, ico]) =>
    `<button type="button" data-oc="${k}" class="cat-${k}">${ico} ${esc(lab)}</button>`).join('');
  $$('#oCatSeg button').forEach(b => b.addEventListener('click', () => setCat(b.dataset.oc)));
  setCat(live.some(([k]) => k === 'general') ? 'general' : (live[0] || ['general'])[0]);
}
function setCat(k) {
  $('#oCat').value = k;
  $$('#oCatSeg button').forEach(b => b.classList.toggle('on', b.dataset.oc === k));
  ordCatChanged();
}
function applyOrdIntro() { const b = $('#oIntro'); if (b) b.hidden = !!P.hideOrdIntro; }
function wireOrders() {
  fillOrderCats();
  // the list opens on כללי, not on הכל: most of the standing lines are food, and "הכל" made
  // the screen look like a food list every time it was opened
  if (OS.cat == null && O.cats.includes('general')) OS.cat = 'general';
  applyOrdIntro();
  $('#oIntroX').addEventListener('click', () => { P.hideOrdIntro = 1; save(); applyOrdIntro(); });
  const openGuide = () => {
    $('#helpMsg').textContent = ''; show('help');
    $('#ordersHelp').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('#oGuideBtn').addEventListener('click', openGuide);
  $('#oIntroMore').addEventListener('click', openGuide);
  $('#oAdd').addEventListener('click', addLine);
  $('#oAdd2').addEventListener('click', addLine);
  ['oName', 'oQty'].forEach(id =>
    $('#' + id).addEventListener('keydown', e => { if (e.key === 'Enter') addLine(); }));
  let ot; $('#oQ').addEventListener('input', () => {
    clearTimeout(ot); ot = setTimeout(() => { OS.q = $('#oQ').value; renderOrders(); }, 200);
  });
  $$('#oFilter button').forEach(b => b.addEventListener('click', () => {
    OS.filter = b.dataset.of; $$('#oFilter button').forEach(x => x.classList.toggle('on', x === b)); renderOrders();
  }));
  $('#oHist').addEventListener('click', () => {
    OS.hist = !OS.hist;
    $('#oHist').classList.toggle('on', OS.hist);
    $('#oHist').textContent = OS.hist ? '🕘 הסתר היסטוריה' : '🕘 היסטוריה';
    renderOrders();
  });
  $('#oSheet').addEventListener('click', openSheet);
  $('#oSheetSup').addEventListener('change', buildSheet);
  $('#oSheetClose').addEventListener('click', () => $('#oSheetBox').hidden = true);
  $('#oCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#oSheetText').value); $('#oSheetMsg').textContent = 'הועתק ✓'; }
    catch { $('#oSheetText').select(); $('#oSheetMsg').textContent = 'סמנו והעתיקו ידנית (Ctrl+C).'; }
  });
  $('#oPrint').addEventListener('click', () => {
    const w = window.open('', '_blank'); if (!w) return void toast('הדפדפן חסם את חלון ההדפסה', true);
    w.document.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>הזמנה</title></head>` +
      `<body><pre style="font:14px/1.7 Heebo,Arial,sans-serif;white-space:pre-wrap">${esc($('#oSheetText').value)}</pre></body></html>`);
    w.document.close(); w.focus(); w.print();
  });
  $('#oMark').addEventListener('click', markSheetOrdered);
  $('#ordersBtn').addEventListener('click', () => { show('orders'); renderOrders(); });
  let op; $('#oPick').addEventListener('input', () => {
    picked = null;
    clearTimeout(op); op = setTimeout(async () => {
      const q = $('#oPick').value.trim(), box = $('#oSug');
      if (q.length < 2) return void (box.hidden = true);
      const hits = await calcSuggest(q);
      box.innerHTML = hits.map((h, i) => `<button data-i="${i}">${esc(h.name)} <small>${esc(h.supplier)}` +
        `${h.sku ? ' · ' + esc(h.sku) : ''} · ${fmt(h.price_no_vat)} ₪</small></button>`).join('') ||
        '<p class="hint">לא נמצא במחירונים — אפשר להקליד שם חופשי</p>';
      box.hidden = false;
      box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const h = hits[+b.dataset.i];
        picked = h;
        $('#oPick').value = h.name; $('#oName').value = '';
        const c = SEC_CAT[h.sec] || 'general';
        if (O.cats.includes(c)) setCat(c);
        else ordCatChanged();
        setSupVal(h.supplier || '');
        box.hidden = true; $('#oQty').focus();
      }));
    }, 250);
  });
  ordPoll();
}
if (typeof document !== 'undefined') init().catch(e => { document.body.innerHTML = `<p style="padding:40px;text-align:center">שגיאה בטעינת הנתונים (${esc(e.message)}). נסו לרענן.</p>`; });
if (typeof module !== 'undefined' && module.exports)
  module.exports = { fromRow, toRow, sortLines, sheetText, _pricing: { P, params, calc, bandFor, setRow } };
})();
