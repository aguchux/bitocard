// BitoCard's fees on resellers' own-integration transactions: exact rates in parts per billion, the carried fraction,
// holds before and charges after, releases on failure, refunds, statements, reports and reconciliation.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';

let server;
let prisma;
let admin;
let fees;
let feeMath;
let counter = 0;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  feeMath = await import('../dist/fees/platform-fees.service.js');
  fees = server.app.get(feeMath.PlatformFeesService);
  admin = await adminClient(server, ['finance']);
});

after(() => server?.close());

/** A reseller with money in their live wallet (minor units). */
async function funded(amount = 100_000, country = 'NG') {
  const reseller = await resellerClient(server, { country });
  if (amount > 0) {
    const res = await admin.post(`/v1/admin/resellers/${reseller.resellerId}/wallet/adjustments`, { mode: 'live', balance: 'funding', amount, reason: 'Test funding' });
    assert.equal(res.status, 201, JSON.stringify(res.json));
  }
  return reseller;
}

const source = () => ({ type: 'order', id: `order-${(counter += 1)}-${Date.now()}` });
const setRule = body => admin.put('/v1/admin/fee-rules', body);
const available = async browser => (await browser.get('/v1/wallet')).json.available;

describe('fee arithmetic', () => {
  test('rates are parts per billion and the exact fee is base x rate, never rounded', () => {
    assert.equal(feeMath.exactFeeNano(5000n, 100_000), 500_000_000n, '0.01% of 5,000 is half a minor unit');
    assert.equal(feeMath.exactFeeNano(1n, 1), 1n, 'the smallest rate on the smallest base');
    assert.equal(feeMath.percentOf(100_000), '0.01');
    assert.equal(feeMath.percentOf(1), '0.0000001');
    assert.equal(feeMath.percentOf(100_000_000), '10');
    assert.equal(feeMath.percentOf(25_500_000), '2.55');
  });

  test('the most a fee can charge is its exact amount rounded up, whatever the carry', () => {
    for (const exact of [0n, 1n, 500_000_000n, 1_000_000_000n, 1_500_000_001n, 7_999_999_999n]) {
      const max = feeMath.maxFeeMinor(exact, null);
      for (const carry of [0n, 1n, 499_999_999n, 999_999_999n]) {
        const { charged, carryAfter, extra } = feeMath.settleFee(carry, exact, null);
        assert.ok(charged <= max, `exact ${exact} carry ${carry}`);
        assert.ok(carryAfter >= 0n && carryAfter < feeMath.nanoPerMinor);
        assert.equal(carry + exact + extra, charged * feeMath.nanoPerMinor + carryAfter);
      }
    }
  });

  test('a minimum fee charges at least the minimum and restarts the carry', () => {
    assert.deepEqual(feeMath.settleFee(300n, 500_000_000n, 5n), { charged: 5n, carryAfter: 0n, extra: 5n * 1_000_000_000n - 500_000_300n });
    assert.equal(feeMath.maxFeeMinor(500_000_000n, 5n), 5n);
    assert.deepEqual(feeMath.settleFee(0n, 7_200_000_000n, 5n), { charged: 7n, carryAfter: 200_000_000n, extra: 0n });
  });
});

describe('fee rules', () => {
  test('the most specific rule wins: country, then category, then plan; none means no fee', async () => {
    const kind = 'gateway_payment';
    const { resellerId } = await funded(0, 'GH');
    assert.equal((await fees.quote({ resellerId, kind, baseMinor: 10_000n })).ratePpb, 0, 'no rule, no fee');
    assert.equal((await setRule({ kind, rate_ppb: 1_000_000 })).status, 200);
    assert.equal((await fees.quote({ resellerId, kind, baseMinor: 10_000n })).ratePpb, 1_000_000);
    await setRule({ kind, plan_code: 'standard', rate_ppb: 900_000 });
    assert.equal((await fees.quote({ resellerId, kind, baseMinor: 10_000n })).ratePpb, 900_000, 'plan beats global');
    await setRule({ kind, country_code: 'gh', rate_ppb: 800_000 });
    assert.equal((await fees.quote({ resellerId, kind, baseMinor: 10_000n })).ratePpb, 800_000, 'country beats plan');
    const again = await setRule({ kind, country_code: 'GH', rate_ppb: 700_000 });
    assert.equal(again.json.rate_percent, '0.07', 'one rule per scope, updated in place');
    const list = await admin.get('/v1/admin/fee-rules');
    assert.equal(list.json.data.filter(rule => rule.kind === kind && rule.country_code === 'GH').length, 1);
    for (const rule of list.json.data.filter(item => item.kind === kind)) assert.equal((await admin.delete(`/v1/admin/fee-rules/${rule.id}`)).status, 204);
  });

  test('rates stay within 0% and 10%, minimums need a country, and only finance changes rules', async () => {
    assert.equal((await setRule({ kind: 'supplier_order', rate_ppb: 100_000_001 })).status, 400);
    assert.equal((await setRule({ kind: 'supplier_order', rate_ppb: -1 })).status, 400);
    assert.equal((await setRule({ kind: 'supplier_order', rate_ppb: 1, min_fee_minor: 10 })).json.error.code, 'country_required');
    assert.equal((await setRule({ kind: 'gateway_payment', category: 'airtime', rate_ppb: 1 })).json.error.param, 'category');
    const support = await adminClient(server, ['support']);
    assert.equal((await support.put('/v1/admin/fee-rules', { kind: 'supplier_order', rate_ppb: 1 })).status, 403);
    assert.equal((await support.get('/v1/admin/fee-rules')).status, 200);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'fee_rule.set' } });
    assert.ok(audit);
  });
});

