// Udozo POS, milestone 1 (docs/UDOZO_POS_PLAN.md): the money rules (the design's sample sale totals ₦38,700), the public
// plans, a udozo.com customer signing up as a shop owner (Free, or a paid plan with its trial), changing plan (a dearer one
// charged at once less what is unused, a cheaper one at the month's end), tills within the plan's limit, the `pos` job's
// renewals from the wallet with 7 days' grace then Free, finance setting prices (step-up), and pos.udozo.com as a handoff
// target. Behind the `pos` switch per market.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { addMonth, saleTotals, shareOf, unusedCredit } from '../dist/pos/money.js';
import { shopCodeFor } from '../dist/pos/plans.js';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let ledger;
let admin;
let billing;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', ENCRYPTION_KEY: randomBytes(32).toString('base64'), POS_URL: 'https://pos.udozo.test' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
  billing = server.app.get((await import('../dist/pos/billing.service.js')).PosBillingService);
  admin = await adminClient(server);
});

after(async () => server?.close());

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `pos-${randomUUID()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body), del: path => request('DELETE', path) };
}

let counter = 0;
async function owner() {
  const shopper = storeServer();
  const email = `pos${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Okafor', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function fund(person, amount) {
  await ledger.post({
    mode: 'live',
    type: 'adjustment',
    reference: `test-fund:${randomUUID()}`,
    description: 'Test top-up',
    lines: [
      { account: { kind: 'adjustments', currency: 'NGN' }, debit: BigInt(amount) },
      { account: { kind: 'customer_wallet', currency: 'NGN', customerId: person.id }, credit: BigInt(amount) },
    ],
  });
}

const wallet = async customerId => (await prisma.ledgerAccount.findFirst({ where: { kind: 'customer_wallet', mode: 'live', currency: 'NGN', customerId } }))?.balanceMinor ?? 0n;
const shop = { name: "Ada's Gadget Hub", address: '12 Allen Avenue, Ikeja', phone: '0803 123 4567', vat_bps: 750 };

describe('Udozo POS money', () => {
  test("the design's sample sale: ₦36,000 of goods, VAT 7.5% added, ₦38,700", () => {
    const totals = saleTotals([{ unit: 1_850_000n, quantity: 1 }, { unit: 750_000n, quantity: 2 }, { unit: 250_000n, quantity: 1 }], { vatBps: 750 });
    assert.deepEqual(totals, { items: 4, subtotal: 3_600_000n, discount: 0n, taxable: 3_600_000n, vat: 270_000n, total: 3_870_000n });
  });

  test('discounts never go below zero; shares round half up; months and credit', () => {
    assert.equal(saleTotals([{ unit: 1000n, quantity: 1, discount: 5000n }], { discount: 10n }).total, 0n);
    assert.equal(shareOf(1n, 5000), 1n);
    assert.equal(addMonth(new Date('2027-01-31T10:00:00Z')).toISOString(), '2027-02-28T10:00:00.000Z');
    assert.equal(unusedCredit(3000n, new Date('2027-01-01Z'), new Date('2027-01-31Z'), new Date('2027-01-21Z')), 1000n);
    assert.match(shopCodeFor("Ada's Gadget Hub"), /^ADA-\d{4}$/);
    assert.match(shopCodeFor('Jo'), /^JOX-\d{4}$/);
  });
});

