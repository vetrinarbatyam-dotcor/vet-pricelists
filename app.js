/* VetPrices — static app. Data: data/index.json + data/<section>/<slug>.json.
   All pricing lives in localStorage only; nothing is ever sent to a server. */
(() => {
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const VAT = 1.18, PAGE = 150;
const SEC_HEB = { medical: 'מוצרים ותרופות', food: 'מזון', labs: 'מעבדות', shop: 'מוצרי חנויות' };

let INDEX = null, CONFIG = null, cache = {};
let S = { type: null, vat: 'incl', view: 'supplier', mode: 'list', supplier: null, category: null, topic: null, q: '', shown: PAGE };
let rows = [];

// ---------- pricing store ----------
const PK = 'vp_pricing';
const EMPTY = { sections: {}, suppliers: {}, rows: {}, round: 0 };
let P = load();
function load() { try { return Object.assign({}, EMPTY, JSON.parse(localStorage.getItem(PK) || '{}')); } catch { return { ...EMPTY }; } }
function save() { try { localStorage.setItem(PK, JSON.stringify(P)); } catch {} }
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const fmt = n => n == null ? '' : n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baseSlug = s => s.replace(/-shop$/, '');

function params(r) {
  const sec = P.sections[r.sec] || {}, sup = P.suppliers[r.slug] || {}, o = P.rows[r.id] || {};
  const mode = sup.mode || 'pct';
  return {
    discount: o.discount ?? sup.discount ?? 0,
    pct: o.pct ?? (mode === 'pct' ? sup.pct : null) ?? sec.pct ?? 0,
    flat: o.flat ?? (mode === 'flat' ? sup.flat : null) ?? sec.flat ?? 0,
    ovr: Object.keys(o).length > 0,
  };
}
function roundTo(v) { const r = +P.round || 0; return r ? Math.ceil(v / r) * r : v; }
function calc(r) {
  const p = params(r);
  const cost = r.price_no_vat * (1 - p.discount / 100) * VAT;
  return { ...p, cost, sale: roundTo(cost * (1 + p.pct / 100) + p.flat) };
}
function setRow(r, field, val) {
  const o = P.rows[r.id] || (P.rows[r.id] = {}), cur = calc(r);
  if (field === 'discount') o.discount = val ?? 0;
  else if (field === 'cost') o.discount = +(100 * (1 - (val ?? cur.cost) / (r.price_no_vat * VAT))).toFixed(2);
  else if (field === 'pct') o.pct = val ?? 0;
  else if (field === 'flat') o.flat = val ?? 0;
  else if (field === 'sale') o.pct = +(100 * (((val ?? cur.sale) - cur.flat) / cur.cost - 1)).toFixed(2);
  save();
}

// ---------- data ----------
async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); }
async function loadSec(sec) {
  if (cache[sec]) return cache[sec];
  const metas = INDEX.pricelists.filter(m => m.type === sec);
  const lists = await Promise.all(metas.map(m => getJSON(`data/${sec}/${m.slug}.json`)));
  lists.forEach(l => l.items.forEach(it => Object.assign(it, {
    slug: l.meta.slug, supplier: l.meta.supplier, sec, date: l.meta.price_list_date,
    status: l.meta.status, src: l.meta.source_file,
  })));
  cache[sec] = lists; return lists;
}
const topicsFor = sec => sec === 'labs' ? INDEX.taxonomy.lab_topics : sec === 'shop' ? INDEX.taxonomy.shop_topics : INDEX.taxonomy.topics;
const statusCls = s => s === 'current' ? 'ok' : s === 'stale' ? 'stale' : 'missing';
const statusHeb = s => s === 'current' ? 'עדכני' : s === 'stale' ? 'ישן' : 'אין מקור';

// ---------- pages ----------
function show(page) {
  ['home', 'catalog', 'settings', 'calc', 'status'].forEach(p => $('#' + p).hidden = p !== page);
  $('.tabs').style.visibility = page === 'home' ? 'hidden' : '';
  $('.top-actions .seg').style.visibility = page === 'catalog' ? '' : 'hidden';
}
function goHome() { S.type = null; show('home'); $$('#tabs button').forEach(b => b.classList.remove('on')); }

