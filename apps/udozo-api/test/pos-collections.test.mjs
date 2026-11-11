// Udozo POS milestone 4 (docs/UDOZO_POS_PLAN.md): Udozo collection accounts and next-day settlement. An owner on a paid
// plan, with a settlement account chosen, asks for a bank account number per till (the sandbox gateway in test mode).
// A transfer into it is credited once to the owner's `pos_collected`, less Udozo's fee, and pays the sale waiting at the
// till for exactly its amount; any other transfer waits as unmatched, for the owner to attach or keep. Each working day
// the `pos` job settles what came in before the day began, to the owner's withdrawable balance and on to their bank.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let payments;
let collections;
let admin;
let rules;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', CHECKOUT_SANDBOX: 'on' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  payments = server.app.get((await import('../dist/payments/payments.service.js')).PaymentsService);
  collections = server.app.get((await import('../dist/pos/collections.service.js')).PosCollectionsService);
  rules = await import('../dist/pos/collection-rules.js');
  admin = await adminClient(server);
  for (const key of ['classifieds', 'pos', 'pos_collections']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
  await prisma.posPlan.update({ where: { code: 'free' }, data: { limits: { products: 10, shops: 1, tills: 2, staff: 3 } } });
  // Udozo's margin in Nigeria: 1% of each transfer, at least ₦50, at most ₦500.
  await prisma.posMarketSettings.upsert({ where: { country: 'NG' }, create: { country: 'NG', collectionFeeBps: 100, collectionFeeMinMinor: 5_000n, collectionFeeCapMinor: 50_000n }, update: { collectionFeeBps: 100, collectionFeeMinMinor: 5_000n, collectionFeeCapMinor: 50_000n } });
});

after(() => server?.close());

