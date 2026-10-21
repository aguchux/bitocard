// Invoices and the credit limit: every live charge is a line on the month's invoice (per store, or the account's own);
// usage the wallet cannot cover is owed up to the credit limit and then refused; at the limit billable usage stops;
// top-ups pay what is owed first, oldest first; the job closes last month's invoices, sets their due dates and drops the
// limit a step for overdue ones; resellers raise it a step after a full month paid in full; admins set it.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { responseChecker } from './openapi-docs.mjs';

let server;
let prisma;
let wallets;
let invoices;
let check;
const day = 86_400_000;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  invoices = server.app.get((await import('../dist/billing/invoices.service.js')).InvoicesService);
  check = await responseChecker(server.app);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
});

after(() => server?.close());

/** A Nigerian reseller with a store and `amount` in the live wallet. */
async function reseller(amount = 0) {
  const owner = await resellerClient(server);
  await prisma.reseller.update({ where: { id: owner.resellerId }, data: { country: 'NG' } });
  if (amount) await wallets.adjust(null, { resellerId: owner.resellerId, mode: 'live', balance: 'funding', amount, reason: 'Top-up' });
  const store = (await owner.browser.post('/v1/stores', { name: 'Shop', subdomain: `shop${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` })).json;
  return { ...owner, store };
}
const usage = (resellerId, storeId, amount, reference = crypto.randomUUID()) =>
  invoices.charge({ resellerId, storeId, currency: 'NGN', kind: 'usage', description: 'AI replies', amount: BigInt(amount), reference: `usage:${reference}`, revenue: 'platform_revenue' });
const ledgerOk = async () => assert.equal((await (await adminClient(server, ['finance'])).get('/v1/admin/ledger/check')).json.ok, true);

