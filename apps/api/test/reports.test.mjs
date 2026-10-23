// Platform-wide reporting: a P&L rolls revenue, cost of sales and operating expenses out of the ledger for a date
// range; growth buckets a metric by day with a simple trend projection; the statement (JSON, CSV, PDF) is the same
// rows behind the P&L.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;
let ledger;

const from = '2025-06-01T00:00:00.000Z';
const to = '2025-06-03T00:00:00.000Z';
const day1 = new Date('2025-06-01T12:00:00.000Z');
const day2 = new Date('2025-06-02T12:00:00.000Z');

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
  admin = await adminClient(server, ['finance']);

  // Day 1: USD 100.00 platform revenue, USD 40.00 cost of sales (against reloadly's float), USD 5.00 processing fee.
  await ledger.post({
    mode: 'live',
    type: 'order_revenue',
    reference: 'reports_test:revenue:1',
    description: 'Test revenue 1',
    lines: [
      { account: { kind: 'platform_revenue', currency: 'USD' }, credit: 10000n },
      { account: { kind: 'provider_balance', currency: 'USD', provider: 'manual' }, debit: 10000n },
    ],
  });
  await ledger.post({
    mode: 'live',
    type: 'order_cost',
    reference: 'reports_test:cost:1',
    description: 'Test cost of sales 1',
    lines: [
      { account: { kind: 'cost_of_sales', currency: 'USD', provider: 'reloadly' }, debit: 4000n },
      { account: { kind: 'supplier_float', currency: 'USD', provider: 'reloadly' }, credit: 4000n },
    ],
  });
  await ledger.post({
    mode: 'live',
    type: 'processing_fee',
    reference: 'reports_test:fee:1',
    description: 'Test processing fee 1',
    lines: [
      { account: { kind: 'processing_fees', currency: 'USD' }, debit: 500n },
      { account: { kind: 'provider_balance', currency: 'USD', provider: 'manual' }, credit: 500n },
    ],
  });
  // Day 2: another USD 200.00 of platform revenue, nothing else.
  await ledger.post({
    mode: 'live',
    type: 'order_revenue',
    reference: 'reports_test:revenue:2',
    description: 'Test revenue 2',
    lines: [
      { account: { kind: 'platform_revenue', currency: 'USD' }, credit: 20000n },
      { account: { kind: 'provider_balance', currency: 'USD', provider: 'manual' }, debit: 20000n },
    ],
  });

  for (const reference of ['reports_test:revenue:1', 'reports_test:cost:1', 'reports_test:fee:1']) {
    await prisma.journalEntry.update({ where: { reference }, data: { createdAt: day1 } });
  }
  await prisma.journalEntry.update({ where: { reference: 'reports_test:revenue:2' }, data: { createdAt: day2 } });
});

after(() => server?.close());

