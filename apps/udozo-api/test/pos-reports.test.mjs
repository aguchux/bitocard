// Udozo POS overview, shifts and reports (docs/UDOZO_POS_PLAN.md, milestone 7): a till's shift opens with its float,
// takes the cash of the sales and refunds rung up in it and cash paid in and out, and closes with the count against
// what was expected (blind for staff without cash-up); the overview puts the shop's sales beside udozo.com's; end of
// day and the accountant's exports (CSV and PDF) read the same sales.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
  for (const key of ['classifieds', 'pos']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
  await prisma.posPlan.update({ where: { code: 'free' }, data: { limits: { products: 20, shops: 1, tills: 2, staff: 5 } } });
});

after(() => server?.close());

function client(kind = 'customer') {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { [kind === 'staff' ? 'udozo-pos-session' : 'bitocard-customer-session']: token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `reports-${randomUUID()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') ?? '';
    if (type.startsWith('application/pdf') || type.startsWith('text/csv')) return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body) };
}

let counter = 0;
async function owner() {
  const who = client();
  const email = `reports${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await who.post('/v1/store/account/signup', { name: 'Ada Okafor', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, who);
  assert.equal((await who.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await who.post('/v1/classifieds/terms/accept', { version: (await who.get('/v1/classifieds/terms')).json.version });
  assert.equal((await who.post('/v1/pos/owner/signup', { plan: 'free', shop: { name: "Ada's Gadget Hub", vat_bps: 0 } })).status, 201);
  const me = (await who.get('/v1/pos/owner')).json;
  who.id = me.account.customer_id ?? signup.json.customer.id;
  who.customerId = signup.json.customer.id;
  who.shop = me.account.shops[0];
  who.till = who.shop.tills[0];
  return who;
}

async function product(who, title, { price = 500_000, stock = 20, reorder = null } = {}) {
  const category = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
  const made = await who.post('/v1/classifieds/listings', { title, price, category_id: category.id, stock, pos_enabled: true, on_shop: false, ...(reorder !== null ? { reorder_level: reorder } : {}) });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return (await who.post(`/v1/classifieds/listings/${made.json.id}/submit`)).json;
}

const sell = (who, listing, payments, { quantity = 1, path = '/v1/pos/owner/sales', till = who.till.id } = {}) => {
  const total = payments.reduce((sum, p) => sum + p.amount, 0);
  return who.post(path, { till_id: till, client_sale_id: randomUUID(), lines: [{ listing_id: listing.id, quantity }], payments, expected_total: total });
};

async function hire(boss, role) {
  const invited = await boss.post('/v1/pos/owner/staff', { first_name: role.replace('_', ' '), last_name: 'Test', phone: testMobile('NG'), role, all_tills: true, send_via: 'link' });
  assert.equal(invited.status, 201, JSON.stringify(invited.json));
  const who = client('staff');
  const accepted = await who.post('/v1/pos/invites/accept', { token: new URL(invited.json.invite.url).hash.slice(3), pin: '3917' });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.json));
  return who;
}

describe('shifts and cash-up', () => {
  test('a shift takes its float, cash sales and refunds, cash paid in and out, and closes against what was expected', async () => {
    const ada = await owner();
    const tv = await product(ada, 'Hisense 32 inch TV');
    const opened = await ada.post('/v1/pos/owner/shifts', { till_id: ada.till.id, opening_float: 2_000_000 });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    assert.deepEqual([opened.json.status, opened.json.opening_float, opened.json.expected_cash, opened.json.opened_by], ['open', 2_000_000, 2_000_000, 'Ada Okafor']);
    const again = await ada.post('/v1/pos/owner/shifts', { till_id: ada.till.id });
    assert.deepEqual([again.status, again.json.error.code], [409, 'shift_open']);

    const cash = (await sell(ada, tv, [{ method: 'cash', amount: 500_000, tendered: 1_000_000 }])).json;
    assert.equal(cash.shift_id, opened.json.id);
    await sell(ada, tv, [{ method: 'card', amount: 300_000 }, { method: 'cash', amount: 200_000 }]);
    await sell(ada, tv, [{ method: 'transfer', amount: 500_000, reference: 'GTB 1' }]);
    assert.equal((await ada.post(`/v1/pos/owner/sales/${cash.id}/refund`, { reason: 'Faulty' })).status, 200);
    assert.equal((await ada.post(`/v1/pos/owner/shifts/${opened.json.id}/cash`, { kind: 'out', amount: 150_000, reason: 'Paid the cleaner' })).status, 200);
    assert.equal((await ada.post(`/v1/pos/owner/shifts/${opened.json.id}/cash`, { kind: 'in', amount: 50_000, reason: 'Change from the bank' })).status, 200);
    assert.equal((await ada.post(`/v1/pos/owner/shifts/${opened.json.id}/cash`, { kind: 'out', amount: 1, reason: '' })).json.error.param, 'reason');

    // float 20,000 + cash 5,000 + 2,000 − refund 5,000 − 1,500 + 500 = 21,000.00
    const live = (await ada.get(`/v1/pos/owner/shifts/current?till_id=${ada.till.id}`)).json.shift;
    assert.equal(live.expected_cash, 2_100_000);
    assert.deepEqual([live.totals.sales, live.totals.refunds, live.totals.by_method, live.totals.paid_out, live.totals.paid_in], [3, 1, { cash: 700_000, card: 300_000, transfer: 500_000 }, 150_000, 50_000]);

    const closed = await ada.post(`/v1/pos/owner/shifts/${opened.json.id}/close`, { counted: 2_090_000, note: 'Short by a note' });
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    assert.deepEqual([closed.json.status, closed.json.expected_cash, closed.json.counted_cash, closed.json.difference, closed.json.closed_by], ['closed', 2_100_000, 2_090_000, -10_000, 'Ada Okafor']);
    assert.equal((await ada.post(`/v1/pos/owner/shifts/${opened.json.id}/close`, { counted: 1 })).json.error.code, 'shift_closed');
    assert.equal((await ada.post(`/v1/pos/owner/shifts/${opened.json.id}/cash`, { kind: 'in', amount: 1, reason: 'x' })).json.error.code, 'shift_closed');

    // A sale after closing belongs to no shift; the closed totals stay as they were.
    assert.equal((await sell(ada, tv, [{ method: 'cash', amount: 500_000 }])).json.shift_id, null);
    assert.equal((await ada.get(`/v1/pos/owner/shifts/${opened.json.id}`)).json.totals.sales, 3);
    assert.equal((await ada.get(`/v1/pos/owner/shifts/current?till_id=${ada.till.id}`)).json.shift, null);
    assert.equal((await ada.get('/v1/pos/owner/shifts?status=closed')).json.total, 1);

    // Another shop never sees it.
    const other = await owner();
    assert.equal((await other.get(`/v1/pos/owner/shifts/${opened.json.id}`)).status, 404);
    assert.equal((await other.post('/v1/pos/owner/shifts', { till_id: ada.till.id })).status, 404);
  });

  test('two sales racing a close: each counted in the shift or left out of it, never lost', async () => {
    const ada = await owner();
    const tv = await product(ada, 'TCL 43 inch TV', { stock: 50 });
    const shift = (await ada.post('/v1/pos/owner/shifts', { till_id: ada.till.id })).json;
    const [first, second, closed] = await Promise.all([sell(ada, tv, [{ method: 'cash', amount: 500_000 }]), sell(ada, tv, [{ method: 'cash', amount: 500_000 }]), ada.post(`/v1/pos/owner/shifts/${shift.id}/close`, { counted: 0 })]);
    const inShift = [first.json, second.json].filter(sale => sale.shift_id === shift.id).length;
    assert.equal(closed.json.totals.sales, inShift);
    assert.equal(closed.json.expected_cash, inShift * 500_000);
  });

  test('staff without cash-up count blind; the overview, end of day and exports follow each role', async () => {
    const ada = await owner();
    const tv = await product(ada, 'LG 50 inch TV');
    const cashier = await hire(ada, 'cashier');
    const manager = await hire(ada, 'manager');

    const opened = await cashier.post('/v1/pos/staff/shifts', { till_id: ada.till.id, opening_float: 1_000_000 });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    assert.deepEqual([opened.json.blind, opened.json.expected_cash, opened.json.totals.cash_sales], [true, null, null]);
    await sell(cashier, tv, [{ method: 'cash', amount: 500_000 }], { path: '/v1/pos/staff/sales', till: ada.till.id });
    const counted = await cashier.post(`/v1/pos/staff/shifts/${opened.json.id}/close`, { counted: 1_500_000 });
    assert.deepEqual([counted.json.counted_cash, counted.json.expected_cash, counted.json.difference], [1_500_000, null, null]);
    const seen = (await manager.get(`/v1/pos/staff/shifts/${opened.json.id}`)).json;
    assert.deepEqual([seen.blind, seen.expected_cash, seen.difference, seen.closed_by], [false, 1_500_000, 0, 'cashier Test']);

    assert.equal((await cashier.get('/v1/pos/staff/reports/overview')).status, 403, 'the overview needs all sales');
    assert.equal((await cashier.get('/v1/pos/staff/reports/day')).status, 403, 'end of day needs cash-up');
    assert.equal((await manager.get('/v1/pos/staff/reports/day')).status, 200);
    assert.equal((await manager.get('/v1/pos/staff/reports/sales.csv?from=2026-01-01&to=2026-01-31')).status, 403, 'exports need export');
    const accountant = await hire(ada, 'accountant');
    assert.equal((await accountant.get('/v1/pos/staff/reports/sales.csv?from=2026-01-01&to=2026-01-31')).status, 200);
    assert.equal((await accountant.post('/v1/pos/staff/shifts', { till_id: ada.till.id })).status, 403, 'an accountant does not open tills');
  });
});

describe('the overview', () => {
  test("today's takings in the shop and on udozo.com against last week, by the hour, payment mix, top sellers, latest sales and restocking", async () => {
    const ada = await owner();
    const tv = await product(ada, 'Samsung 55 inch TV', { price: 1_000_000, stock: 20, reorder: 20 });
    await product(ada, 'Wireless Earbuds Pro', { price: 200_000, stock: 0 });
    await sell(ada, tv, [{ method: 'cash', amount: 1_000_000 }]);
    await sell(ada, tv, [{ method: 'transfer', amount: 2_000_000 }], { quantity: 2 });
    const refunded = (await sell(ada, tv, [{ method: 'card', amount: 1_000_000 }])).json;
    await ada.post(`/v1/pos/owner/sales/${refunded.id}/refund`, { reason: 'Changed mind' });

    // Last week's same day: one shop sale moved back seven days.
    const old = (await sell(ada, tv, [{ method: 'cash', amount: 1_000_000 }])).json;
    await prisma.posSale.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 7 * 86_400_000 - 60_000) } });

    // An online sale of the same TV today.
    const buyer = (await owner()).customerId;
    const order = await prisma.classifiedBuyOrder.create({ data: { listingId: tv.id, buyerId: buyer, sellerId: ada.customerId, country: 'NG', currency: 'NGN', priceMinor: 1_000_000n, status: 'completed', completedAt: new Date() } });
    await prisma.classifiedPurchase.create({ data: { source: 'buy_order', buyOrderId: order.id, listingId: tv.id, sellerId: ada.customerId, buyerId: buyer, country: 'NG', productKey: `l:${tv.id}`, productLabel: 'Samsung 55 inch TV', completedAt: new Date(), reviewClosesAt: new Date(Date.now() + 30 * 86_400_000) } });

    const view = (await ada.get('/v1/pos/owner/reports/overview?period=today')).json;
    assert.equal(view.object, 'pos_overview');
    assert.deepEqual(view.totals.sales, { value: 4_000_000, previous: 1_000_000, change_pct: 300 });
    assert.deepEqual([view.totals.transactions.value, view.totals.transactions.pos, view.totals.transactions.online], [3, 2, 1]);
    assert.equal(view.totals.average_basket.value, 1_333_333);
    assert.equal(view.totals.items.value, 4);
    assert.deepEqual(view.totals.refunds, { count: 1, amount: 1_000_000 });
    assert.deepEqual(view.channels, { pos: { amount: 3_000_000, share_pct: 75 }, online: { amount: 1_000_000, share_pct: 25 } });
    assert.equal(view.series.length, 24);
    assert.equal(view.series.reduce((sum, point) => sum + point.pos + point.online, 0), 4_000_000);
    assert.ok(view.busiest.amount > 0);
    assert.deepEqual(view.payment_methods.map(row => [row.method, row.amount, row.share_pct]), [['transfer', 2_000_000, 67], ['cash', 1_000_000, 33]]);
    assert.deepEqual([view.top_sellers[0].title, view.top_sellers[0].quantity, view.top_sellers[0].pos_quantity, view.top_sellers[0].online_quantity, view.top_sellers[0].revenue], ['Samsung 55 inch TV', 4, 3, 1, 4_000_000]);
    assert.equal(view.recent[0].channel, 'online');
    assert.ok(view.recent.some(row => row.status === 'refunded'));
    assert.deepEqual(view.restock.map(row => [row.title, row.stock]), [['Wireless Earbuds Pro', 0], ['Samsung 55 inch TV', 16]]);
    assert.equal(view.restock[1].per_day, 0.6, 'four sold in a week, shop and online');

    const week = (await ada.get('/v1/pos/owner/reports/overview?period=7d')).json;
    assert.deepEqual([week.by, week.series.length], ['day', 7]);
    assert.equal((await ada.get('/v1/pos/owner/reports/overview?period=custom&from=2026-02-01&to=2025-02-01')).json.error.param, 'to');
    assert.equal((await ada.get('/v1/pos/owner/reports/overview?period=custom&from=2024-01-01&to=2026-01-01')).json.error.code, 'range_too_long');
  });
});

