// The three order helpers that are not obvious by reading:  node tests/test_orders.js
const assert = require('assert');
const { mergeLines, sortLines, sheetText } = require('../app.js');

const L = (id, o) => Object.assign({ id, name: id, qty: 1, status: 'pending', supplier: 'ספק א',
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z' }, o);

// --- mergeLines: nobody loses a line ---
// two computers each added one line to the same starting list
const remote = [L('a'), L('b')];
const local = [L('a'), L('c')];
assert.deepStrictEqual(mergeLines(remote, local).map(l => l.id).sort(), ['a', 'b', 'c']);

// the later edit of the same line wins, whichever side it came from
const older = L('a', { status: 'pending', updated_at: '2026-08-01T10:00:00.000Z' });
const newer = L('a', { status: 'ordered', updated_at: '2026-08-01T11:00:00.000Z' });
assert.strictEqual(mergeLines([newer], [older])[0].status, 'ordered');
assert.strictEqual(mergeLines([older], [newer])[0].status, 'ordered');

// a delete must not come back from a computer holding the pre-delete list
const tomb = { id: 'b', deleted: true, updated_at: '2026-08-02T00:00:00.000Z' };
assert.strictEqual(mergeLines([L('b')], [tomb]).filter(l => !l.deleted).length, 0);

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

console.log('test_orders: ok');
