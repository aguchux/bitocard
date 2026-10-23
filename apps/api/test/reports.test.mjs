// Platform-wide reporting: a P&L rolls revenue, cost of sales and operating expenses out of the ledger for a date
// range; growth buckets a metric by day with a simple trend projection; the statement (JSON, CSV, PDF) is the same
// rows behind the P&L.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';

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

describe('periods', () => {
  test('a plain date for the end means the whole of that day, as the admin app\'s date picker sends it', async () => {
    // Day 2 (2025-06-02) holds USD 200.00 of revenue at midday; "from the 2nd to the 2nd" must include it.
    const result = await admin.get('/v1/admin/reports/pnl?mode=live&from=2025-06-02&to=2025-06-02&currency=USD');
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.revenue, 20000);
    assert.equal(result.json.to, '2025-06-03T00:00:00.000Z');
  });

  test('an end before its start is refused, and daily growth over a year asks for a shorter period', async () => {
    const backwards = await admin.get('/v1/admin/reports/pnl?mode=live&from=2025-06-03&to=2025-06-01');
    assert.deepEqual([backwards.status, backwards.json.error.code, backwards.json.error.param], [400, 'parameter_invalid', 'to']);
    const long = await admin.get('/v1/admin/reports/growth?mode=live&from=2024-01-01&to=2025-06-01&metric=orders');
    assert.deepEqual([long.status, long.json.error.code], [400, 'range_too_long']);
  });

  test('a statement longer than its limit is refused, never cut short', async () => {
    const { ReportsService } = await import('../dist/reports/reports.service.js');
    await assert.rejects(
      server.app.get(ReportsService).statement({ mode: 'live', from: new Date(from), to: new Date(to), currency: 'USD', maxRows: 1 }),
      error => error.code === 'statement_too_large',
    );
  });
});

describe("BitoCard's own stores and adjustments", () => {
  const augFrom = '2025-08-01T00:00:00.000Z';
  const augTo = '2025-08-04T00:00:00.000Z';
  const aug1 = new Date('2025-08-01T12:00:00.000Z');

  before(async () => {
    // A market's house account: its earnings are BitoCard's retail margin on its own stores.
    const { HouseService } = await import('../dist/checkout/house.service.js');
    const house = await server.app.get(HouseService).resellerFor('KE');
    // A reseller's earnings are theirs, never BitoCard's revenue.
    const { resellerId } = await resellerClient(server, { country: 'NG' });
    const posts = [
      {
        type: 'earnings',
        reference: 'reports_test:house_margin',
        resellerId: house.id,
        lines: [
          { account: { kind: 'provider_balance', currency: 'USD', provider: 'manual' }, debit: 700n },
          { account: { kind: 'reseller_earnings_held', currency: 'USD', resellerId: house.id }, credit: 700n },
        ],
      },
      {
        type: 'earnings',
        reference: 'reports_test:reseller_margin',
        resellerId,
        lines: [
          { account: { kind: 'provider_balance', currency: 'USD', provider: 'manual' }, debit: 999n },
          { account: { kind: 'reseller_earnings_held', currency: 'USD', resellerId }, credit: 999n },
        ],
      },
      {
        // A goodwill credit to a reseller: BitoCard's expense.
        type: 'adjustment',
        reference: 'reports_test:goodwill',
        resellerId,
        lines: [
          { account: { kind: 'adjustments', currency: 'USD' }, debit: 300n },
          { account: { kind: 'reseller_funding', currency: 'USD', resellerId }, credit: 300n },
        ],
      },
      {
        // Seized crypto lands in `adjustments` in the coin's units: never money, never priced here.
        type: 'crypto_seize',
        reference: 'reports_test:seize',
        lines: [
          { account: { kind: 'crypto_custody', currency: 'USDT' }, debit: 5_000_000n },
          { account: { kind: 'adjustments', currency: 'USDT' }, credit: 5_000_000n },
        ],
      },
    ];
    for (const post of posts) {
      await ledger.post({ mode: 'live', description: post.reference, ...post });
      await prisma.journalEntry.update({ where: { reference: post.reference }, data: { createdAt: aug1 } });
    }
  });

  test("the retail margin of BitoCard's own stores is revenue; resellers' earnings are not; adjustments are an expense", async () => {
    for (const currency of ['USD', undefined]) {
      const result = await admin.get(`/v1/admin/reports/pnl?mode=live&from=${augFrom}&to=${augTo}${currency ? `&currency=${currency}` : ''}`);
      assert.equal(result.status, 200, JSON.stringify(result.json));
      const byKind = Object.fromEntries(result.json.breakdown.map(row => [row.kind, row.amount]));
      assert.deepEqual([result.json.revenue, result.json.operating_expenses, result.json.net_profit], [700, 300, 400], currency ?? 'every market');
      assert.deepEqual([byKind.retail_margin, byKind.adjustments], [700, 300]);
      assert.deepEqual(result.json.unconverted, [], 'a crypto asset is never a currency to convert');
    }
  });

  test('the statement and growth count the retail margin too, and never a crypto posting', async () => {
    const statement = await admin.get(`/v1/admin/reports/statement?mode=live&from=${augFrom}&to=${augTo}`);
    assert.equal(statement.status, 200, JSON.stringify(statement.json));
    const margin = statement.json.data.find(row => row.reference === 'reports_test:house_margin');
    assert.deepEqual([margin.kind, margin.label, margin.credit], ['retail_margin', "Retail margin on BitoCard's own stores", 700]);
    assert.ok(!statement.json.data.some(row => row.reference === 'reports_test:reseller_margin'), "a reseller's earnings are not BitoCard's");
    assert.ok(!statement.json.data.some(row => row.currency === 'USDT'), 'crypto postings are left out');

    const growth = await admin.get(`/v1/admin/reports/growth?mode=live&from=${augFrom}&to=${augTo}&metric=platform_revenue`);
    assert.deepEqual(growth.json.points.filter(point => !point.projected).map(point => point.value), [7, 0, 0]);
  });
});