describe('holding and charging', () => {
  test('a 0.01% fee on small orders is charged exactly over time through the carry', async () => {
    await setRule({ kind: 'supplier_order', country_code: 'NG', category: 'airtime', rate_ppb: 100_000 });
    const { browser, resellerId } = await funded(10_000);
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      // 50.00 airtime: 0.01% is half a kobo.
      const charge = await fees.hold({ resellerId, mode: 'live', kind: 'supplier_order', category: 'airtime', baseMinor: 5_000n, source: source(), description: 'Airtime' });
      assert.equal(charge.heldMinor, 1n, 'holds the most it can be: one kobo');
      results.push(await fees.settle(charge.id));
    }
    assert.deepEqual(results.map(row => row.chargedMinor), [0n, 1n, 0n, 1n]);
    assert.deepEqual(results.map(row => row.carryAfterNano), [500_000_000n, 0n, 500_000_000n, 0n]);
    assert.equal(await available(browser), 10_000 - 2, 'exactly 0.01% of 200.00');

    const history = (await browser.get('/v1/wallet/transactions?limit=100')).json.data;
    const feeEntries = history.filter(entry => entry.type === 'platform_fee');
    assert.equal(feeEntries.length, 2, 'only charged fees post an entry');
    assert.deepEqual([feeEntries[0].amount, feeEntries[0].fee.source.type], [-1, 'order']);
    await setRule({ kind: 'supplier_order', country_code: 'NG', category: 'airtime', rate_ppb: 0 });
  });

  test('the smallest rate accrues for a long time before charging a single unit', async () => {
    await setRule({ kind: 'supplier_order', country_code: 'KE', rate_ppb: 1 });
    const { resellerId } = await funded(1_000, 'KE');
    const charge = await fees.hold({ resellerId, mode: 'live', kind: 'supplier_order', baseMinor: 999_999n, source: source(), description: 'Gift card' });
    const settled = await fees.settle(charge.id);
    assert.deepEqual([settled.exactNano, settled.chargedMinor, settled.carryAfterNano], [999_999n, 0n, 999_999n]);
  });

  test('a fee the wallet cannot cover is refused before the transaction; failures release the hold and keep the carry', async () => {
    await setRule({ kind: 'supplier_order', country_code: 'NG', rate_ppb: 10_000_000 });
    const poor = await funded(0);
    await assert.rejects(
      fees.hold({ resellerId: poor.resellerId, mode: 'live', kind: 'supplier_order', baseMinor: 10_000n, source: source(), description: 'Order' }),
      error => error.code === 'insufficient_funds',
    );
    assert.equal(await prisma.feeCharge.count({ where: { resellerId: poor.resellerId } }), 0);

    const { browser, resellerId } = await funded(5_000);
    const charge = await fees.hold({ resellerId, mode: 'live', kind: 'supplier_order', baseMinor: 10_005n, source: source(), description: 'Order' });
    assert.equal(charge.heldMinor, 101n, '1% of 100.05 is 100.05 kobo, held as 101');
    assert.equal(await available(browser), 5_000 - 101);
    const released = await fees.release(charge.id);
    assert.deepEqual([released.status, released.chargedMinor], ['released', 0n]);
    assert.equal(await available(browser), 5_000);
    assert.equal(await prisma.feeCarry.count({ where: { resellerId } }), 0, 'a failure never touches the carry');
    assert.equal((await fees.settle(charge.id)).status, 'released', 'a released fee is never charged');
  });

  test('holding twice for the same transaction holds once; settling twice charges once', async () => {
    await setRule({ kind: 'supplier_order', country_code: 'NG', rate_ppb: 10_000_000 });
    const { browser, resellerId } = await funded(5_000);
    const from = source();
    const input = { resellerId, mode: 'live', kind: 'supplier_order', baseMinor: 20_000n, source: from, description: 'Order' };
    const [a, b] = await Promise.all([fees.hold(input), fees.hold(input)]);
    assert.equal(a.id, b.id);
    const [first, second] = await Promise.all([fees.settle(a.id), fees.settle(a.id)]);
    assert.equal(first.status, 'charged');
    assert.equal(second.status, 'charged');
    assert.equal(await available(browser), 5_000 - 200);
    assert.equal(await prisma.journalEntry.count({ where: { reference: `fee:order:${from.id}` } }), 1);
  });

  test('concurrent settlements share the carry correctly', async () => {
    await setRule({ kind: 'supplier_order', country_code: 'NG', category: 'data', rate_ppb: 100_000 });
    const { resellerId } = await funded(10_000);
    const charges = [];
    for (let i = 0; i < 6; i += 1) charges.push(await fees.hold({ resellerId, mode: 'live', kind: 'supplier_order', category: 'data', baseMinor: 5_000n, source: source(), description: 'Data' }));
    const settled = await Promise.all(charges.map(charge => fees.settle(charge.id)));
    const total = settled.reduce((sum, row) => sum + row.chargedMinor, 0n);
    const carry = (await prisma.feeCarry.findFirstOrThrow({ where: { resellerId } })).carryNano;
    assert.equal(total * 1_000_000_000n + carry, 6n * 500_000_000n, 'six half-kobo fees: three kobo, nothing lost or doubled');
  });

  test('a minimum fee is charged and recorded as extra', async () => {
    await setRule({ kind: 'gateway_payment', country_code: 'NG', rate_ppb: 100_000, min_fee_minor: 5 });
    const { resellerId } = await funded(1_000);
    const charge = await fees.hold({ resellerId, mode: 'live', kind: 'gateway_payment', baseMinor: 10_000n, source: { type: 'payment', id: `pay-${Date.now()}` }, description: 'Checkout' });
    assert.equal(charge.heldMinor, 5n);
    const settled = await fees.settle(charge.id);
    assert.deepEqual([settled.chargedMinor, settled.extraNano], [5n, 4_000_000_000n]);
  });

  test('a charged fee can be refunded once, to topped-up funds, by finance', async () => {
    await setRule({ kind: 'supplier_order', country_code: 'NG', rate_ppb: 10_000_000 });
    const { browser, resellerId } = await funded(5_000);
    const charge = await fees.settle((await fees.hold({ resellerId, mode: 'live', kind: 'supplier_order', baseMinor: 30_000n, source: source(), description: 'Order' })).id);
    assert.equal(await available(browser), 5_000 - 300);
    const refund = await admin.post(`/v1/admin/fees/${charge.id}/refund`, { reason: 'Supplier never delivered' });
    assert.deepEqual([refund.status, refund.json.status], [200, 'refunded']);
    assert.equal(await available(browser), 5_000);
    assert.equal((await admin.post(`/v1/admin/fees/${charge.id}/refund`, { reason: 'Supplier never delivered' })).json.status, 'refunded', 'once');
    assert.equal(await prisma.journalEntry.count({ where: { reference: `fee:refund:${charge.id}` } }), 1);
  });
});

