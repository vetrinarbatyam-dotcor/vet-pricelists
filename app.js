/* VetPrices — static app. Data: data/index.json + data/<type>/<slug>.json. Pricing lives only in localStorage. */
(() => {
const $ = s => document.querySelector(s);
const VAT = 1.18;
const TYPE_HEB = { medical: 'מוצרים ותרופות', food: 'מזון', labs: 'מעבדות' };
const PAGE = 150;

let INDEX = null, CONFIG = null;
let cache = {};                       // type -> [{meta, items}]
let state = { type: 'medical', vat: 'incl', view: 'supplier', supplier: null, category: null, topic: null, q: '', shown: PAGE, pricing: false };
let rows = [];                        // current filtered rows

// ---------- pricing store (localStorage only) ----------
const PK = 'vp_pricing';
let P = load();
function load() { try { return Object.assign({ types: {}, suppliers: {}, rows: {} }, JSON.parse(localStorage.getItem(PK) || '{}')); } catch { return { types: {}, suppliers: {}, rows: {} }; } }
function save() { try { localStorage.setItem(PK, JSON.stringify(P)); } catch {} }
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;

// effective parameters for a row: row override > supplier > type > 0
function params(r) {
  const t = P.types[r.type] || {}, s = P.suppliers[r.slug] || {}, o = P.rows[r.id] || {};
  return {
    discount: o.discount ?? s.discount ?? 0,
    pct: o.pct ?? s.pct ?? t.pct ?? 0,
    flat: o.flat ?? s.flat ?? t.flat ?? 0,
    ovr: Object.keys(o).length > 0,
  };
}
function calc(r) {
  const p = params(r);
  const cost = r.price_no_vat * (1 - p.discount / 100) * VAT;
  const sale = cost * (1 + p.pct / 100) + p.flat;
  return { ...p, cost, sale };
}
function setRow(r, field, val) {
  const o = P.rows[r.id] || (P.rows[r.id] = {});
  const cur = calc(r);
  if (field === 'discount') o.discount = val ?? 0;
  else if (field === 'cost') { const c = val ?? cur.cost; o.discount = +(100 * (1 - c / (r.price_no_vat * VAT))).toFixed(2); }
  else if (field === 'pct') o.pct = val ?? 0;
  else if (field === 'flat') o.flat = val ?? 0;
  else if (field === 'sale') { const s = val ?? cur.sale; o.pct = +(100 * ((s - cur.flat) / cur.cost - 1)).toFixed(2); }
  save();
}
function clearRow(r) { delete P.rows[r.id]; save(); }

// ---------- data ----------
async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); }
async function loadType(type) {
  if (cache[type]) return cache[type];
  const metas = INDEX.pricelists.filter(m => m.type === type);
  const lists = await Promise.all(metas.map(m => getJSON(`data/${type}/${m.slug}.json`)));
  lists.forEach(l => l.items.forEach(it => { it.slug = l.meta.slug; it.supplier = l.meta.supplier; it.type = type; it.date = l.meta.price_list_date; it.status = l.meta.status; it.src = l.meta.source_file; }));
  cache[type] = lists;
  return lists;
}
const topicLabel = k => Object.fromEntries((state.type === 'labs' ? INDEX.taxonomy.lab_topics : INDEX.taxonomy.topics))[k] || k;
const statusCls = s => s === 'current' ? 'ok' : s === 'stale' ? 'stale' : 'missing';
const statusHeb = s => s === 'current' ? 'עדכני' : s === 'stale' ? 'ישן' : 'אין מקור';
const fmt = n => n == null ? '' : n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- render ----------
async function render() {
  const lists = await loadType(state.type);
  // chips
  const chips = $('#chips'); chips.innerHTML = '';
  if (state.view === 'supplier') {
    const all = mk('הכל', !state.supplier, () => { state.supplier = null; state.category = null; state.shown = PAGE; render(); });
    chips.appendChild(all);
    lists.forEach(l => {
      if (!l.items.length) return;
      const c = mk(l.meta.supplier, state.supplier === l.meta.slug, () => { state.supplier = l.meta.slug; state.category = null; state.shown = PAGE; render(); }, l.items.length, l.meta.status);
      chips.appendChild(c);
    });
    // subchips
    const sub = $('#subchips'); sub.innerHTML = '';
    if (state.supplier) {
      const l = lists.find(x => x.meta.slug === state.supplier);
      const cats = {}; l.items.forEach(i => { if (i.category) cats[i.category] = (cats[i.category] || 0) + 1; });
      const keys = Object.keys(cats).sort((a, b) => cats[b] - cats[a]);
      if (keys.length > 1) {
        sub.hidden = false;
        sub.appendChild(mk(`הכל — ${l.meta.supplier}`, !state.category, () => { state.category = null; state.shown = PAGE; render(); }));
        keys.forEach(k => sub.appendChild(mk(k, state.category === k, () => { state.category = k; state.shown = PAGE; render(); }, cats[k])));
      } else sub.hidden = true;
    } else sub.hidden = true;
  } else {
    $('#subchips').hidden = true;
    const counts = {}; lists.forEach(l => l.items.forEach(i => counts[i.topic] = (counts[i.topic] || 0) + 1));
    chips.appendChild(mk('כל הנושאים', !state.topic, () => { state.topic = null; state.shown = PAGE; render(); }));
    (state.type === 'labs' ? INDEX.taxonomy.lab_topics : INDEX.taxonomy.topics).forEach(([k, lab]) => {
      if (!counts[k]) return;
      chips.appendChild(mk(lab, state.topic === k, () => { state.topic = k; state.shown = PAGE; render(); }, counts[k]));
    });
  }
  // filter
  const q = state.q.trim().toLowerCase();
  rows = [];
  lists.forEach(l => l.items.forEach(i => {
    if (state.view === 'supplier' && state.supplier && i.slug !== state.supplier) return;
    if (state.view === 'supplier' && state.category && i.category !== state.category) return;
    if (state.view === 'topic' && state.topic && i.topic !== state.topic) return;
    if (q && !(i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q) || (i.notes || '').toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q) || i.supplier.toLowerCase().includes(q))) return;
    rows.push(i);
  }));
  if (state.view === 'topic' || !state.supplier) rows.sort((a, b) => a.supplier.localeCompare(b.supplier, 'he') || a.name.localeCompare(b.name, 'he'));
  $('#count').textContent = `${rows.length.toLocaleString('he-IL')} פריטים`;
  const l1 = state.supplier && lists.find(x => x.meta.slug === state.supplier);
  $('#listNote').textContent = l1 ? `${l1.meta.supplier} · מחירון ${l1.meta.price_list_date || 'ללא תאריך'} · ${l1.meta.vat_basis === 'with_vat' ? 'המקור כולל מע״מ' : 'המקור ללא מע״מ'}${l1.meta.notes ? ' · ' + l1.meta.notes : ''}` : '';
  renderTable();
  $('#dl').href = `downloads/${state.type}.xlsx`;
  renderPricingBar(lists);
}
function mk(label, on, fn, n, status) {
  const b = document.createElement('button'); b.className = 'chip' + (on ? ' on' : '');
  b.innerHTML = esc(label) + (n != null ? `<small>${n}</small>` : '') + (status ? `<span class="st ${statusCls(status)}" title="${statusHeb(status)}"></span>` : '');
  b.onclick = fn; return b;
}
function renderTable() {
  const incl = state.vat === 'incl', pr = state.pricing;
  const th = ['ספק', 'פריט', 'קטגוריה', 'מק״ט', incl ? 'מחיר כולל מע״מ' : 'מחיר ללא מע״מ', 'מחירון'];
  if (pr) th.push('הנחה %', 'עלות (כולל מע״מ)', 'מרווח %', 'מרווח ₪', 'מחיר ללקוח', '');
  $('#thead').innerHTML = th.map((h, i) => `<th class="${i === 4 || i >= 6 ? 'num' : ''}">${h}</th>`).join('');
  const tb = $('#tbody'); tb.innerHTML = '';
  const frag = document.createDocumentFragment();
  rows.slice(0, state.shown).forEach(r => {
    const tr = document.createElement('tr');
    const c = pr ? calc(r) : null;
    if (c && c.ovr) tr.className = 'ovr';
    let h = `<td class="sup">${esc(r.supplier)}</td>` +
      `<td class="name">${esc(r.name)}${r.notes || r.unit || r.animal || r.bonus ? `<small>${[r.unit, r.animal, r.bonus ? 'בונוס ' + r.bonus : '', r.notes].filter(Boolean).map(esc).join(' · ')}</small>` : ''}</td>` +
      `<td>${esc(r.category || '')}</td><td class="num">${esc(r.sku || '')}</td>` +
      `<td class="num price">${fmt(incl ? r.price_with_vat : r.price_no_vat)}</td>` +
      `<td><span class="date ${statusCls(r.status)}">${r.price_date || r.date || 'ללא תאריך'}</span>${r.src ? ` <a class="src" href="${r.src}" target="_blank" rel="noopener" title="צילום המקור">📄</a>` : ''}</td>`;
    if (pr) {
      const inp = (f, v, step) => `<td class="edit"><input type="number" step="${step}" data-f="${f}" value="${v}" class="${P.rows[r.id]?.[f] != null || (f === 'cost' && P.rows[r.id]?.discount != null) || (f === 'sale' && P.rows[r.id]?.pct != null) ? 'ovr' : ''}"></td>`;
      h += inp('discount', +c.discount.toFixed(1), 0.5) + inp('cost', +c.cost.toFixed(2), 0.1) + inp('pct', +c.pct.toFixed(1), 1) + inp('flat', +c.flat.toFixed(0), 1) +
        `<td class="edit cust"><input type="number" step="0.1" data-f="sale" value="${+c.sale.toFixed(2)}" class="${P.rows[r.id]?.pct != null ? 'ovr' : ''}"></td>` +
        `<td>${c.ovr ? `<button class="ghost small" data-clear title="חזרה לברירת המחדל">↺</button>` : ''}</td>`;
    }
    tr.innerHTML = h;
    if (pr) {
      tr.querySelectorAll('input').forEach(i => i.addEventListener('change', () => { setRow(r, i.dataset.f, num(i.value)); renderTable(); }));
      tr.querySelector('[data-clear]')?.addEventListener('click', () => { clearRow(r); renderTable(); });
    }
    frag.appendChild(tr);
  });
  tb.appendChild(frag);
  $('#more').hidden = rows.length <= state.shown;
  $('#empty').hidden = rows.length > 0;
}
function renderPricingBar(lists) {
  const bar = $('#pricingBar'); bar.hidden = !state.pricing;
  if (!state.pricing) return;
  const t = P.types[state.type] || {};
  $('#typePct').value = t.pct ?? ''; $('#typeFlat').value = t.flat ?? '';
  const g = $('#supplierPricing'); g.innerHTML = '';
  const hdr = document.createElement('div'); hdr.className = 'sp-row sp-hdr'; hdr.innerHTML = '<span>ספק</span><span>הנחה %</span><span>מרווח %</span><span>מרווח ₪</span>'; g.appendChild(hdr);
  lists.forEach(l => {
    if (!l.items.length) return;
    const s = P.suppliers[l.meta.slug] || {};
    const d = document.createElement('div'); d.className = 'sp-row';
    d.innerHTML = `<span class="lbl" title="${esc(l.meta.supplier)}">${esc(l.meta.supplier)}</span>` +
      `<input type="number" step="0.5" data-k="discount" value="${s.discount ?? ''}" placeholder="0">` +
      `<input type="number" step="1" data-k="pct" value="${s.pct ?? ''}" placeholder="—">` +
      `<input type="number" step="1" data-k="flat" value="${s.flat ?? ''}" placeholder="—">`;
    d.querySelectorAll('input').forEach(i => i.addEventListener('change', () => {
      const o = P.suppliers[l.meta.slug] || (P.suppliers[l.meta.slug] = {});
      const v = num(i.value); if (v == null) delete o[i.dataset.k]; else o[i.dataset.k] = v;
      save(); renderTable();
    }));
    g.appendChild(d);
  });
}

