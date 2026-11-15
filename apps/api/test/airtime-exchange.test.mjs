// The airtime exchange (docs/BITOCARD_AIRTIME_EXCHANGE_PLAN.md): BitoCard buys customers' unused airtime into a pool
// per network (sent to its collector lines, several per network, each within its own daily limit), credits sellers
// once the hold has passed, sells from the pool at a discount (the price locked from the buyer's wallet until staff
// send it, or refunded within the hour), and shows the pool to everyone.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, lastSmsCode, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;
let ledger;

before(async () => {
  server = await startApp({ env: { CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
  admin = await adminClient(server);
});

after(async () => {
  await server?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `store-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

let counter = 0;
async function customer({ phone } = {}) {
  const shopper = storeServer();
  const email = `airtime${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Obi', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  if (phone) await confirmPhone(shopper, phone);
  return shopper;
}

/** Confirms a number on the customer's account the way the profile does (a texted code). */
async function confirmPhone(shopper, phone) {
  assert.equal((await shopper.post('/v1/store/account/phones', { phone })).status, 202);
  const verified = await shopper.post('/v1/store/account/phones/verify', { code: await lastSmsCode(server.app, phone) });
  assert.equal(verified.status, 200, JSON.stringify(verified.json));
  return verified.json;
}

/** Money in a customer's naira wallet (as if topped up). */
const fund = (shopper, amount) =>
  ledger.post({
    mode: 'live',
    type: 'adjustment',
    reference: `test-fund:${shopper.id}:${Math.random()}`,
    description: 'Test funds',
    lines: [
      { account: { kind: 'adjustments', currency: 'NGN' }, debit: BigInt(amount) },
      { account: { kind: 'customer_wallet', currency: 'NGN', customerId: shopper.id }, credit: BigInt(amount) },
    ],
  });

const naira = async shopper => (await shopper.get('/v1/store/wallet')).json.wallets.find(item => item.currency === 'NGN').balance;
const pool = async () => (await fetch(`${server.base}/v1/store/airtime/pool?country=NG`)).json();
const mtn = async () => (await pool()).networks.find(item => item.network === 'mtn');
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
const runJob = () => fetch(`${server.base}/v1/cron/airtime`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json()).then(body => body.result);

let lines;

describe('the airtime exchange', () => {
  test('closed by default: the pool shows every network and its rates, nothing can be traded', async () => {
    const shown = await pool();
    assert.equal(shown.open, false);
    assert.deepEqual(
      shown.networks.map(item => [item.network, item.open, item.sell_rate_bps, item.buy_rate_bps, item.available]),
      [
        ['mtn', false, 8000, 8800, 0],
        ['airtel', false, 8000, 8800, 0],
        ['glo', false, 8000, 8800, 0],
        ['9mobile', false, 8000, 8800, 0],
      ],
    );
    assert.equal(JSON.stringify(shown).includes('collector'), false, 'collector lines are never public');
    const seller = await customer({ phone: '+2348031110001' });
    const refused = await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 100_000 });
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'airtime_unavailable']);
  });

  test('selling: own confirmed number, a line with room today, then received into the pool and credited after the hold', async () => {
    assert.equal((await admin.put('/v1/admin/switches/airtime_exchange', { country_code: 'NG', enabled: true })).status, 200);
    const seller = await customer();
    const noLine = await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 200_000 });
    assert.equal(noLine.json.error.code, 'phone_required', 'the airtime must come from their own confirmed number');
    // A number saved but never confirmed does not count.
    await prisma.customer.update({ where: { id: seller.id }, data: { phone: '+2348031110002' } });
    assert.equal((await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 200_000 })).json.error.code, 'phone_required');
    await confirmPhone(seller, '+2348031110002');
    assert.equal((await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 200_000 })).json.error.code, 'airtime_busy', 'no collector line yet');

    // Two MTN lines, ₦3,000 a day each.
    lines = [];
    for (const number of ['08039990001', '08039990002']) {
      const added = await admin.post('/v1/admin/airtime/lines', { country: 'NG', network: 'mtn', number, daily_receive: 300_000 });
      assert.equal(added.status, 201, JSON.stringify(added.json));
      lines.push(added.json);
    }
    assert.equal((await admin.post('/v1/admin/airtime/lines', { country: 'NG', network: 'mtn', number: '+2348039990001' })).json.error.code, 'line_exists');
    assert.equal((await mtn()).open, true);

    const preview = await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 200_000, preview: true });
    assert.deepEqual([preview.json.payout, preview.json.from_phone], [160_000, '+2348031110002'], 'sellers get 80%, from their default number');
    assert.equal((await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 200_000, from_phone: '08031110099', preview: true })).json.error.code, 'phone_not_verified');
    assert.equal((await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 250_050 })).json.error.code, 'amount_invalid');

    const first = await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 200_000 });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.equal(first.json.status, 'awaiting_transfer');
    assert.match(first.json.number, /^AS-\d{6}$/);
    assert.ok(first.json.transfer_steps.includes('*600*0803999000') && first.json.transfer_steps.includes('*2000*'), first.json.transfer_steps);

    // Another seller is given the other line (the first has only ₦1,000 of room left), then nothing has room.
    const other = await customer({ phone: '+2348031110003' });
    const second = await other.post('/v1/store/airtime/sales', { network: 'mtn', amount: 200_000 });
    assert.equal(second.status, 201);
    assert.notEqual(second.json.collector_number, first.json.collector_number, 'spread over the lines');
    assert.equal((await other.post('/v1/store/airtime/sales', { network: 'mtn', amount: 200_000 })).json.error.code, 'airtime_busy');
    assert.equal((await other.post(`/v1/store/airtime/sales/${second.json.id}/cancel`)).json.status, 'cancelled');

    assert.equal((await seller.post(`/v1/store/airtime/sales/${first.json.id}/sent`)).json.status, 'sent');
    assert.equal((await seller.post(`/v1/store/airtime/sales/${first.json.id}/cancel`)).json.error.code, 'sale_not_cancellable');
    const received = await admin.post(`/v1/admin/airtime/sales/${first.json.id}/received`, {});
    assert.equal(received.status, 200, JSON.stringify(received.json));
    assert.equal(received.json.status, 'received');
    assert.equal((await admin.post(`/v1/admin/airtime/sales/${first.json.id}/received`, {})).json.error.code, 'sale_closed', 'once');

    const shown = await mtn();
    assert.deepEqual([shown.available, shown.bought_total, shown.bought_24h], [200_000, 200_000, 200_000]);
    assert.equal(await naira(seller), 0, 'nothing is credited inside the hold');
    const overview = (await admin.get('/v1/admin/airtime')).json;
    const line = overview.lines.find(item => item.number === first.json.collector_number);
    assert.deepEqual([line.received_today, line.balance], [200_000, 200_000]);
    await ledgerOk();

    assert.equal((await runJob()).credited, 0);
    await prisma.airtimeSale.update({ where: { id: first.json.id }, data: { creditAt: new Date(Date.now() - 1000) } });
    assert.equal((await runJob()).credited, 1);
    assert.equal(await naira(seller), 160_000);
    assert.equal((await seller.get(`/v1/store/airtime/sales/${first.json.id}`)).json.status, 'credited');
    await ledgerOk();
  });

  test('buying: the price locked from the wallet, the pool reserved, sent at the pool\'s average cost with BitoCard\'s margin', async () => {
    const buyer = await customer({ phone: '+2348051234567' });
    await fund(buyer, 50_000);
    const stranger = await buyer.post('/v1/store/airtime/purchases', { network: 'mtn', amount: 100_000, phone: '08059999999', preview: true });
    assert.equal(stranger.json.error.code, 'phone_not_verified', 'airtime goes only to the buyer\'s own confirmed numbers');
    const short = await buyer.post('/v1/store/airtime/purchases', { network: 'mtn', amount: 100_000, phone: '08051234567' });
    assert.deepEqual([short.status, short.json.error.code], [402, 'wallet_balance_low']);
    assert.equal((await mtn()).available, 200_000, 'nothing reserved by a refused purchase');

    await fund(buyer, 500_000);
    assert.equal((await buyer.post('/v1/store/airtime/purchases', { network: 'mtn', amount: 300_000, phone: '08051234567' })).json.error.code, 'pool_short');
    const quote = await buyer.post('/v1/store/airtime/purchases', { network: 'mtn', amount: 100_000, phone: '08051234567', preview: true });
    assert.deepEqual([quote.json.price, quote.json.phone, quote.json.available], [88_000, '+2348051234567', 200_000], 'buyers pay 88%');
    assert.equal((await buyer.post('/v1/store/airtime/purchases', { network: 'mtn', amount: 100_000, phone: '08051234567', expected_price: 80_000 })).json.error.code, 'price_changed');
    const bought = await buyer.post('/v1/store/airtime/purchases', { network: 'mtn', amount: 100_000, phone: '08051234567', expected_price: 88_000 });
    assert.equal(bought.status, 201, JSON.stringify(bought.json));
    assert.equal(bought.json.status, 'paid');
    assert.equal(await naira(buyer), 550_000 - 88_000);
    assert.equal((await mtn()).available, 100_000, 'promised airtime is no longer available to others');

    const claimed = await admin.post(`/v1/admin/airtime/purchases/${bought.json.id}/claim`, { line_id: lines[0].id });
    assert.equal(claimed.json.status, 'delivering');
    const sent = await admin.post(`/v1/admin/airtime/purchases/${bought.json.id}/delivered`, {});
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.equal(sent.json.status, 'delivered');

    const shown = await mtn();
    assert.deepEqual([shown.available, shown.sold_total, shown.sold_24h], [100_000, 100_000, 100_000]);
    const pooled = await prisma.airtimePool.findUnique({ where: { mode_country_network: { mode: 'live', country: 'NG', network: 'mtn' } } });
    assert.deepEqual([pooled.availableMinor, pooled.reservedMinor, pooled.costMinor], [100_000n, 0n, 80_000n], 'half the airtime left, at half the cost');
    const purchase = await prisma.airtimePurchase.findUnique({ where: { id: bought.json.id } });
    assert.equal(purchase.costMinor, 80_000n);
    const entry = await prisma.journalEntry.findUnique({ where: { reference: `airtime_purchase:${bought.json.id}:delivered` }, include: { postings: { include: { account: true } } } });
    const revenue = entry.postings.find(posting => posting.account.kind === 'platform_revenue');
    assert.equal(revenue.amountMinor, -8_000n, 'BitoCard keeps ₦80 on ₦1,000 bought at ₦800 and sold at ₦880');
    const line = (await admin.get('/v1/admin/airtime')).json.lines.find(item => item.id === lines[0].id);
    assert.equal(line.sent_today, 100_000);
    await ledgerOk();
  });

  test('a purchase nobody sends within the hour is refunded; one being sent is left for staff', async () => {
    const buyer = await customer({ phone: '+2348051234568' });
    await fund(buyer, 200_000);
    const waiting = (await buyer.post('/v1/store/airtime/purchases', { network: 'mtn', amount: 50_000, phone: '08051234568' })).json;
    const taken = (await buyer.post('/v1/store/airtime/purchases', { network: 'mtn', amount: 20_000, phone: '08051234568' })).json;
    // A line that does not hold the airtime, or cannot send more today, is refused.
    const empty = (await admin.post('/v1/admin/airtime/lines', { country: 'NG', network: 'mtn', number: '08039990077' })).json;
    assert.equal((await admin.post(`/v1/admin/airtime/purchases/${taken.id}/claim`, { line_id: empty.id })).json.error.code, 'line_short');
    await admin.patch(`/v1/admin/airtime/lines/${empty.id}`, { active: false });
    await prisma.airtimeCollectorLine.update({ where: { id: lines[0].id }, data: { dailySendMinor: 100_010n } });
    assert.equal((await admin.post(`/v1/admin/airtime/purchases/${taken.id}/claim`, { line_id: lines[0].id })).json.error.code, 'line_limit');
    await prisma.airtimeCollectorLine.update({ where: { id: lines[0].id }, data: { dailySendMinor: 5_000_000n } });
    assert.equal((await admin.post(`/v1/admin/airtime/purchases/${taken.id}/claim`, { line_id: lines[0].id })).json.status, 'delivering');
    await prisma.airtimePurchase.updateMany({ where: { id: { in: [waiting.id, taken.id] } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const ran = await runJob();
    assert.deepEqual([ran.refunded, ran.overdue], [1, 1], 'the one being sent is flagged, not refunded');
    assert.equal((await buyer.get(`/v1/store/airtime/purchases/${waiting.id}`)).json.status, 'refunded');
    assert.equal((await buyer.get(`/v1/store/airtime/purchases/${taken.id}`)).json.status, 'delivering');
    assert.equal(await naira(buyer), 200_000 - Math.ceil(20_000 * 0.88));
    const refunded = await admin.post(`/v1/admin/airtime/purchases/${taken.id}/refund`, { reason: 'The number did not take it.' });
    assert.equal(refunded.json.status, 'refunded');
    assert.equal(await naira(buyer), 200_000);
    assert.equal((await mtn()).available, 100_000, 'both reservations freed');
    await ledgerOk();
  });

  test('a transfer the network reverses inside the hold leaves the pool and is never credited', async () => {
    const seller = await customer({ phone: '+2348031110004' });
    const sale = (await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 50_000 })).json;
    assert.equal((await admin.post(`/v1/admin/airtime/sales/${sale.id}/received`, {})).status, 200);
    assert.equal((await mtn()).available, 150_000);

    // Promised to a buyer first: it cannot be reversed until that purchase is settled.
    const buyer = await customer({ phone: '+2348051234569' });
    await fund(buyer, 200_000);
    const promised = (await buyer.post('/v1/store/airtime/purchases', { network: 'mtn', amount: 150_000, phone: '08051234569' })).json;
    assert.equal((await admin.post(`/v1/admin/airtime/sales/${sale.id}/reverse`, { reason: 'Reported stolen' })).json.error.code, 'pool_reserved');
    await admin.post(`/v1/admin/airtime/purchases/${promised.id}/refund`, { reason: 'Held for a check.' });

    const reversed = await admin.post(`/v1/admin/airtime/sales/${sale.id}/reverse`, { reason: 'Reported stolen' });
    assert.equal(reversed.json.status, 'reversed', JSON.stringify(reversed.json));
    assert.equal((await mtn()).available, 100_000);
    await prisma.airtimeSale.update({ where: { id: sale.id }, data: { creditAt: new Date(Date.now() - 1000) } });
    await runJob();
    assert.equal(await naira(seller), 0);
    await ledgerOk();
  });

  test('a sale never sent within the hour expires; not received is told to the seller', async () => {
    const seller = await customer({ phone: '+2348031110005' });
    const idle = (await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 10_000 })).json;
    const claimed = (await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 10_000 })).json;
    await seller.post(`/v1/store/airtime/sales/${claimed.id}/sent`);
    await prisma.airtimeSale.updateMany({ where: { id: { in: [idle.id, claimed.id] } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const ran = await runJob();
    assert.deepEqual([ran.expired, ran.overdue], [1, 1]);
    assert.equal((await seller.get(`/v1/store/airtime/sales/${idle.id}`)).json.status, 'expired');
    const notReceived = await admin.post(`/v1/admin/airtime/sales/${claimed.id}/not-received`, { reason: 'Nothing arrived on the line.' });
    assert.equal(notReceived.json.status, 'not_received');
    assert.equal((await seller.get(`/v1/store/airtime/sales/${claimed.id}`)).json.note, 'Nothing arrived on the line.');

    // The seller sent it after the hour: staff who find it on the line still take it in.
    const late = await admin.post(`/v1/admin/airtime/sales/${idle.id}/received`, { note: 'Arrived after the hour.' });
    assert.equal(late.status, 200, JSON.stringify(late.json));
    assert.equal(late.json.status, 'received');
    await ledgerOk();
  });

  test('finance sets each network\'s rates, sellers always getting less than buyers pay', async () => {
    const wrong = await admin.patch('/v1/admin/airtime/networks/NG/mtn', { sell_rate_bps: 9000, buy_rate_bps: 8800 });
    assert.equal(wrong.json.error.code, 'rates_invalid');
    const changed = await admin.patch('/v1/admin/airtime/networks/NG/airtel', { sell_rate_bps: 7800, buy_rate_bps: 8700, enabled: false });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    const airtel = (await pool()).networks.find(item => item.network === 'airtel');
    assert.deepEqual([airtel.sell_rate_bps, airtel.buy_rate_bps, airtel.open], [7800, 8700, false]);
    const support = await adminClient(server, ['support']);
    assert.equal((await support.patch('/v1/admin/airtime/networks/NG/mtn', { sell_rate_bps: 7000 })).status, 403);
    assert.equal((await support.get('/v1/admin/airtime')).status, 200);
  });

  test('new sellers sell less a day until their sales are complete', async () => {
    const big = (await admin.post('/v1/admin/airtime/lines', { country: 'NG', network: 'mtn', number: '08039990088' })).json;
    const seller = await customer({ phone: '+2348031110006' });
    const status = (await seller.get('/v1/store/airtime/seller')).json;
    const mtnLimit = status.networks.find(item => item.network === 'mtn');
    assert.deepEqual([status.completed_sales, mtnLimit.new_seller, mtnLimit.daily_limit], [0, true, 500_000], '₦5,000 a day for a new seller');
    const first = (await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 400_000 })).json;
    assert.equal(first.status, 'awaiting_transfer', JSON.stringify(first));
    const over = await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 200_000 });
    assert.equal(over.json.error.code, 'new_seller_limit');

    // Once enough of their sales are complete, the network's full daily limit applies.
    const changed = await admin.patch('/v1/admin/airtime/networks/NG/mtn', { established_after: 1, new_seller_daily: 300_000 });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.equal(changed.json.networks.find(item => item.network === 'mtn').established_after, 1);
    assert.equal((await admin.patch('/v1/admin/airtime/networks/NG/mtn', { new_seller_daily: 9_000_000 })).json.error.code, 'amounts_invalid', 'never above every seller limit');
    await prisma.airtimeSale.update({ where: { id: first.id }, data: { status: 'credited' } });
    assert.equal((await seller.get('/v1/store/airtime/seller')).json.networks.find(item => item.network === 'mtn').new_seller, false);
    const more = await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 200_000 });
    assert.equal(more.status, 201, JSON.stringify(more.json));
    await seller.post(`/v1/store/airtime/sales/${more.json.id}/cancel`);
    await admin.patch(`/v1/admin/airtime/lines/${big.id}`, { active: false });
  });

  test('three sent claims that never arrived pause selling until operations clear them', async () => {
    const big = (await admin.post('/v1/admin/airtime/lines', { country: 'NG', network: 'mtn', number: '08039990089' })).json;
    const seller = await customer({ phone: '+2348031110007' });
    // Not received before the seller said it was sent: no strike.
    const unsent = (await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 10_000 })).json;
    await admin.post(`/v1/admin/airtime/sales/${unsent.id}/not-received`, { reason: 'Nothing came.' });
    assert.equal((await seller.get('/v1/store/airtime/seller')).json.strikes, 0);

    for (let i = 0; i < 3; i += 1) {
      const sale = (await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 10_000 })).json;
      assert.equal(sale.status, 'awaiting_transfer', JSON.stringify(sale));
      await seller.post(`/v1/store/airtime/sales/${sale.id}/sent`);
      await admin.post(`/v1/admin/airtime/sales/${sale.id}/not-received`, { reason: 'Nothing arrived on the line.' });
    }
    const paused = (await seller.get('/v1/store/airtime/seller')).json;
    assert.deepEqual([paused.strikes, paused.strike_limit, paused.paused], [3, 3, true]);
    const refused = await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 10_000 });
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'selling_paused']);
    const listed = (await admin.get('/v1/admin/airtime/sales')).json.data.find(row => row.customer.id === seller.id);
    assert.deepEqual([listed.seller.strikes, listed.seller.paused], [3, true]);
    const told = await prisma.notification.findMany({ where: { customerId: seller.id, type: 'customer.airtime.selling_paused' } });
    assert.equal(told.length, 1, 'told once');

    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/airtime/sellers/${seller.id}/clear`, { reason: 'Checked' })).status, 403);
    const cleared = await admin.post(`/v1/admin/airtime/sellers/${seller.id}/clear`, { reason: 'The network confirmed a delay; the airtime arrived.' });
    assert.deepEqual([cleared.status, cleared.json.strikes, cleared.json.paused], [200, 0, false]);
    assert.equal((await seller.post('/v1/store/airtime/sales', { network: 'mtn', amount: 10_000 })).status, 201, 'selling again');
    await admin.patch(`/v1/admin/airtime/lines/${big.id}`, { active: false });
  });
});