function client() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'idempotency-key': `collections-${randomUUID()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), put: (path, body = {}) => request('PUT', path, body) };
}

let counter = 0;
/** An owner signed up for Udozo POS (Premium unless `plan` says), with a payout bank account and, unless `settle` is false, it chosen for collections. */
async function owner({ plan = 'premium', settle = true } = {}) {
  const who = client();
  const email = `collect${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await who.post('/v1/store/account/signup', { name: 'Ada Okafor', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, who);
  assert.equal((await who.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  who.id = signup.json.customer.id;
  await prisma.customer.update({ where: { id: who.id }, data: { phoneVerifiedAt: new Date() } });
  await who.post('/v1/classifieds/terms/accept', { version: (await who.get('/v1/classifieds/terms')).json.version });
  assert.equal((await who.post('/v1/pos/owner/signup', { plan: 'free', shop: { name: "Ada's Gadget Hub", vat_bps: 0 } })).status, 201);
  const account = await prisma.posAccount.update({ where: { customerId: who.id }, data: { planCode: plan } });
  who.account = account;
  who.till = (await who.get('/v1/pos/owner')).json.account.shops[0].tills[0];
  const bank = await who.post('/v1/store/cash/bank-accounts', { bank_code: 'SBX001', account_number: '0123456789' });
  assert.equal(bank.status, 201, JSON.stringify(bank.json));
  who.bank = bank.json;
  if (settle) assert.equal((await who.put('/v1/pos/owner/collections/settlement-account', { bank_account_id: bank.json.id })).status, 200);
  return who;
}

async function product(who, title, { price = 500_000, stock = 5 } = {}) {
  const category = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
  const made = await who.post('/v1/classifieds/listings', { title, price, category_id: category.id, stock, pos_enabled: true, on_shop: false });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const submitted = await who.post(`/v1/classifieds/listings/${made.json.id}/submit`);
  assert.equal(submitted.json.status, 'active', JSON.stringify(submitted.json));
  return submitted.json;
}

async function opened(who) {
  const res = await who.post(`/v1/pos/owner/tills/${who.till.id}/collection-account`, {});
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json;
}

const balance = async (customerId, kind) => Number((await prisma.ledgerAccount.findFirst({ where: { kind, customerId, currency: 'NGN' }, select: { balanceMinor: true } }))?.balanceMinor ?? 0n);

const askTransfer = (who, tv, extra = {}) =>
  who.post('/v1/pos/owner/transfer-requests', {
    till_id: who.till.id,
    client_sale_id: randomUUID(),
    lines: [{ listing_id: tv.id, quantity: 2 }],
    payments: [{ method: 'cash', amount: 200_000, tendered: 200_000 }],
    transfer_amount: 800_000,
    expected_total: 1_000_000,
    ...extra,
  });

const transfer = (account, amount, extra = {}) => {
  const id = extra.id ?? randomUUID();
  return payments.recordDeposit(extra.provider ?? 'sandbox', { status: 'succeeded', providerTransactionId: id, reference: account.reference, amount: BigInt(amount), currency: 'NGN', fee: BigInt(extra.fee ?? 0), payerName: extra.payer ?? 'BOLA ADE' }).then(result => ({ id, result }));
};

describe('the rules', () => {
  test('Udozo’s fee is the gateway’s plus the market’s margin, held between its minimum and cap, never above the transfer', () => {
    const settings = { collectionFeeBps: 100, collectionFeeMinMinor: 5_000n, collectionFeeCapMinor: 50_000n };
    assert.deepEqual(rules.collectionFee(800_000n, 0n, settings), { gateway: 0n, fee: 8_000n, collected: 792_000n });
    assert.deepEqual(rules.collectionFee(100_000n, 0n, settings), { gateway: 0n, fee: 5_000n, collected: 95_000n }, 'the minimum');
    assert.deepEqual(rules.collectionFee(10_000_000n, 2_000n, settings), { gateway: 2_000n, fee: 52_000n, collected: 9_948_000n }, 'the cap, on top of the gateway');
    assert.deepEqual(rules.collectionFee(3_000n, 0n, settings), { gateway: 0n, fee: 3_000n, collected: 0n }, 'never more than the transfer');
    assert.deepEqual(rules.collectionFee(800_001n, 0n, settings).fee, 8_001n, 'rounded up');
    assert.deepEqual(rules.collectionFee(500_000n, 1_000n, null), { gateway: 1_000n, fee: 1_000n, collected: 499_000n }, 'no margin set: the gateway’s alone');
  });

  test('the market’s own day, its start, and working days', async () => {
    assert.equal(rules.zonedDay(new Date('2027-03-16T23:30:00Z'), 'Africa/Lagos'), '2027-03-17', 'Lagos is an hour ahead');
    assert.equal(rules.zonedDayStart('2027-03-17', 'Africa/Lagos').toISOString(), '2027-03-16T23:00:00.000Z');
    assert.equal(rules.zonedDayStart('2027-03-17', 'Africa/Nairobi').toISOString(), '2027-03-16T21:00:00.000Z');
    assert.equal(rules.isWorkingDay('2027-03-17'), true);
    assert.equal(rules.isWorkingDay('2027-03-20'), false, 'Saturday');
    assert.equal(rules.nextWorkingDay('2027-03-19'), '2027-03-22', 'Friday to Monday');
    assert.equal(rules.collectionReference('test', 'a1b2c3d4-0000-4000-8000-000000000001'), 'bc_rp_test_a1b2c3d4000040008000000000000001');
    const { reservedReference } = await import('../dist/payments/flutterwave.provider.js');
    assert.ok(reservedReference.test('bc_rp_live_a1b2c3d4000040008000000000000001'), 'the payments job sweeps collection accounts too');
  });
});

describe('collection accounts', () => {
  test('need the switch, a paid plan and a settlement account', async () => {
    const free = await owner({ plan: 'free' });
    const refused = await free.post(`/v1/pos/owner/tills/${free.till.id}/collection-account`, {});
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'plan_feature_required']);
    assert.equal((await free.get('/v1/pos/owner/collections')).json.blocked, 'plan');

    const unset = await owner({ settle: false });
    const noAccount = await unset.post(`/v1/pos/owner/tills/${unset.till.id}/collection-account`, {});
    assert.deepEqual([noAccount.status, noAccount.json.error.code], [409, 'settlement_account_required']);
    const someoneElses = await unset.put('/v1/pos/owner/collections/settlement-account', { bank_account_id: free.bank.id });
    assert.equal(someoneElses.status, 404, 'only their own payout account');

    await admin.put('/v1/admin/switches/pos_collections', { country_code: 'NG', enabled: false });
    const closed = await unset.post(`/v1/pos/owner/tills/${unset.till.id}/collection-account`, {});
    assert.deepEqual([closed.status, closed.json.error.code], [409, 'pos_collections_unavailable']);
    assert.equal((await unset.get('/v1/pos/owner/collections')).json.blocked, 'unavailable');
    await admin.put('/v1/admin/switches/pos_collections', { country_code: 'NG', enabled: true });
  });

  test('open one per till under our reference, and asking again gives the same account', async () => {
    const who = await owner();
    const first = await opened(who);
    assert.equal(first.status, 'active');
    assert.equal(first.bank_name, 'Sandbox Bank');
    assert.match(first.account_number, /^99\d{8}$/);
    const again = await opened(who);
    assert.equal(again.id, first.id);
    const row = await prisma.posCollectionAccount.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(row.reference, rules.collectionReference(row.mode, row.id));
    const overview = (await who.get('/v1/pos/owner/collections')).json;
    assert.equal(overview.blocked, null);
    assert.equal(overview.tills[0].collection_account.account_number, first.account_number);
    assert.equal(overview.settlement_bank_account_id, who.bank.id);
  });

  test('a transfer for the waiting amount pays the sale at the till: credited once, less Udozo’s fee, with the payer named', async () => {
    const who = await owner();
    const account = await opened(who);
    const tv = await product(who, 'Hisense 32 inch TV');
    const asked = await askTransfer(who, tv);
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.match(asked.json.number, /^PT-\d{6}$/);
    assert.deepEqual([asked.json.status, asked.json.amount, asked.json.pay_to.account_number], ['waiting', 800_000, account.account_number]);
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: tv.id } })).stock, 5, 'nothing taken by asking');

    const row = await prisma.posCollectionAccount.findUniqueOrThrow({ where: { id: account.id } });
    const sent = await transfer(row, 800_000);
    assert.deepEqual(sent.result, { credited: true });
    // The gateway notifies twice: credited once.
    assert.deepEqual((await transfer(row, 800_000, { id: sent.id })).result, { credited: false, reason: 'duplicate' });

    const status = (await who.get(`/v1/pos/owner/transfer-requests/${asked.json.id}`)).json;
    assert.equal(status.status, 'paid');
    const sale = (await who.get(`/v1/pos/owner/sales/${status.sale_id}`)).json;
    assert.deepEqual(sale.payments.map(payment => [payment.method, payment.amount]), [['cash', 200_000], ['udozo_transfer', 800_000]]);
    assert.equal(sale.payments[1].reference, `${asked.json.number} · BOLA ADE`);
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: tv.id } })).stock, 3);
    assert.equal(await balance(who.id, 'pos_collected'), 792_000, '₦8,000 (1%) is Udozo’s');
    const collection = await prisma.posCollection.findFirstOrThrow({ where: { accountId: who.account.id } });
    assert.deepEqual([collection.status, collection.saleId, Number(collection.feeMinor), collection.payerName], ['matched', sale.id, 8_000, 'BOLA ADE']);
  });

  test('sandbox money never reaches a live account, nor a gateway’s a sandbox one; another reference is not ours', async () => {
    const who = await owner();
    const row = await prisma.posCollectionAccount.findUniqueOrThrow({ where: { id: (await opened(who)).id } });
    assert.deepEqual((await transfer(row, 100_000, { provider: 'flutterwave' })).result, { credited: false, reason: 'wrong_mode' });
    assert.equal(await collections.deposit('sandbox', { status: 'succeeded', providerTransactionId: randomUUID(), reference: 'bc_rp_test_nothere', amount: 100n, currency: 'NGN', fee: 0n }), null);
    assert.equal(await collections.deposit('sandbox', { status: 'succeeded', providerTransactionId: randomUUID(), reference: row.reference, amount: 100n, currency: 'GHS', fee: 0n }), null, 'another currency is never credited here');
    assert.equal(await balance(who.id, 'pos_collected'), 0);
  });

  test('any other transfer waits unmatched: the owner is told, then attaches it to the sale it was for, or keeps it', async () => {
    const who = await owner();
    const account = await opened(who);
    const row = await prisma.posCollectionAccount.findUniqueOrThrow({ where: { id: account.id } });
    const tv = await product(who, 'Samsung 43 inch TV');
    const asked = await askTransfer(who, tv);

    // The wrong amount: the sale keeps waiting.
    await transfer(row, 500_000, { payer: 'CHIDI EZE' });
    assert.equal((await who.get(`/v1/pos/owner/transfer-requests/${asked.json.id}`)).json.status, 'waiting');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'customer.pos.collection', customerId: who.id } }), 'the owner is told');
    const listed = (await who.get('/v1/pos/owner/collections/transfers?status=unmatched')).json;
    assert.equal(listed.data.length, 1);
    assert.deepEqual([listed.data[0].amount, listed.data[0].payer_name, listed.data[0].attachable], [500_000, 'CHIDI EZE', []]);
    const kept = await who.post(`/v1/pos/owner/collections/transfers/${listed.data[0].id}/keep`, { note: 'A deposit for an order' });
    assert.deepEqual([kept.status, kept.json.status, kept.json.note, kept.json.decided_by], [200, 'kept', 'A deposit for an order', 'Ada Okafor']);
    assert.equal((await who.post(`/v1/pos/owner/collections/transfers/${listed.data[0].id}/keep`, {})).json.error.code, 'collection_decided');

    // The right amount after the till gave up waiting: attached, the sale is made.
    await prisma.posTransferRequest.update({ where: { id: asked.json.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await who.get(`/v1/pos/owner/transfer-requests/${asked.json.id}`)).json.status, 'expired');
    await transfer(row, 800_000);
    const late = (await who.get('/v1/pos/owner/collections/transfers?status=unmatched')).json.data[0];
    assert.deepEqual(late.attachable.map(item => [item.id, item.status]), [[asked.json.id, 'expired']]);
    const attached = await who.post(`/v1/pos/owner/collections/transfers/${late.id}/attach`, { transfer_request_id: asked.json.id });
    assert.equal(attached.status, 200, JSON.stringify(attached.json));
    assert.equal(attached.json.status, 'matched');
    assert.ok(attached.json.sale.number.startsWith('POS-'));
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: tv.id } })).stock, 3);
  });

  test('a basket that changed before the money came fails the sale, never the money', async () => {
    const who = await owner();
    const row = await prisma.posCollectionAccount.findUniqueOrThrow({ where: { id: (await opened(who)).id } });
    const tv = await product(who, 'LG 55 inch TV');
    const asked = await askTransfer(who, tv);
    await prisma.classifiedListing.update({ where: { id: tv.id }, data: { stock: 1 } });
    assert.deepEqual((await transfer(row, 800_000)).result, { credited: true });
    const request = (await who.get(`/v1/pos/owner/transfer-requests/${asked.json.id}`)).json;
    assert.equal(request.status, 'failed');
    assert.match(request.failure, /Only 1/);
    assert.equal((await prisma.posCollection.findFirstOrThrow({ where: { accountId: who.account.id } })).status, 'unmatched');
    assert.equal(await balance(who.id, 'pos_collected'), 792_000);
  });

  test('a closed account takes no new sales, but a transfer still arriving is credited', async () => {
    const who = await owner();
    const account = await opened(who);
    const closed = await who.post(`/v1/pos/owner/collection-accounts/${account.id}/close`);
    assert.equal(closed.json.status, 'closed');
    const tv = await product(who, 'TCL 40 inch TV');
    assert.equal((await askTransfer(who, tv)).json.error.code, 'collection_account_missing');
    const row = await prisma.posCollectionAccount.findUniqueOrThrow({ where: { id: account.id } });
    assert.deepEqual((await transfer(row, 100_000)).result, { credited: true });
    assert.equal(await balance(who.id, 'pos_collected'), 95_000);
    // A new account can be opened for the till.
    assert.notEqual((await opened(who)).id, account.id);
  });

  test('the sandbox’s Send a test transfer is credited as a real one', async () => {
    const who = await owner();
    const account = await opened(who);
    const simulated = await who.post(`/v1/pos/owner/collection-accounts/${account.id}/simulate`, { amount: 250_000, payer_name: 'TEST PAYER' });
    assert.equal(simulated.status, 200, JSON.stringify(simulated.json));
    assert.deepEqual([simulated.json.amount, simulated.json.fee, simulated.json.collected, simulated.json.payer_name], [250_000, 5_000, 245_000, 'TEST PAYER']);
  });
});