// ---------- status dialog ----------
function renderStatus() {
  const tb = $('#statusTable tbody'); tb.innerHTML = '';
  INDEX.pricelists.forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${TYPE_HEB[m.type]}</td><td>${esc(m.supplier)}</td><td class="num">${m.price_list_date || '—'}</td><td class="num">${m.item_count}</td>` +
      `<td><span class="badge ${statusCls(m.status)}">${statusHeb(m.status)}</span></td>` +
      `<td>${m.source_file ? `<a href="${m.source_file}" target="_blank" rel="noopener">📄 צילום המקור</a>` : '<span class="date missing">אין קובץ</span>'}</td>`;
    tb.appendChild(tr);
  });
}

// ---------- gate ----------
async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function gateOK() { try { return localStorage.getItem('vp_access') === CONFIG.access_hash; } catch { return false; } }

// ---------- wiring ----------
async function init() {
  [INDEX, CONFIG] = await Promise.all([getJSON('data/index.json'), getJSON('config.json')]);
  const mail = `mailto:${CONFIG.contact}?subject=${encodeURIComponent('VetPrices — ')}`;
  $('#reportLink').href = mail + encodeURIComponent('דיווח על טעות / בקשת הסרה');
  $('#gateAsk').href = mail + encodeURIComponent('בקשת קוד גישה');
  if (!(await gateOK())) {
    $('#gate').hidden = false;
    $('#gateForm').addEventListener('submit', async e => {
      e.preventDefault();
      const h = await sha256(CONFIG.salt + $('#gateCode').value.trim().toUpperCase());
      if (h === CONFIG.access_hash) { try { localStorage.setItem('vp_access', h); } catch {} $('#gate').hidden = true; start(); }
      else $('#gateErr').hidden = false;
    });
    if (!window.isSecureContext) $('#gateErr').textContent = 'הדפדפן דורש חיבור מאובטח (https) לבדיקת הקוד.';
  } else start();
}
function start() {
  $('#app').hidden = false;
  $('#tabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    state.type = b.dataset.type; state.supplier = state.category = state.topic = null; state.shown = PAGE;
    $('#tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); render();
  }));
  $('#tabs button').classList.add('on');
  document.querySelectorAll('[data-vat]').forEach(b => b.addEventListener('click', () => { state.vat = b.dataset.vat; document.querySelectorAll('[data-vat]').forEach(x => x.classList.toggle('on', x === b)); renderTable(); }));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.view; state.supplier = state.category = state.topic = null; state.shown = PAGE; document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b)); render(); }));
  let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = $('#q').value; state.shown = PAGE; render(); }, 200); });
  $('#more').addEventListener('click', () => { state.shown += PAGE; renderTable(); });
  $('#modeBtn').addEventListener('click', () => { state.pricing = !state.pricing; $('#modeBtn').setAttribute('aria-pressed', state.pricing); $('#modeBtn').textContent = state.pricing ? 'חזרה לצפייה' : 'התמחור שלי'; render(); });
  $('#typePct').addEventListener('change', e => { const o = P.types[state.type] || (P.types[state.type] = {}); const v = num(e.target.value); if (v == null) delete o.pct; else o.pct = v; save(); renderTable(); });
  $('#typeFlat').addEventListener('change', e => { const o = P.types[state.type] || (P.types[state.type] = {}); const v = num(e.target.value); if (v == null) delete o.flat; else o.flat = v; save(); renderTable(); });
  $('#exportBtn').addEventListener('click', () => {
    const a = document.createElement('a'); a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(P, null, 1)); a.download = 'vetprices-pricing.json'; a.click();
  });
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); P = Object.assign({ types: {}, suppliers: {}, rows: {} }, j); save(); render(); } catch { alert('הקובץ אינו קובץ הגדרות תקין.'); }
    e.target.value = '';
  });
  $('#resetBtn').addEventListener('click', () => { if (confirm('לאפס את כל ההנחות, המרווחים והדריסות? (לא ניתן לבטל)')) { P = { types: {}, suppliers: {}, rows: {} }; save(); render(); } });
  $('#statusBtn').addEventListener('click', () => { renderStatus(); $('#statusDlg').showModal(); });
  $('#statusDlg [data-close]').addEventListener('click', () => $('#statusDlg').close());
  render();
}
init().catch(e => { document.body.innerHTML = `<p style="padding:40px;text-align:center">שגיאה בטעינת הנתונים (${esc(e.message)}). נסו לרענן.</p>`; });
})();