describe('end of day and exports', () => {
  test("the day's takings by method, till and staff, refunds, shifts' cash, as JSON and PDF; sales as CSV with formulas defused; the summary PDF", async () => {
    const ada = await owner();
    const tv = await product(ada, 'Philips 24 inch TV', { price: 500_000 });
    const shift = (await ada.post('/v1/pos/owner/shifts', { till_id: ada.till.id, opening_float: 0 })).json;
    await sell(ada, tv, [{ method: 'cash', amount: 500_000 }]);
    const refunded = (await sell(ada, tv, [{ method: 'card', amount: 500_000 }])).json;
    await ada.post(`/v1/pos/owner/sales/${refunded.id}/refund`, { reason: '=HYPERLINK("http://evil")' });
    await ada.post(`/v1/pos/owner/shifts/${shift.id}/close`, { counted: 500_000 });

    const day = (await ada.get('/v1/pos/owner/reports/day')).json;
    assert.equal(day.object, 'pos_day');
    assert.deepEqual([day.sales.count, day.sales.total, day.refunds.count, day.refunds.total, day.net], [1, 500_000, 1, 500_000, 0]);
    assert.deepEqual(day.by_method, [{ method: 'cash', amount: 500_000 }]);
    assert.deepEqual(day.by_till.map(row => [row.name, row.sales]), [['Till 1', 1]]);
    assert.deepEqual(day.by_staff.map(row => row.name), ['Ada Okafor']);
    assert.deepEqual([day.shifts.length, day.shifts[0].expected_cash, day.shifts[0].difference], [1, 500_000, 0]);
    assert.equal((await ada.get('/v1/pos/owner/reports/day?date=11-11-2026')).status, 400);

    const pdf = await ada.get(`/v1/pos/owner/reports/day.pdf?date=${day.date}`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-');
    assert.match(pdf.headers.get('content-disposition'), new RegExp(`End-of-day-${day.date}\\.pdf`));
    assert.equal(pdf.headers.get('cache-control'), 'no-store, private');

    const csv = await ada.get(`/v1/pos/owner/reports/sales.csv?from=${day.date}&to=${day.date}`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-disposition'), /^attachment; filename="sales-/);
    const rows = csv.bytes.toString('utf8').replace(/^\uFEFF/, '').trim().split('\r\n');
    assert.equal(rows.length, 3);
    assert.match(rows[0], /^Date,Sale,Invoice,Shop,Till,Sold by,Customer,Items,Subtotal/);
    assert.ok(rows.some(row => row.includes(',5000.00,') && row.includes('Cash 5000.00') && row.includes(',completed,')));
    assert.ok(rows.some(row => row.includes(',refunded,') && row.includes(`"'=HYPERLINK(""http://evil"")"`)), 'a formula is never run by the spreadsheet');
    const lines = (await ada.get(`/v1/pos/owner/reports/sales.csv?from=${day.date}&to=${day.date}&detail=lines`)).bytes.toString('utf8');
    assert.match(lines, /Philips 24 inch TV,1,5000\.00,0\.00,5000\.00/);

    const summary = await ada.get(`/v1/pos/owner/reports/summary.pdf?from=${day.date}&to=${day.date}`);
    assert.equal(summary.status, 200);
    assert.equal(summary.bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await ada.get('/v1/pos/owner/reports/summary.pdf?from=2024-01-01&to=2026-01-01')).status, 400);
  });

  test('helpers: CSV cells, period ranges in the shop’s day', async () => {
    const { csvCell, periodRange, changePct } = await import('../dist/pos/reports.service.js');
    assert.deepEqual([csvCell('plain'), csvCell('a,b'), csvCell('say "hi"'), csvCell('=1+1'), csvCell('-5'), csvCell(-5), csvCell(null)], ['plain', '"a,b"', '"say ""hi"""', "'=1+1", "'-5", '-5', '']);
    const now = new Date('2026-11-11T10:30:00Z');
    const today = periodRange('today', {}, 'Africa/Lagos', now);
    assert.deepEqual([today.fromDay, today.toDay, today.start.toISOString(), today.end.toISOString(), today.previous.start.toISOString(), today.by], ['2026-11-11', '2026-11-11', '2026-11-10T23:00:00.000Z', '2026-11-11T10:30:00.000Z', '2026-11-03T23:00:00.000Z', 'hour']);
    const week = periodRange('7d', {}, 'Africa/Lagos', now);
    assert.deepEqual([week.fromDay, week.by, week.previous.start.toISOString()], ['2026-11-05', 'day', '2026-10-28T23:00:00.000Z']);
    const custom = periodRange('custom', { from: '2026-10-01', to: '2026-10-31' }, 'Africa/Lagos', now);
    assert.deepEqual([custom.days, custom.end.toISOString()], [31, '2026-10-31T23:00:00.000Z']);
    assert.deepEqual([changePct(150, 100), changePct(50, 100), changePct(5, 0)], [50, -50, null]);
  });
});