describe('Udozo POS accounts', () => {
  test('closed until the market switch is on; the public plans show without prices until finance sets them', async () => {
    const plans = await fetch(`${server.base}/v1/pos/plans?country=NG`).then(res => res.json());
    assert.equal(plans.open, false);
    assert.deepEqual(plans.data.map(plan => [plan.code, plan.available]), [['free', true], ['premium', false], ['multi_shop', false]]);
    const person = await owner();
    const refused = await person.post('/v1/pos/owner/signup', { plan: 'free', shop });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error.code, 'pos_unavailable');
  });

  test('finance sets prices after step-up; Free signs up at once with a shop code and a till', async () => {
    assert.equal((await admin.put('/v1/admin/switches/pos', { country_code: 'NG', enabled: true })).status, 200);
    const set = await admin.patch('/v1/admin/pos/plans/premium', { prices: { NGN: 1_500_000 } });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal((await admin.patch('/v1/admin/pos/plans/multi_shop', { prices: { NGN: 4_500_000 }, trial_days: 0 })).status, 200);
    assert.equal((await admin.patch('/v1/admin/pos/plans/free', { prices: { NGN: 100 } })).status, 400);
    const person = await owner();
    const made = await person.post('/v1/pos/owner/signup', { plan: 'free', shop });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal(made.json.status, 'free');
    assert.match(made.json.shops[0].shop_code, /^ADA-\d{4}$/);
    assert.equal(made.json.shops[0].tills[0].name, 'Till 1');
    assert.equal((await person.post('/v1/pos/owner/signup', { plan: 'free', shop })).json.error.code, 'pos_account_exists');
    // Free allows 2 tills.
    assert.equal((await person.post(`/v1/pos/owner/shops/${made.json.shops[0].id}/tills`, {})).status, 201);
    const third = await person.post(`/v1/pos/owner/shops/${made.json.shops[0].id}/tills`, {});
    assert.equal(third.status, 409);
    assert.equal(third.json.error.code, 'pos_limit_reached');
  });

  test('Premium starts with its trial (nothing charged), and the job charges the wallet when it ends', async () => {
    const person = await owner();
    const made = await person.post('/v1/pos/owner/signup', { plan: 'premium', shop, expected_amount: 0 });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal(made.json.status, 'trial');
    await fund(person, 2_000_000);
    await prisma.posAccount.update({ where: { id: made.json.id }, data: { periodEnd: new Date(Date.now() - 1000), trialEndsAt: new Date(Date.now() - 1000) } });
    const run = await billing.run();
    assert.ok(run.renewed >= 1, JSON.stringify(run));
    assert.equal(await wallet(person.id), 500_000n);
    const me = await person.get('/v1/pos/owner');
    assert.equal(me.json.account.status, 'active');
    assert.equal((await person.get('/v1/pos/owner/charges')).json.data[0].amount, 1_500_000);
    // Running again charges nothing more.
    await billing.run();
    assert.equal(await wallet(person.id), 500_000n);
  });

  test('a dearer plan is charged at once less the unused part; a cheaper one waits for the month end', async () => {
    const person = await owner();
    await fund(person, 4_500_000);
    const made = await person.post('/v1/pos/owner/signup', { plan: 'multi_shop', shop, expected_amount: 4_500_000 });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal(await wallet(person.id), 0n);
    const down = await person.post('/v1/pos/owner/plan', { plan: 'premium' });
    assert.equal(down.status, 200);
    assert.equal(down.json.plan.code, 'multi_shop');
    assert.equal(down.json.next_plan, 'premium');
    const cancel = await person.post('/v1/pos/owner/plan', { plan: 'free' });
    assert.equal(cancel.json.status, 'cancelling');
    assert.equal((await person.post('/v1/pos/owner/plan', { plan: 'multi_shop' })).json.next_plan, null);
  });

  test('a renewal the wallet cannot pay keeps the plan 7 days, then Free', async () => {
    const person = await owner();
    await fund(person, 1_500_000);
    const made = await person.post('/v1/pos/owner/signup', { plan: 'premium', shop });
    await prisma.posAccount.update({ where: { id: made.json.id }, data: { trialEndsAt: null, periodEnd: new Date(Date.now() - 1000) } });
    // Spend the wallet so the renewal fails.
    await ledger.post({
      mode: 'live',
      type: 'adjustment',
      reference: `test-spend:${randomUUID()}`,
      description: 'Test spend',
      lines: [
        { account: { kind: 'customer_wallet', currency: 'NGN', customerId: person.id }, debit: 1_500_000n },
        { account: { kind: 'adjustments', currency: 'NGN' }, credit: 1_500_000n },
      ],
    });
    await billing.run();
    let row = await prisma.posAccount.findUnique({ where: { id: made.json.id } });
    assert.equal(row.planCode, 'premium');
    assert.ok(row.pastDueSince);
    await prisma.posAccount.update({ where: { id: row.id }, data: { pastDueSince: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } });
    await billing.run();
    row = await prisma.posAccount.findUnique({ where: { id: made.json.id } });
    assert.equal(row.planCode, 'free');
    assert.equal(row.lapsedPlanCode, 'premium');
  });

  test('pos.udozo.com is a handoff target, and the app buttons take only store addresses', async () => {
    const handoff = server.app.get((await import('../dist/customers/handoff.service.js')).HandoffService);
    assert.equal(await handoff.target('https://pos.udozo.test'), 'https://pos.udozo.test');
    assert.equal((await admin.put('/v1/admin/pos/apps/windows', { url: 'https://pos.udozo.com/setup.exe' })).status, 400);
    assert.equal((await admin.put('/v1/admin/pos/apps/windows', { url: 'https://apps.microsoft.com/detail/9NBLGGH4NNS1' })).status, 200);
    const apps = await fetch(`${server.base}/v1/pos/apps`).then(res => res.json());
    assert.equal(apps.windows, 'https://apps.microsoft.com/detail/9NBLGGH4NNS1');
    assert.equal(apps.android, null);
  });
});