describe('statements, reports and reconciliation', () => {
  test('the reseller sees their fees, rates and monthly statement; another reseller sees none of it', async () => {
    await setRule({ kind: 'supplier_order', country_code: 'GH', rate_ppb: 2_500_000 });
    const { browser, resellerId } = await funded(100_000, 'GH');
    for (let i = 0; i < 2; i += 1) await fees.settle((await fees.hold({ resellerId, mode: 'live', kind: 'supplier_order', baseMinor: 40_000n, source: source(), description: 'Order' })).id);

    const list = await browser.get('/v1/wallet/fees');
    assert.equal(list.status, 200);
    assert.equal(list.json.data.length, 2);
    assert.deepEqual([list.json.data[0].rate_percent, list.json.data[0].charged, list.json.data[0].exact_nano], ['0.25', 100, '100000000000']);
    const month = new Date().toISOString().slice(0, 7);
    const statement = await browser.get(`/v1/wallet/fees/statement?month=${month}`);
    assert.deepEqual([statement.json.fees.charged, statement.json.fees.transactions, statement.json.currency], [200, 2, 'GHS']);
    assert.equal((await browser.get('/v1/wallet/fees/statement?month=2026-13')).status, 400);
    const rates = await browser.get('/v1/wallet/fee-rates');
    assert.equal(rates.json.data.find(rate => rate.kind === 'supplier_order' && rate.category === null).rate_percent, '0.25');

    const other = await funded(0, 'GH');
    assert.equal((await other.browser.get('/v1/wallet/fees')).json.data.length, 0);
  });

  test('admins report fee revenue by reseller, kind and country, and reconciliation adds up', async () => {
    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const byKind = await admin.get(`/v1/admin/fees/report?from=${from}&to=${to}&group_by=kind`);
    assert.equal(byKind.status, 200);
    assert.ok(byKind.json.data.some(row => row.key === 'supplier_order' && row.net > 0));
    const byCountry = await admin.get(`/v1/admin/fees/report?from=${from}&to=${to}&group_by=country`);
    assert.ok(byCountry.json.data.some(row => row.key === 'GH' && row.currency === 'GHS'));
    const reconciliation = await admin.get('/v1/admin/fees/reconciliation');
    assert.equal(reconciliation.status, 200);
    assert.equal(reconciliation.json.ok, true, JSON.stringify(reconciliation.json));
    assert.ok(reconciliation.json.checked > 0);

    // The ledger as a whole still balances.
    const ledger = await admin.get('/v1/admin/ledger/check');
    assert.equal(ledger.json.ok, true, JSON.stringify(ledger.json));
  });
});