describe('P&L', () => {
  test('revenue less cost of sales is gross profit; less operating expenses is net profit, in one market currency', async () => {
    const result = await admin.get(`/v1/admin/reports/pnl?mode=live&from=${from}&to=${to}&currency=USD`);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.deepEqual(
      [result.json.currency, result.json.revenue, result.json.cost_of_sales, result.json.gross_profit, result.json.operating_expenses, result.json.net_profit],
      ['USD', 30000, 4000, 26000, 500, 25500],
    );
    const kinds = result.json.breakdown.map(row => row.kind).sort();
    assert.deepEqual(kinds, ['cost_of_sales', 'platform_revenue', 'processing_fees']);
    assert.equal(result.json.breakdown.find(row => row.kind === 'platform_revenue').amount, 30000);
  });

  test('without a currency, every market is converted to USD at the reference rate', async () => {
    for (const source of ['open_exchange_rates', 'flutterwave']) {
      await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date() } });
    }
    await ledger.post({
      mode: 'live',
      type: 'order_revenue',
      reference: 'reports_test:revenue:ngn',
      description: 'Test NGN revenue',
      lines: [
        { account: { kind: 'platform_revenue', currency: 'NGN' }, credit: 150000n },
        { account: { kind: 'provider_balance', currency: 'NGN', provider: 'manual' }, debit: 150000n },
      ],
    });
    await prisma.journalEntry.update({ where: { reference: 'reports_test:revenue:ngn' }, data: { createdAt: day1 } });
    const result = await admin.get(`/v1/admin/reports/pnl?mode=live&from=${from}&to=${to}`);
    assert.equal(result.json.currency, 'USD');
    // 30000 cents already USD, plus NGN 1,500.00 at 1500 units/USD = USD 1.00 = 100 cents.
    assert.equal(result.json.revenue, 30100);
    assert.equal(result.json.unconverted.length, 0);
  });

  test('a date range outside the activity is empty, not an error', async () => {
    const result = await admin.get('/v1/admin/reports/pnl?mode=live&from=2099-01-01&to=2099-02-01&currency=USD');
    assert.deepEqual([result.json.revenue, result.json.cost_of_sales, result.json.net_profit, result.json.breakdown], [0, 0, 0, []]);
  });

  test('operations and support can read; other roles cannot', async () => {
    for (const role of ['operations', 'support']) {
      const other = await adminClient(server, [role]);
      assert.equal((await other.get(`/v1/admin/reports/pnl?mode=live&from=${from}&to=${to}`)).status, role === 'support' ? 403 : 200, role);
    }
  });
});

describe('growth', () => {
  test('buckets platform revenue by day and projects a trend forward', async () => {
    // At least 3 buckets, so there is something to fit a trend to.
    const wideTo = '2025-06-04T00:00:00.000Z';
    const result = await admin.get(`/v1/admin/reports/growth?mode=live&from=${from}&to=${wideTo}&metric=platform_revenue`);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    const real = result.json.points.filter(point => !point.projected);
    // Day 1 is USD 100 plus the USD 1 the P&L suite's NGN revenue (above) converts to; day 3 has no activity.
    assert.deepEqual(real.map(point => point.value), [101, 200, 0]);
    const projected = result.json.points.filter(point => point.projected);
    assert.ok(projected.length > 0, 'the trend continues past the range');
    assert.ok(projected.every(point => point.value >= 0), 'never a negative projection');
  });
});

describe('statement', () => {
  test('the JSON statement lists the dated rows behind the P&L, as debits and credits', async () => {
    const result = await admin.get(`/v1/admin/reports/statement?mode=live&from=${from}&to=${to}&currency=USD`);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    const revenueRow = result.json.data.find(row => row.reference === 'reports_test:revenue:1');
    assert.deepEqual([revenueRow.kind, revenueRow.debit, revenueRow.credit], ['platform_revenue', null, 10000]);
    const costRow = result.json.data.find(row => row.reference === 'reports_test:cost:1');
    assert.deepEqual([costRow.kind, costRow.debit, costRow.credit], ['cost_of_sales', 4000, null]);
  });

  // The JSON helper's client always parses the body as JSON, so file downloads are fetched directly, replaying
  // the signed-in admin's session cookie from the client's own cookie jar.
  const cookieHeader = client => [...client.jar].map(([name, value]) => `${name}=${value}`).join('; ');

  test('the CSV export is a downloadable file with the same rows', async () => {
    const res = await fetch(`${server.base}/v1/admin/reports/statement.csv?mode=live&from=${from}&to=${to}&currency=USD`, { headers: { cookie: cookieHeader(admin) } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="bitocard-statement-/);
    const text = await res.text();
    assert.match(text, /Platform revenue/);
    assert.match(text, /100\.00/);
  });

  test('the PDF export is a downloadable PDF file', async () => {
    const res = await fetch(`${server.base}/v1/admin/reports/statement.pdf?mode=live&from=${from}&to=${to}&currency=USD`, { headers: { cookie: cookieHeader(admin) } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/pdf/);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  });
});
