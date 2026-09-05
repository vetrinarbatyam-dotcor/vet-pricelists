// The three order helpers that are not obvious by reading:  node tests/test_orders.js
const assert = require('assert');
const { fromRow, toRow, sortLines, sheetText } = require('../app.js');

const L = (id, o) => Object.assign({ id, name: id, qty: 1, status: 'pending', supplier: 'ספק א',
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z' }, o);

// --- fromRow / toRow: the hub row and our line say the same thing ---
// what the portal wrote, read here: the category is in the name, the client is in the notes
const portal = fromRow({ id: 'u1', item_name: "[מזון] Hill's PD - i/d חתול", quantity: '2',
  status: 'pending', notes: 'לשאול על אריזה [לקוח:שרית] [טל:0501234567]',
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' });
assert.strictEqual(portal.cat, 'food');
assert.strictEqual(portal.name, "Hill's PD - i/d חתול");
assert.strictEqual(portal.client, 'שרית');
assert.strictEqual(portal.phone, '0501234567');
assert.strictEqual(portal.note, 'לשאול על אריזה');
assert.strictEqual(portal.qty, 2);

// round trip, one per category — a food line keeps its brand in front of the name, and the
// two categories the portal never had survive in the column
[['general', ''], ['food', "Hill's"], ['clean', ''], ['shop', 'חנות א'], ['lab', 'מעבדה א']]
  .forEach(([cat, supplier]) => {
    const line = { id: 'u2', cat, name: 'פריט', qty: 3, status: cat === 'lab' ? 'taken' : 'pending',
      supplier, slug: 'hills-pd', sku: 'A1', price: 12.5, client: 'דנה', phone: '0500000000',
      paid: cat === 'lab', note: 'הערה', created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-02T00:00:00.000Z' };
    const back = fromRow(Object.assign({ id: line.id, created_at: line.created_at }, toRow(line)));
    assert.deepStrictEqual(back, line, cat + ' round trip');
  });

// the prefixes are not decoration: the portal's own tabs filter on them
assert.ok(toRow({ cat: 'food', name: 'x', supplier: '' }).item_name.startsWith('[מזון] '));
assert.ok(toRow({ cat: 'clean', name: 'x' }).item_name.startsWith('[ניקיון] '));
assert.ok(!toRow({ cat: 'general', name: 'x' }).item_name.startsWith('['));
// a line with no client must not leave a stray phone tag behind
assert.strictEqual(toRow({ cat: 'general', name: 'x', phone: '05' }).notes, '');

// --- sortLines: what was ordered sinks, what is missing floats ---
const order = sortLines([L('1', { status: 'ordered' }), L('2', { status: 'received' }),
  L('3', { status: 'pending' }), L('4', { status: 'missing' })]).map(l => l.status);
assert.deepStrictEqual(order, ['pending', 'missing', 'received', 'ordered']);
// same status → newest first
const dates = sortLines([L('old', { created_at: '2026-08-01T00:00:00.000Z' }),
  L('new', { created_at: '2026-08-05T00:00:00.000Z' })]).map(l => l.id);
assert.deepStrictEqual(dates, ['new', 'old']);

// --- sheetText: one block per supplier, quantities intact ---
const txt = sheetText([L('x', { name: 'PDS 3/0', qty: 2 }),
  L('y', { name: 'סלג׳לין', supplier: 'בית ארז', client: 'שרית' })], '28/08/2026');
assert.ok(txt.includes('📦 הזמנה — ספק א'), 'supplier heading');
assert.ok(txt.includes('📦 הזמנה — בית ארז'), 'second supplier heading');
assert.ok(txt.includes("• PDS 3/0 — 2 יח'"), 'quantity on the line');
assert.ok(txt.includes('(לשרית)'), 'client noted on the line');
assert.strictEqual((txt.match(/סה"כ פריטים: 1/g) || []).length, 2, 'a total per supplier');

// the signature line is the clinic's own name, and an unnamed clinic gets no line at all
const named = sheetText([L('x')], '28/08/2026', 'מרפאת הבדיקה');
assert.ok(named.trim().endsWith('מרפאת הבדיקה'), 'sheet signed with the clinic name');
assert.ok(!sheetText([L('x')], '28/08/2026').includes('מרפאת'), 'no signature without a name');

// --- pricing: the one formula money flows through ---
const { P, params, calc, bandFor, setRow } = require('../app.js')._pricing;
const R = { id: 'r1', sec: 'medical', slug: 'sup1', price_no_vat: 100 };

// no rules, tiers off: sale = cost = 100 × 1.18
assert.strictEqual(calc(R).sale.toFixed(2), '118.00');

// supplier pct + section flat apply TOGETHER (the settings hint used to show only one of them)
P.suppliers.sup1 = { discount: 10, pct: 40 };
P.sections.medical = { flat: 5 };
// cost = 100 × 0.9 × 1.18 = 106.2 → sale = 106.2 × 1.4 + 5
assert.strictEqual(calc(R).sale.toFixed(2), '153.68');
delete P.suppliers.sup1; delete P.sections.medical;

// tiers are the fallback: 118 falls in the ≤200 band (×1.8), and any explicit rule beats them
P.tiers.on = true;
assert.strictEqual(calc(R).sale.toFixed(2), '212.40');
assert.strictEqual(bandFor(100).mult, 2, 'boundary cost sits in the lower band');
P.sections.medical = { pct: 30 };
assert.strictEqual(calc(R).sale.toFixed(2), '153.40', 'a section rule beats the tiers');
delete P.sections.medical;

// typing a customer price on a tier-priced row with a ₪-add must land on the typed price:
// the override kills the tier, so its add must not leak into the back-computed pct
P.tiers.bands[1].add = 20;
setRow(R, 'sale', 250);
// the stored pct is kept at 2 decimals, so the round-trip may drift by up to one agora
assert.ok(Math.abs(calc(R).sale - 250) < 0.011, `got ${calc(R).sale}, wanted ~250 (before the fix: ~270)`);
delete P.rows.r1; P.tiers.on = false; P.tiers.bands[1].add = 0;

console.log('test_orders: ok');