describe('invoices', () => {
  test('a store’s plan is a paid line on its invoice for the month', async () => {
    const { browser, store } = await reseller(100_000_000);
    assert.equal((await browser.post(`/v1/stores/${store.id}/subscription`, { plan: 'premium' })).status, 200);
    const list = await browser.get('/v1/invoices');
    check('GET /v1/invoices', 200, list.json);
    assert.equal(list.json.data.length, 1);
    const [invoice] = list.json.data;
    assert.deepEqual([invoice.store_id, invoice.status, invoice.currency, invoice.total, invoice.owed], [store.id, 'open', 'NGN', 3_806_250, 0]);
    const detail = await browser.get(`/v1/invoices/${invoice.id}`);
    check('GET /v1/invoices/{id}', 200, detail.json);
    assert.deepEqual(detail.json.lines.map(line => [line.kind, line.amount, line.paid]), [['subscription', 3_806_250, 3_806_250]]);
    assert.match(detail.json.number, /^INV-\d{6}$/);
  });

  test('usage the wallet cannot cover is owed up to the credit limit, then refused; at the limit billable usage stops', async () => {
    const { browser, resellerId, store } = await reseller(500_000);
    // US$10 at NGN 1,500 (and BitoCard's margin) is a little over NGN 15,000.
    const result = await usage(resellerId, store.id, 1_000_000);
    assert.deepEqual([result.paid, result.owed], [500_000n, 500_000n]);
    assert.equal((await browser.get('/v1/wallet')).json.available, 0);
    const credit = await browser.get('/v1/billing/credit');
    check('GET /v1/billing/credit', 200, credit.json);
    assert.equal(credit.json.owed[0].amount, 500_000);
    assert.ok(credit.json.owed[0].limit >= 1_500_000);
    await assert.rejects(usage(resellerId, store.id, credit.json.owed[0].limit), error => error.code === 'credit_limit_reached');
    await usage(resellerId, store.id, credit.json.owed[0].limit - 500_000);
    await assert.rejects(invoices.requireCredit(resellerId), error => error.code === 'credit_limit_reached');
    await ledgerOk();
  });

  test('top-ups pay what is owed first, oldest line first; Pay invoice uses earnings too', async () => {
    const { browser, resellerId, store } = await reseller();
    await usage(resellerId, store.id, 300_000, 'one');
    await usage(resellerId, null, 200_000, 'two');
    await wallets.adjust(null, { resellerId, mode: 'live', balance: 'funding', amount: 400_000, reason: 'Top-up' });
    await invoices.payFromTopUps(resellerId);
    const lines = await prisma.invoiceLine.findMany({ where: { invoice: { resellerId } }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(lines.map(line => [line.amountMinor, line.paidMinor]), [[300_000n, 300_000n], [200_000n, 100_000n]]);
    assert.equal((await browser.get('/v1/wallet')).json.available, 0);
    // The account's own invoice is paid by the reseller from earnings.
    await wallets.adjust(null, { resellerId, mode: 'live', balance: 'earnings', amount: 150_000, reason: 'Profit' });
    const account = (await browser.get('/v1/invoices')).json.data.find(item => item.store_id === null);
    const paid = await browser.post(`/v1/invoices/${account.id}/pay`, {});
    assert.equal(paid.status, 200, JSON.stringify(paid.json));
    check('POST /v1/invoices/{id}/pay', 200, paid.json);
    assert.equal(paid.json.owed, 0);
    assert.deepEqual((await browser.get('/v1/billing/credit')).json.owed, []);
    assert.equal((await browser.post(`/v1/invoices/${account.id}/pay`, {})).status, 200, 'nothing left to pay');
    await ledgerOk();
  });

  test('the job closes last month’s invoices, marks overdue ones and drops the limit a step; paid months raise it', async () => {
    const { browser, resellerId, store } = await reseller();
    // A full month: the account existed from the month's start.
    await prisma.reseller.update({ where: { id: resellerId }, data: { createdAt: new Date(Date.now() - 60 * day) } });
    await usage(resellerId, store.id, 100_000, 'owing');
    const now = new Date();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 2));
    await invoices.run(nextMonth);
    const closed = (await browser.get('/v1/invoices')).json.data[0];
    assert.equal(closed.status, 'closed');
    assert.equal(new Date(closed.due_at).getTime(), nextMonth.getTime() + 7 * day);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'invoice.closed' } }));
    // Overdue: the limit drops from US$10 to zero.
    await invoices.run(new Date(nextMonth.getTime() + 8 * day));
    assert.equal((await browser.get('/v1/invoices')).json.data[0].overdue, true);
    assert.equal((await browser.get('/v1/billing/credit')).json.limit_usd_cents, 0);

    // Paying it closes it as paid; the reseller can then raise the limit one step.
    assert.equal((await browser.post('/v1/billing/credit/raise', {})).json.error.code, 'credit_raise_unavailable');
    await wallets.adjust(null, { resellerId, mode: 'live', balance: 'funding', amount: 100_000, reason: 'Top-up' });
    await invoices.payFromTopUps(resellerId);
    assert.equal((await browser.get('/v1/invoices')).json.data[0].status, 'paid');
    const raised = await browser.post('/v1/billing/credit/raise', {});
    assert.equal(raised.status, 200, JSON.stringify(raised.json));
    check('POST /v1/billing/credit/raise', 200, raised.json);
    assert.equal(raised.json.limit_usd_cents, 1000);
    assert.equal((await browser.post('/v1/billing/credit/raise', {})).json.error.code, 'credit_raise_unavailable', 'one step per paid month');
  });

  test('a customer’s mobile money top-up bills its store’s reseller pawaPay’s deposit fee plus the plan’s usage margin', async () => {
    const { resellerId, store } = await reseller();
    const customer = await prisma.customer.create({ data: { storeId: store.id, email: `buyer${Date.now()}@example.com`, name: 'Buyer', passwordHash: 'x' } });
    const payment = { id: crypto.randomUUID(), provider: 'pawapay', mode: 'live', customerId: customer.id, resellerId, amountMinor: 1_000_000n, currency: 'NGN' };
    const payments = server.app.get((await import('../dist/payments/payments.service.js')).PaymentsService);
    // Startup's usage margin is 20%: a ₦150 fee is billed ₦180, owed while the wallet is empty, on the store's invoice.
    await payments.billDepositFee(payment, 15_000n);
    await payments.billDepositFee(payment, 15_000n);
    const lines = await prisma.invoiceLine.findMany({ where: { invoice: { resellerId, storeId: store.id } } });
    assert.deepEqual(lines.map(line => [line.kind, line.amountMinor, line.paidMinor]), [['usage', 18_000n, 0n]], 'once per payment');
    // Other gateways and the sandbox are not billed.
    await payments.billDepositFee({ ...payment, id: crypto.randomUUID(), provider: 'stripe' }, 15_000n);
    await payments.billDepositFee({ ...payment, id: crypto.randomUUID(), mode: 'test' }, 15_000n);
    assert.equal(await prisma.invoiceLine.count({ where: { invoice: { resellerId } } }), 1);
    await ledgerOk();
  });

  test('fee rules follow the store’s plan', async () => {
    const { resellerId, store } = await reseller();
    const fees = server.app.get((await import('../dist/fees/platform-fees.service.js')).PlatformFeesService);
    await prisma.feeRule.createMany({
      data: [
        { kind: 'gateway_payment', scopeKey: `gateway_payment:*:*:premium:${Date.now()}`, planCode: 'premium', ratePpb: 10_000_000 },
        { kind: 'gateway_payment', scopeKey: `gateway_payment:*:*:standard:${Date.now()}`, planCode: 'standard', ratePpb: 30_000_000 },
      ],
    });
    const rate = async () => (await fees.quote({ resellerId, storeId: store.id, kind: 'gateway_payment', baseMinor: 100_000n })).ratePpb;
    assert.equal(await rate(), 30_000_000, 'a store without a plan of its own is on Startup');
    await prisma.storeSubscription.create({ data: { storeId: store.id, resellerId, planCode: 'premium' } });
    assert.equal(await rate(), 10_000_000);
    await prisma.feeRule.deleteMany({ where: { kind: 'gateway_payment', countryCode: null, category: null } });
  });

  test('an invoice with nothing owed closes as paid; admins set the limit up to US$100', async () => {
    const { resellerId, store } = await reseller(1_000_000);
    await usage(resellerId, store.id, 100_000);
    const now = new Date();
    await invoices.run(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 2)));
    assert.equal((await prisma.invoice.findFirstOrThrow({ where: { resellerId } })).status, 'paid');
    const finance = await adminClient(server, ['finance']);
    const set = await finance.put(`/v1/admin/resellers/${resellerId}/credit-limit`, { cents: 7500, reason: 'Trusted partner' });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal(set.json.limit_usd_cents, 7500);
    assert.equal((await finance.put(`/v1/admin/resellers/${resellerId}/credit-limit`, { cents: 20000, reason: 'Too much' })).status, 400);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'reseller.credit_limit_set', targetId: resellerId } }));
    assert.equal((await finance.get(`/v1/admin/resellers/${resellerId}/invoices`)).json.data.length, 1);
  });
});
