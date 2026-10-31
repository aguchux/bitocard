// A reseller's own P&L, growth and statement: built only from their own ledger postings (never BitoCard's supplier
// costs or another reseller's data). Revenue is profit earned on sales, never sales volume.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { resellerClient, startApp } from './helpers.mjs';

let server;
let wallets;
let ledger;
let prisma;

const from = '2025-07-01T00:00:00.000Z';
const to = '2025-07-03T00:00:00.000Z';
const day1 = new Date('2025-07-01T12:00:00.000Z');

before(async () => {
  server = await startApp();
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(() => server?.close());

/** Credits a reseller's topped-up funds the way a confirmed top-up does. */
async function fund(resellerId, amount, currency = 'NGN') {
  await ledger.post({
    mode: 'live',
    type: 'top_up',
    reference: `test-fund:${resellerId}:${Math.random()}`,
    resellerId,
    description: 'Test funding',
    lines: [
      { account: { kind: 'provider_balance', currency, provider: 'manual' }, debit: BigInt(amount) },
      { account: { kind: 'reseller_funding', currency, resellerId }, credit: BigInt(amount) },
    ],
  });
}

/** Credits a sale's profit, as `OrdersService.settle()` does (via a customer payment that was itself funded). */
async function sell(resellerId, profit, reference, currency = 'NGN') {
  await ledger.post({
    mode: 'live',
    type: 'test_customer_payment',
    reference: `test-customer-payment:${reference}`,
    resellerId,
    description: 'Test customer payment',
    lines: [
      { account: { kind: 'provider_balance', currency, provider: 'manual' }, debit: BigInt(profit) },
      { account: { kind: 'customer_payments', currency, resellerId }, credit: BigInt(profit) },
    ],
  });
  await wallets.creditEarnings({ resellerId, mode: 'live', amount: BigInt(profit), reference, description: 'Test sale', source: wallets.ref(resellerId, currency, 'customer_payments') });
}

async function platformFee(resellerId, amount, reference, currency = 'NGN') {
  await ledger.post({
    mode: 'live',
    type: 'platform_fee',
    reference: `platform_fee:${reference}`,
    resellerId,
    description: 'Test platform fee',
    metadata: {},
    lines: [
      { account: { kind: 'reseller_funding', currency, resellerId }, debit: BigInt(amount) },
      { account: { kind: 'platform_fees', currency }, credit: BigInt(amount) },
    ],
  });
}

async function moveEntryDate(reference, date) {
  await prisma.journalEntry.update({ where: { reference }, data: { createdAt: date } });
}

describe('reseller P&L', () => {
  test('earnings less platform fees, subscription and a chargeback is net profit', async () => {
    const { browser, resellerId } = await resellerClient(server, { country: 'NG' });
    await fund(resellerId, 100_000_00);

    await sell(resellerId, 5000, 'test-sale-1');
    await platformFee(resellerId, 200, 'test-fee-1');
    const planHold = await wallets.hold({ resellerId, mode: 'live', amount: 300n, reference: 'plan:store:test:premium:2025-07', description: 'Test subscription hold' });
    await wallets.captureHold(planHold.id, 'Test subscription charge');
    const cbHold = await wallets.hold({ resellerId, mode: 'live', amount: 150n, reference: 'chargeback:test-cb-1', description: 'Test chargeback hold' });
    await wallets.captureHoldTo(cbHold.id, 'Test chargeback lost', { kind: 'provider_balance', currency: 'NGN', provider: 'stripe' });

    for (const reference of ['earnings:test-sale-1', 'platform_fee:test-fee-1', `hold_capture:${planHold.id}`, `hold_capture:${cbHold.id}`, `test-fund:${resellerId}`]) {
      await prisma.journalEntry.updateMany({ where: { reference: { startsWith: reference } }, data: { createdAt: day1 } });
    }

    const result = await browser.get(`/v1/reports/pnl?from=${from}&to=${to}`);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.deepEqual(
      [result.json.currency, result.json.revenue, result.json.operating_expenses, result.json.net_profit],
      ['NGN', 5000, 650, 4350],
    );
    const byKind = Object.fromEntries(result.json.breakdown.map(row => [row.kind, row.amount]));
    assert.deepEqual([byKind.earnings, byKind.platform_fee, byKind.subscription, byKind.chargeback], [5000, 200, 300, 150]);
  });

  test('a refund reduces revenue; an admin adjustment shows as its own line', async () => {
    const { browser, resellerId } = await resellerClient(server, { country: 'NG' });
    await fund(resellerId, 100_000_00);
    await sell(resellerId, 8000, 'test-sale-2');
    // A refund reverses the profit, exactly as OrdersService.refund does.
    await ledger.post({
      mode: 'live',
      type: 'order_refund',
      reference: 'order_refund:test-sale-2',
      resellerId,
      description: 'Test refund',
      lines: [
        { account: { kind: 'reseller_earnings_held', currency: 'NGN', resellerId }, debit: 8000n },
        { account: { kind: 'customer_payments', currency: 'NGN', resellerId }, credit: 8000n },
      ],
    });
    await ledger.post({
      mode: 'live',
      type: 'adjustment',
      reference: 'adjustment:test-1',
      resellerId,
      description: 'Goodwill credit',
      lines: [
        { account: { kind: 'adjustments', currency: 'NGN' }, debit: 1000n },
        { account: { kind: 'reseller_funding', currency: 'NGN', resellerId }, credit: 1000n },
      ],
    });
    for (const reference of ['earnings:test-sale-2', 'order_refund:test-sale-2', 'adjustment:test-1', `test-fund:${resellerId}`]) {
      await prisma.journalEntry.updateMany({ where: { reference: { startsWith: reference } }, data: { createdAt: day1 } });
    }
    const result = await browser.get(`/v1/reports/pnl?from=${from}&to=${to}`);
    assert.equal(result.json.revenue, 0, 'the sale and its refund net to nothing');
    const byKind = Object.fromEntries(result.json.breakdown.map(row => [row.kind, row.amount]));
    assert.equal(byKind.adjustment, 1000);
  });

  test('only a date range outside the activity is empty; never another reseller\'s postings', async () => {
    const { browser: a, resellerId: ra } = await resellerClient(server, { country: 'NG' });
    const { browser: b } = await resellerClient(server, { country: 'NG' });
    await fund(ra, 100_000_00);
    await sell(ra, 2000, 'test-sale-isolation');
    await prisma.journalEntry.updateMany({ where: { reference: { startsWith: 'earnings:test-sale-isolation' } }, data: { createdAt: day1 } });

    const resultA = await a.get(`/v1/reports/pnl?from=${from}&to=${to}`);
    assert.equal(resultA.json.revenue, 2000);
    const resultB = await b.get(`/v1/reports/pnl?from=${from}&to=${to}`);
    assert.equal(resultB.json.revenue, 0, "another reseller's sale never appears");

    const empty = await a.get('/v1/reports/pnl?from=2099-01-01&to=2099-02-01');
    assert.deepEqual([empty.json.revenue, empty.json.breakdown], [0, []]);
  });
});

describe('reseller growth', () => {
  test('buckets daily earnings and projects a trend forward', async () => {
    const { browser, resellerId } = await resellerClient(server, { country: 'NG' });
    await fund(resellerId, 100_000_00);
    await sell(resellerId, 3000, 'test-sale-growth-1');
    await sell(resellerId, 4000, 'test-sale-growth-2');
    await moveEntryDate('earnings:test-sale-growth-1', day1);
    await moveEntryDate('earnings:test-sale-growth-2', new Date('2025-07-02T12:00:00.000Z'));

    const result = await browser.get('/v1/reports/growth?from=2025-07-01T00:00:00.000Z&to=2025-07-04T00:00:00.000Z&metric=earnings');
    assert.equal(result.status, 200, JSON.stringify(result.json));
    const real = result.json.points.filter(point => !point.projected);
    assert.deepEqual(real.map(point => point.value), [3000, 4000, 0]);
    assert.ok(result.json.points.some(point => point.projected), 'the trend continues');
  });
});

describe('reseller statement', () => {
  test('lists their own wallet transactions for the range, downloadable as CSV and PDF', async () => {
    const { browser, resellerId } = await resellerClient(server, { country: 'NG' });
    await fund(resellerId, 100_000_00);
    await sell(resellerId, 6000, 'test-sale-statement');
    await moveEntryDate('earnings:test-sale-statement', day1);

    const json = await browser.get(`/v1/reports/statement?from=${from}&to=${to}`);
    assert.equal(json.status, 200, JSON.stringify(json.json));
    assert.ok(json.json.data.some(row => row.type === 'earnings' && row.amount === 6000));

    const csvRes = await fetch(`${server.base}/v1/reports/statement.csv?from=${from}&to=${to}`, { headers: { cookie: [...browser.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    assert.equal(csvRes.status, 200);
    assert.match(csvRes.headers.get('content-type') ?? '', /text\/csv/);
    const text = await csvRes.text();
    assert.match(text, /earnings/);

    const pdfRes = await fetch(`${server.base}/v1/reports/statement.pdf?from=${from}&to=${to}`, { headers: { cookie: [...browser.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    assert.equal(pdfRes.status, 200);
    assert.match(pdfRes.headers.get('content-type') ?? '', /application\/pdf/);
    const buffer = Buffer.from(await pdfRes.arrayBuffer());
    assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  });
});

describe('reseller reports: domains and periods', () => {
  test('a domain bought from the wallet is an expense; an order\'s wholesale never is', async () => {
    const { browser, resellerId } = await resellerClient(server, { country: 'NG' });
    await fund(resellerId, 100_000_00);
    await sell(resellerId, 9000, 'test-sale-domain');
    // A domain bought as DomainsService does: held, then captured into domain revenue.
    const domainHold = await wallets.hold({ resellerId, mode: 'live', amount: 2500n, reference: 'domain:test-domain:register', description: 'Domain: ada.com' });
    await wallets.captureHold(domainHold.id, 'Domain bought: ada.com', [{ kind: 'domain_revenue', amount: 2500n }]);
    // An order's wholesale: the cost of what was sold, not shown as an expense.
    const orderHold = await wallets.hold({ resellerId, mode: 'live', amount: 4000n, reference: 'order:test-order-domain', description: 'Order' });
    await wallets.captureHold(orderHold.id);
    // Midday on the 2nd: the period "from the 2nd to the 2nd", as the date picker sends it, must include it.
    const day2 = new Date('2025-07-02T12:00:00.000Z');
    for (const reference of ['earnings:test-sale-domain', `hold_capture:${domainHold.id}`, `hold_capture:${orderHold.id}`]) await moveEntryDate(reference, day2);

    const result = await browser.get('/v1/reports/pnl?from=2025-07-02&to=2025-07-02');
    assert.equal(result.status, 200, JSON.stringify(result.json));
    const byKind = Object.fromEntries(result.json.breakdown.map(row => [row.kind, row.amount]));
    assert.deepEqual([result.json.revenue, byKind.domain, result.json.operating_expenses, result.json.net_profit], [9000, 2500, 2500, 6500]);

    const statement = await browser.get('/v1/reports/statement?from=2025-07-02&to=2025-07-02');
    const domain = statement.json.data.find(row => row.type === 'domain');
    assert.deepEqual([domain.amount, domain.reference], [-2500, `hold_capture:${domainHold.id}`]);
    assert.ok(statement.json.data.every(row => row.reference), 'every row names its entry');
    assert.equal(statement.json.data.length, 2, 'the sale and the domain; never the order\'s wholesale');

    const backwards = await browser.get('/v1/reports/pnl?from=2025-07-03&to=2025-07-01');
    assert.deepEqual([backwards.status, backwards.json.error.code], [400, 'parameter_invalid']);
  });
});