describe('next-day settlement', () => {
  test('each working day settles what came in before the day began, once, to the owner’s bank', async () => {
    const who = await owner();
    const row = await prisma.posCollectionAccount.findUniqueOrThrow({ where: { id: (await opened(who)).id } });
    await transfer(row, 2_000_000);
    await transfer(row, 100_000);
    // A Saturday settles nothing; the Wednesday after settles both.
    await collections.run(new Date('2099-03-21T10:00:00Z'));
    assert.equal(await prisma.posSettlement.count({ where: { accountId: who.account.id } }), 0);
    const wednesday = new Date('2099-03-25T10:00:00Z');
    await collections.run(wednesday);
    await collections.run(wednesday);
    const settlements = (await who.get('/v1/pos/owner/collections/settlements')).json.data;
    assert.equal(settlements.length, 1, 'once');
    assert.equal(settlements[0].kept_reason, null);
    assert.deepEqual([settlements[0].day, settlements[0].collections, settlements[0].gross, settlements[0].fees, settlements[0].amount, settlements[0].status], ['2099-03-25', 2, 2_100_000, 25_000, 2_075_000, 'paying']);
    assert.match(settlements[0].number, /^PS-\d{6}$/);
    assert.equal(settlements[0].payout.status, 'processing');
    assert.equal(await balance(who.id, 'pos_collected'), 0);
    assert.equal(await balance(who.id, 'customer_payouts_pending'), 2_075_000, 'on its way to the bank');
    const statement = (await who.get(`/v1/pos/owner/collections/settlements/${settlements[0].id}`)).json;
    assert.equal(statement.items.length, 2);
    assert.ok(statement.items.every(item => item.settlement.id === settlements[0].id));
  });

  test('a hold stops settlement until released, and no bank account leaves it in the owner’s Udozo payouts', async () => {
    const held = await owner();
    const row = await prisma.posCollectionAccount.findUniqueOrThrow({ where: { id: (await opened(held)).id } });
    await transfer(row, 800_000);
    const hold = await admin.post(`/v1/admin/pos/accounts/${held.account.id}/settlements/hold`, { reason: 'Checking a dispute' });
    assert.equal(hold.status, 200, JSON.stringify(hold.json));
    assert.equal(hold.json.held.reason, 'Checking a dispute');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'pos.settlements_held', targetId: held.account.id } }));
    await collections.run(new Date('2099-04-01T10:00:00Z'));
    assert.equal(await prisma.posSettlement.count({ where: { accountId: held.account.id } }), 0);
    const released = await admin.post(`/v1/admin/pos/accounts/${held.account.id}/settlements/release`, { reason: 'Dispute closed' });
    assert.equal(released.status, 200, JSON.stringify(released.json));
    assert.equal(released.json.held, null);
    await collections.run(new Date('2099-04-02T10:00:00Z'));
    assert.equal(await prisma.posSettlement.count({ where: { accountId: held.account.id } }), 1);

    const unset = await owner();
    const theirs = await prisma.posCollectionAccount.findUniqueOrThrow({ where: { id: (await opened(unset)).id } });
    await transfer(theirs, 800_000);
    await unset.put('/v1/pos/owner/collections/settlement-account', { bank_account_id: null });
    await collections.run(new Date('2099-04-03T10:00:00Z'));
    const kept = (await unset.get('/v1/pos/owner/collections/settlements')).json.data[0];
    assert.deepEqual([kept.status, kept.kept_reason, kept.payout], ['kept', 'No bank account is chosen for your collections.', null]);
    assert.equal(await balance(unset.id, 'customer_withdrawable'), 792_000, 'theirs to pay out from udozo.com');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'customer.pos.settlement', customerId: unset.id } }));
  });
});

describe('Udozo’s admins', () => {
  test('see every transfer and an account’s collections, and finance sets the fee per market', async () => {
    const list = await admin.get('/v1/admin/pos/collections');
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.ok(list.json.data.length > 0);
    assert.ok(list.json.data[0].account.id);
    const one = await admin.get(`/v1/admin/pos/accounts/${list.json.data[0].account.id}/collections`);
    assert.equal(one.status, 200);
    assert.ok(one.json.accounts.length > 0);

    const set = await admin.put('/v1/admin/pos/market-settings/NG', { collection_fee_bps: 150, collection_fee_min: 0, collection_fee_cap: null });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual(set.json.data.find(row => row.country === 'NG'), { country: 'NG', name: 'Nigeria', currency: 'NGN', collection_fee_bps: 150, collection_fee_min: 0, collection_fee_cap: null });
    const bad = await admin.put('/v1/admin/pos/market-settings/NG', { collection_fee_bps: 150, collection_fee_min: 10_000, collection_fee_cap: 5_000 });
    assert.equal(bad.status, 400);
  });
});