async function openSec(sec) {
  S.type = sec; S.supplier = S.category = S.topic = null; S.q = ''; S.shown = PAGE;
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
      () => { S.supplier = l.meta.slug; S.category = null; S.shown = PAGE; render(); }, l.items.length, l.meta.status)));
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
  const q = S.q.trim().toLowerCase();
  rows = [];
  lists.forEach(l => l.items.forEach(i => {
    if (S.view === 'supplier' && S.supplier && i.slug !== S.supplier) return;
    if (S.view === 'supplier' && S.category && i.category !== S.category) return;
    if (S.view === 'topic' && S.topic && i.topic !== S.topic) return;
    if (q && !`${i.name} ${i.sku || ''} ${i.notes || ''} ${i.category || ''} ${i.supplier}`.toLowerCase().includes(q)) return;
    rows.push(i);
  }));
  if (S.view === 'topic' || !S.supplier) rows.sort((a, b) => a.supplier.localeCompare(b.supplier, 'he') || a.name.localeCompare(b.name, 'he'));
  $('#count').textContent = `${rows.length.toLocaleString('he-IL')} פריטים`;
  const l1 = S.supplier && lists.find(x => x.meta.slug === S.supplier);
  $('#listNote').textContent = l1 ? `מחירון ${l1.meta.price_list_date || 'ללא תאריך'}${l1.meta.notes ? ' · ' + l1.meta.notes : ''}` : '';
  $('#dl').href = `downloads/${S.type}.xlsx`;
  $('#clinicBar').hidden = S.mode !== 'clinic';
  renderTable();
}
function mk(label, on, fn, n, status) {
  const b = document.createElement('button');
  b.className = 'chip' + (on ? ' on' : '');
  b.innerHTML = esc(label) + (n != null ? `<small>${n}</small>` : '') +
    (status ? `<span class="st ${statusCls(status)}" title="${statusHeb(status)}"></span>` : '');
  b.onclick = fn; return b;
}
function renderTable() {
  const incl = S.vat === 'incl', pr = S.mode === 'clinic';
  const th = ['ספק', 'פריט', 'קטגוריה', 'מק״ט', incl ? 'מחיר מחירון (כולל מע״מ)' : 'מחיר מחירון (ללא מע״מ)', 'מחירון'];
  if (pr) th.push('הנחה %', 'עלות', 'מרווח %', '₪ קבוע', 'מחיר ללקוח', '');
  $('#thead').innerHTML = th.map((h, i) => `<th class="${i === 4 || i >= 6 ? 'num' : ''}">${h}</th>`).join('');
  const tb = $('#tbody'); tb.innerHTML = '';
  const frag = document.createDocumentFragment();
  rows.slice(0, S.shown).forEach(r => {
    const tr = document.createElement('tr'), c = pr ? calc(r) : null;
    if (c && c.ovr) tr.className = 'ovr';
    const extra = [r.unit, r.animal, r.bonus ? 'בונוס ' + r.bonus : '', r.manufacturer, r.notes].filter(Boolean);
    let h = `<td class="sup">${esc(r.supplier)}</td>` +
      `<td class="name">${esc(r.name)}${extra.length ? `<small>${extra.map(esc).join(' · ')}</small>` : ''}</td>` +
      `<td>${esc(r.category || '')}</td><td class="num">${esc(r.sku || '')}</td>` +
      `<td class="num price">${fmt(incl ? r.price_with_vat : r.price_no_vat)}</td>` +
      `<td><span class="date ${statusCls(r.status)}">${r.price_date || r.date || 'ללא תאריך'}</span>` +
      `${r.src ? ` <a class="src" href="${r.src}" target="_blank" rel="noopener" title="צילום המקור">📄</a>` : ''}</td>`;
    if (pr) {
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
    if (pr) {
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
    const sample = 100 * (1 - (s.discount || 0) / 100) * VAT;
    const sale = mode === 'flat'
      ? sample + (s.flat ?? P.sections[m.type]?.flat ?? 0)
      : sample * (1 + (s.pct ?? P.sections[m.type]?.pct ?? 0) / 100);
    tr.innerHTML = `<td>${esc(m.supplier)}</td><td>${SEC_HEB[m.type]}</td><td class="num">${m.item_count}</td>
      <td class="edit"><input type="number" step="0.5" data-s="${m.slug}" data-k="discount" value="${s.discount ?? ''}" placeholder="0"></td>
      <td><select data-s="${m.slug}" data-k="mode">
            <option value="pct"${mode === 'pct' ? ' selected' : ''}>אחוז מהעלות</option>
            <option value="flat"${mode === 'flat' ? ' selected' : ''}>תוספת קבועה ₪</option></select></td>
      <td class="edit"><input type="number" step="1" data-s="${m.slug}" data-k="${mode}" value="${(mode === 'pct' ? s.pct : s.flat) ?? ''}" placeholder="ברירת מחדל"></td>
      <td class="hint">מחירון 100₪ → <b>${fmt(roundTo(sale))} ₪</b></td>`;
    tr.querySelectorAll('input,select').forEach(el => el.addEventListener('change', () => {
      const o = P.suppliers[m.slug] || (P.suppliers[m.slug] = {}), k = el.dataset.k;
      if (k === 'mode') o.mode = el.value;
      else { const v = num(el.value); if (v == null) delete o[k]; else o[k] = v; }
      save(); renderSettings(); renderTableIfOpen();
    }));
    tb.appendChild(tr);
  });
  $$('#roundSeg button').forEach(b => b.classList.toggle('on', +b.dataset.round === (+P.round || 0)));
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
  return ALL.filter(i => i.name.toLowerCase().includes(low)).slice(0, 8);
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
  $('#rProfit').textContent = fmt(profit) + ' ₪';
  $('#rMarkup').textContent = cost ? (100 * profit / cost).toFixed(1) + '%' : '—';
  $('#rMargin').textContent = sale ? (100 * profit / sale).toFixed(1) + '%' : '—';
}

// ---------- status page ----------
const ACT_HEB = { ok: 'מעודכן', refresh: 'צריך מחירון חדש', partial: 'חלקי', no_source: 'חסר קובץ מקור', check: 'לאימות' };
const ACT_CLS = { ok: 'ok', refresh: 'stale', partial: 'stale', no_source: 'missing', check: 'stale' };
function srcCell(m) {
  return m.source_file ? `<a href="${m.source_file}" target="_blank" rel="noopener">📄 צילום המקור</a>`
                       : '<span class="date missing">אין קובץ</span>';
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

// ---------- gate + wiring ----------
async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }

async function init() {
  [INDEX, CONFIG] = await Promise.all([getJSON('data/index.json'), getJSON('config.json')]);
  const mail = `mailto:${CONFIG.contact}?subject=`;
  $('#reportLink').href = mail + encodeURIComponent('VetPrices — דיווח על טעות / בקשת הסרה');
  $('#gateAsk').href = mail + encodeURIComponent('VetPrices — בקשת קוד גישה');
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

function start() {
  $('#app').hidden = false;
  const counts = {};
  INDEX.pricelists.forEach(m => counts[m.type] = (counts[m.type] || 0) + m.item_count);
  Object.keys(SEC_HEB).forEach(k => $('#c-' + k).textContent = `${(counts[k] || 0).toLocaleString('he-IL')} פריטים`);

  $$('#tiles .tile').forEach(b => b.addEventListener('click', () => {
    const g = b.dataset.go;
    if (g === 'calc') { show('calc'); calcRun(); } else openSec(g);
  }));
  $('#homeBtn').addEventListener('click', e => { e.preventDefault(); goHome(); });
  $$('#tabs button').forEach(b => b.addEventListener('click', () => openSec(b.dataset.type)));
  $$('[data-vat]').forEach(b => b.addEventListener('click', () => { S.vat = b.dataset.vat; $$('[data-vat]').forEach(x => x.classList.toggle('on', x === b)); renderTable(); }));
  $$('[data-view]').forEach(b => b.addEventListener('click', () => { S.view = b.dataset.view; S.supplier = S.category = S.topic = null; S.shown = PAGE; $$('[data-view]').forEach(x => x.classList.toggle('on', x === b)); render(); }));
  $$('[data-mode]').forEach(b => b.addEventListener('click', () => {
    S.mode = b.dataset.mode; $$('[data-mode]').forEach(x => x.classList.toggle('on', x === b));
    if ($('#catalog').hidden) { if (S.type) openSec(S.type); else goHome(); } else { $('#clinicBar').hidden = S.mode !== 'clinic'; renderTable(); }
  }));
  let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { S.q = $('#q').value; S.shown = PAGE; render(); }, 200); });
  $('#more').addEventListener('click', () => { S.shown += PAGE; renderTable(); });
  $('#statusBtn').addEventListener('click', renderStatus);
  $('#statusBtn2').addEventListener('click', renderStatus);
  const openSettings = () => { show('settings'); renderSettings(); };
  $('#setBtn').addEventListener('click', openSettings);
  $('#setBtn2').addEventListener('click', openSettings);
  $('#calcBtn').addEventListener('click', () => { show('calc'); calcRun(); });
  $('#supQ').addEventListener('input', renderSettings);
  $$('#roundSeg button').forEach(b => b.addEventListener('click', () => { P.round = +b.dataset.round; save(); renderSettings(); renderTableIfOpen(); }));
  $('#exportBtn').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(P, null, 1));
    a.download = 'vetprices-pricing.json'; a.click();
    $('#setMsg').textContent = 'ההגדרות יוצאו לקובץ.';
  });
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { P = Object.assign({}, EMPTY, JSON.parse(await f.text())); save(); renderSettings(); $('#setMsg').textContent = 'ההגדרות יובאו.'; }
    catch { $('#setMsg').textContent = 'הקובץ אינו קובץ הגדרות תקין.'; }
    e.target.value = '';
  });
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('לאפס את כל ההנחות, המרווחים והדריסות? לא ניתן לבטל.')) return;
    P = { ...EMPTY }; save(); renderSettings(); $('#setMsg').textContent = 'הכל אופס.';
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
  goHome();
}
init().catch(e => { document.body.innerHTML = `<p style="padding:40px;text-align:center">שגיאה בטעינת הנתונים (${esc(e.message)}). נסו לרענן.</p>`; });
})();
