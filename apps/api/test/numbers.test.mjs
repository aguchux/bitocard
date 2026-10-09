// Virtual numbers after their order: renewals from the reseller's wallet (by hand and automatically), the reminders,
// pausing at expiry, restoring, deletion on day 15, the SMS inbox (DIDWW's HTTP IN trunk) and sending SMS (held, then
// priced from DIDWW's callback), and the number on its order's page.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';
import { fakeDidww } from './fakes.mjs';
import { responseChecker } from './openapi-docs.mjs';

const { EmailService } = await import('../dist/notifications/email.service.js');

let server;
let didww;
let admin;
let prisma;
let wallets;
let check;
let visitor;

const day = 24 * 60 * 60 * 1000;
const londonKey = 'virtual_numbers:GB:local:london-voice-sms-0ch';
const smsToken = 'didww-sms-token-0123456789';

before(async () => {
  didww = await fakeDidww();
  server = await startApp({ env: { ...didww.env, DIDWW_CALLBACK_URL: 'https://api.test.example', CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  visitor = client(server.base, { autoIdempotency: true });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  check = await responseChecker(server.app);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  assert.equal((await admin.patch('/v1/admin/suppliers/didww', { enabled: true })).status, 200);
  assert.equal((await admin.put('/v1/admin/suppliers/didww/markets/NG/virtual_numbers', { enabled: true })).status, 200);
  assert.equal((await admin.put('/v1/admin/countries/NG/categories/virtual_numbers', { enabled: true })).status, 200);
  assert.equal((await admin.post('/v1/admin/suppliers/didww/sync')).status, 200);
  // The London numbers can send SMS too (for the sending tests).
  await prisma.product.update({ where: { key: londonKey }, data: { features: { push: 'sms_out' } } });
});

after(async () => {
  await server?.close();
  await didww?.close();
});

const cron = () => fetch(`${server.base}/v1/cron/numbers`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
const outbox = () => server.app.get(EmailService).outbox;
const available = async browser => (await browser.get('/v1/wallet')).json.available;

async function reseller(funding = 50_000_000) {
  const reseller = await resellerClient(server);
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
  if (funding) await wallets.adjust(null, { resellerId: reseller.resellerId, mode: 'live', balance: 'funding', amount: funding, reason: 'Test funding' });
  return reseller;
}

/** A live London number bought by a funded reseller; its customer's email is on the order. */
async function bought(funding) {
  const owner = await reseller(funding ?? 50_000_000);
  const product = await prisma.product.findUniqueOrThrow({ where: { key: londonKey } });
  const quote = await owner.browser.post('/v1/quotes', { product_id: product.id, face_value: Number(product.fixedValues[0]) });
  assert.equal(quote.status, 201, JSON.stringify(quote.json));
  const order = await owner.browser.post('/v1/orders', { quote_id: quote.json.id });
  assert.equal(order.json.status, 'completed', JSON.stringify(order.json));
  const email = `number-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  await prisma.order.update({ where: { id: order.json.id }, data: { recipient: { email } } });
  const row = await prisma.virtualNumber.findUniqueOrThrow({ where: { orderId: order.json.id } });
  return { ...owner, order: order.json, number: row, email };
}

const set = (id, data) => prisma.virtualNumber.update({ where: { id }, data });
const did = number => didww.state.dids.find(item => item.id === number.supplierNumberId);

describe('numbers after their order', () => {
  test('a delivered number is kept with when it is paid up to; resellers see it without the supplier’s ID', async () => {
    const { browser, order, number } = await bought();
    assert.deepEqual([number.number, number.status, number.expiresAt.toISOString(), number.monthlyCostMinor], [order.deliveries[0].serial, 'active', '2026-11-03T00:00:00.000Z', 150n]);
    const listed = await browser.get('/v1/numbers');
    check('GET /v1/numbers', 200, listed.json);
    const one = await browser.get(`/v1/numbers/${number.id}`);
    check('GET /v1/numbers/{id}', 200, one.json);
    assert.deepEqual([one.json.number, one.json.auto_renew, one.json.sends_sms, one.json.delete_at], [number.number, false, true, '2026-11-18T00:00:00.000Z'], 'auto-renew is off until the customer or reseller switches it on');
    assert.ok(!JSON.stringify([listed.json, one.json]).includes(number.supplierNumberId) && !/didww/i.test(JSON.stringify(one.json)), 'never the supplier or its ID');
    assert.equal((await (await reseller()).browser.get(`/v1/numbers/${number.id}`)).status, 404, 'only the reseller’s own');
  });

  test('renewing takes a month from the wallet and adds it with the supplier', async () => {
    const { browser, number } = await bought();
    const price = await browser.get(`/v1/numbers/${number.id}/renewal-price`);
    check('GET /v1/numbers/{id}/renewal-price', 200, price.json);
    assert.equal(price.json.currency, 'NGN');
    const before = await available(browser);
    const renewed = await browser.post(`/v1/numbers/${number.id}/renew`, {});
    assert.equal(renewed.status, 200, JSON.stringify(renewed.json));
    check('POST /v1/numbers/{id}/renew', 200, renewed.json);
    assert.equal(renewed.json.expires_at, '2026-12-03T00:00:00.000Z');
    assert.equal(before - (await available(browser)), price.json.amount, 'the renewal price, taken');
    assert.deepEqual(did(number).patches, [{ billing_cycles_count: 1 }], 'one more renewal with DIDWW');
    assert.ok(await prisma.event.findFirst({ where: { type: 'number.renewed', resellerId: number.resellerId } }));
  });

  test('a short wallet renews nothing and takes nothing', async () => {
    const { browser, number } = await bought();
    // The wallet is emptied after buying.
    await prisma.ledgerAccount.updateMany({ where: { resellerId: number.resellerId, mode: 'live', kind: { in: ['reseller_funding', 'reseller_earnings'] } }, data: { balanceMinor: 0n } });
    const refused = await browser.post(`/v1/numbers/${number.id}/renew`, {});
    assert.deepEqual([refused.status, refused.json.error.code], [402, 'insufficient_funds']);
    assert.equal(did(number).patches, undefined, 'DIDWW is not asked');
  });

  test('auto-renew renews 3 days before expiry; a short wallet is noted, the reseller told, and tried again twice a day', async () => {
    const { number, resellerId } = await bought();
    await set(number.id, { expiresAt: new Date(Date.now() + 2 * day) });
    await cron();
    assert.equal((await prisma.virtualNumber.findUniqueOrThrow({ where: { id: number.id } })).renewedAt, null, 'not while auto-renew is off');
    await set(number.id, { autoRenew: true });
    assert.equal((await cron()).result.renewed >= 1, true);
    assert.ok((await prisma.virtualNumber.findUniqueOrThrow({ where: { id: number.id } })).expiresAt > new Date(Date.now() + 25 * day));

    const short = await bought();
    await set(short.number.id, { autoRenew: true, expiresAt: new Date(Date.now() + 2 * day) });
    await prisma.ledgerAccount.updateMany({ where: { resellerId: short.resellerId, mode: 'live', kind: { in: ['reseller_funding', 'reseller_earnings'] } }, data: { balanceMinor: 0n } });
    await cron();
    const noted = await prisma.virtualNumber.findUniqueOrThrow({ where: { id: short.number.id } });
    assert.deepEqual([noted.status, noted.renewalError], ['active', 'insufficient_funds']);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'number.renewal_failed' } }));
    const attempt = noted.renewalAttemptAt;
    await cron();
    assert.deepEqual((await prisma.virtualNumber.findUniqueOrThrow({ where: { id: short.number.id } })).renewalAttemptAt, attempt, 'not again within 12 hours');
    assert.ok(resellerId);
  });

  test('unrenewed: reminded 7 days before, paused at expiry, warned 7 days after, deleted on day 15; each step once', async () => {
    const { number, email, browser } = await bought();
    await set(number.id, { autoRenew: false, expiresAt: new Date(Date.now() + 5 * day) });
    const mails = () => outbox().filter(item => item.to === email);

    await cron();
    await cron();
    assert.equal(mails().filter(item => /expires on/.test(item.subject)).length, 1, 'reminded once');
    assert.ok(mails().at(-1).text.includes('/a/bca_'), 'with the order’s page');

    await set(number.id, { expiresAt: new Date(Date.now() - day) });
    await cron();
    assert.equal((await prisma.virtualNumber.findUniqueOrThrow({ where: { id: number.id } })).status, 'expired');
    assert.equal(mails().filter(item => /has expired/.test(item.subject)).length, 1);
    assert.ok(await prisma.event.findFirst({ where: { type: 'number.expired', resellerId: number.resellerId } }));

    await set(number.id, { expiresAt: new Date(Date.now() - 8 * day) });
    await cron();
    await cron();
    assert.equal(mails().filter(item => /will be deleted/.test(item.subject)).length, 1);

    await prisma.numberMessage.create({ data: { numberId: number.id, direction: 'in', counterparty: '447700900123', textEncrypted: 'x', status: 'received', supplierMessageId: `gone-${number.id}` } });
    await set(number.id, { expiresAt: new Date(Date.now() - 16 * day) });
    await cron();
    const deleted = await prisma.virtualNumber.findUniqueOrThrow({ where: { id: number.id } });
    assert.equal(deleted.status, 'deleted');
    assert.deepEqual(did(number).patches.at(-1), { billing_cycles_count: 0, terminated: true }, 'released with DIDWW');
    assert.equal(await prisma.numberMessage.count({ where: { numberId: number.id } }), 0, 'its messages go with it');
    assert.equal(mails().filter(item => /has been deleted/.test(item.subject)).length, 1);
    assert.equal((await browser.post(`/v1/numbers/${number.id}/renew`, {})).json.error.code, 'number_deleted');
  });

  test('an expired number renewed within the grace is restored; its new month starts now', async () => {
    const { browser, number } = await bought();
    await set(number.id, { autoRenew: false, status: 'expired', expiredAt: new Date(), expiresAt: new Date(Date.now() - 3 * day) });
    const renewed = await browser.post(`/v1/numbers/${number.id}/renew`, {});
    assert.equal(renewed.json.status, 'active', JSON.stringify(renewed.json));
    assert.ok(new Date(renewed.json.expires_at) > new Date(Date.now() + 27 * day));
    assert.deepEqual(did(number).patches, [{ billing_cycles_count: 1 }]);
  });

  test('an unclear renewal keeps the money held and is asked again unchanged: one month, paid once', async () => {
    const { browser, number } = await bought();
    const price = (await browser.get(`/v1/numbers/${number.id}/renewal-price`)).json.amount;
    const before = await available(browser);
    didww.state.patchReply = 500;
    let unclear;
    try {
      unclear = await browser.post(`/v1/numbers/${number.id}/renew`, {});
    } finally {
      didww.state.patchReply = undefined;
    }
    assert.deepEqual([unclear.status, unclear.json.error.code], [502, 'renewal_pending']);
    assert.equal(before - (await available(browser)), price, 'held, not returned: DIDWW may have renewed it');
    const pending = await prisma.virtualNumber.findUniqueOrThrow({ where: { id: number.id } });
    assert.deepEqual([pending.renewalCycles, pending.expiresAt.toISOString()], [1, '2026-11-03T00:00:00.000Z']);
    assert.ok(pending.renewalPending);

    // The job asks again once the lease has passed: the same request, never a second month.
    await set(number.id, { renewalAttemptAt: new Date(Date.now() - 20 * 60_000) });
    assert.ok((await cron()).result.renewed >= 1);
    assert.deepEqual(did(number).patches, [{ billing_cycles_count: 1 }, { billing_cycles_count: 1 }], 'asked for the same renewals left both times');
    const renewed = await prisma.virtualNumber.findUniqueOrThrow({ where: { id: number.id } });
    assert.deepEqual([renewed.expiresAt.toISOString(), renewed.renewalPending, renewed.renewalCycles], ['2026-12-03T00:00:00.000Z', null, null]);
    assert.equal(before - (await available(browser)), price, 'taken once');
    const holds = await prisma.hold.findMany({ where: { reference: { startsWith: `number_renewal:${number.id}:` } } });
    assert.deepEqual(holds.map(hold => hold.status), ['captured'], 'one hold, captured');
  });

  test('a clear refusal returns the hold at once', async () => {
    const { browser, number } = await bought();
    const before = await available(browser);
    didww.state.patchReply = 422;
    let refused;
    try {
      refused = await browser.post(`/v1/numbers/${number.id}/renew`, {});
    } finally {
      didww.state.patchReply = undefined;
    }
    assert.deepEqual([refused.status, refused.json.error.code], [502, 'renewal_failed']);
    assert.equal(await available(browser), before, 'nothing taken');
    assert.equal((await prisma.virtualNumber.findUniqueOrThrow({ where: { id: number.id } })).renewalPending, null);
  });

  test('settings: auto-renew and customer sending', async () => {
    const { browser, number } = await bought();
    const updated = await browser.patch(`/v1/numbers/${number.id}`, { auto_renew: false, customer_sending: true });
    check('PATCH /v1/numbers/{id}', 200, updated.json);
    assert.deepEqual([updated.json.auto_renew, updated.json.customer_sending], [false, true]);
  });
});

describe('SMS', () => {
  const deliver = (body, token = smsToken) =>
    fetch(`${server.base}/v1/webhooks/didww-sms?token=${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const status = body => fetch(`${server.base}/v1/webhooks/didww-sms-status?token=${smsToken}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  test('incoming SMS are stored once, encrypted, listed with their text, and announced without it', async () => {
    const { browser, number } = await bought();
    const body = { id: `in-${number.id}`, from: '447700900123', to: number.number.slice(1), text_base64: Buffer.from('Your code is 482913').toString('base64'), time: 'Wed, 08 Oct 2026 12:00:00 GMT' };
    assert.equal((await deliver(body, 'wrong-token-wrong-token')).status, 401);
    assert.equal((await deliver(body)).status, 200);
    assert.equal((await deliver(body)).status, 200, 'delivered again');
    const stored = await prisma.numberMessage.findMany({ where: { numberId: number.id } });
    assert.equal(stored.length, 1, 'stored once');
    assert.ok(!stored[0].textEncrypted.includes('482913'), 'encrypted');
    const listed = await browser.get(`/v1/numbers/${number.id}/messages`);
    check('GET /v1/numbers/{id}/messages', 200, listed.json);
    assert.deepEqual([listed.json.data[0].from, listed.json.data[0].to, listed.json.data[0].text], ['+447700900123', number.number, 'Your code is 482913']);
    const event = await prisma.event.findFirst({ where: { type: 'number.sms_received', resellerId: number.resellerId } });
    assert.ok(event && !event.payload.includes('482913'), 'the event never carries the text');
    const unknown = await (await deliver({ ...body, id: 'in-unknown', to: '15550000000' })).json();
    assert.equal(unknown.handled, false);
  });

  test('sending holds the most it can cost, then takes the real price once DIDWW reports it', async () => {
    const { browser, number } = await bought();
    const before = await available(browser);
    const sent = await browser.post(`/v1/numbers/${number.id}/messages`, { to: '+44 7700 900123', text: 'Your table is ready.' });
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    check('POST /v1/numbers/{id}/messages', 201, sent.json);
    assert.deepEqual([sent.json.status, sent.json.to, sent.json.charged], ['queued', '+447700900123', null]);
    const supplier = didww.state.sms.at(-1);
    assert.deepEqual([supplier.source, supplier.destination, supplier.content], [number.number.slice(1), '447700900123', 'Your table is ready.']);
    const held = before - (await available(browser));
    assert.ok(held > 0, 'the most it can cost is held');

    await status({ data: { type: 'outbound_message_callbacks', id: supplier.id, attributes: { status: 'Success', code_id: null, price: 0.0075, fragments_sent: 1 } } });
    const priced = (await browser.get(`/v1/numbers/${number.id}/messages`)).json.data[0];
    assert.equal(priced.status, 'sent');
    assert.ok(priced.charged > 0 && priced.charged < held, `charged ${priced.charged} of ${held} held`);
    assert.equal(before - (await available(browser)), priced.charged, 'the rest is back');
    await status({ data: { type: 'dlr_event', id: supplier.id, attributes: { status: 'DELIVERED' } } });
    assert.equal((await browser.get(`/v1/numbers/${number.id}/messages`)).json.data[0].status, 'delivered');
  });

  test('a message that fails returns its hold; limits and capabilities are checked', async () => {
    const { browser, number } = await bought();
    const before = await available(browser);
    await browser.post(`/v1/numbers/${number.id}/messages`, { to: '+447700900123', text: 'Hello' });
    await status({ data: { type: 'outbound_message_callbacks', id: didww.state.sms.at(-1).id, attributes: { status: 'Failed', code_id: 101 } } });
    assert.equal((await browser.get(`/v1/numbers/${number.id}/messages`)).json.data[0].status, 'failed');
    assert.equal(await available(browser), before, 'nothing taken');

    didww.state.smsReply = 422;
    const refused = await browser.post(`/v1/numbers/${number.id}/messages`, { to: '+447700900123', text: 'Hello again' });
    didww.state.smsReply = 'ok';
    assert.equal(refused.json.status, 'failed');
    assert.equal(await available(browser), before);

    assert.equal((await browser.post(`/v1/numbers/${number.id}/messages`, { to: '+447700900123', text: '😀'.repeat(40) })).json.error.code, 'text_too_long');
    assert.equal((await browser.post(`/v1/numbers/${number.id}/messages`, { to: '+12', text: 'Hi' })).status, 400);
    await set(number.id, { status: 'expired' });
    assert.equal((await browser.post(`/v1/numbers/${number.id}/messages`, { to: '+447700900123', text: 'Hi' })).json.error.code, 'number_not_active');
  });
});

describe('the number on its order’s page', () => {
  test('only the proven customer sees its messages; they send only when the reseller allows it', async () => {
    const { browser, order, number, email } = await bought();
    const token = order.access.url.split('/a/')[1];
    assert.equal((await visitor.get(`/v1/store/access/${token}/number`)).status, 401, 'not without proof');
    assert.equal((await visitor.post(`/v1/store/access/${token}/code`, {})).status, 200);
    const code = outbox().filter(item => item.to === email).at(-1).text.match(/\b\d{6}\b/)[0];
    const pass = (await visitor.post(`/v1/store/access/${token}/verify`, { code })).json.pass;
    const proof = { 'bitocard-access-pass': pass };

    await fetch(`${server.base}/v1/webhooks/didww-sms?token=${smsToken}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: `page-${number.id}`, from: '447700900999', to: number.number.slice(1), text_base64: Buffer.from('Code 7781').toString('base64') }),
    });
    const shown = (await visitor.get(`/v1/store/access/${token}/number`, proof)).json.number;
    assert.deepEqual([shown.number, shown.status, shown.can_send, shown.messages[0].text], [number.number, 'active', false, 'Code 7781']);
    assert.equal((await visitor.post(`/v1/store/access/${token}/messages`, { to: '+447700900123', text: 'Hi' }, proof)).json.error.code, 'sending_not_allowed');

    await browser.patch(`/v1/numbers/${number.id}`, { customer_sending: true });
    const sent = await visitor.post(`/v1/store/access/${token}/messages`, { to: '+447700900123', text: 'Hi' }, proof);
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.equal(sent.json.message.status, 'queued');
    assert.equal(await prisma.numberMessage.count({ where: { numberId: number.id, direction: 'out', sentBy: 'customer' } }), 1);
  });

  test('the customer renews and switches auto-renew; the reseller’s wallet pays, and a short wallet renews nothing', async () => {
    const { browser, order, number, email, resellerId } = await bought();
    const token = order.access.url.split('/a/')[1];
    await visitor.post(`/v1/store/access/${token}/code`, {});
    const code = outbox().filter(item => item.to === email).at(-1).text.match(/\b\d{6}\b/)[0];
    const proof = { 'bitocard-access-pass': (await visitor.post(`/v1/store/access/${token}/verify`, { code })).json.pass };
    assert.equal((await visitor.post(`/v1/store/access/${token}/number/renew`, {})).status, 401, 'not without proof');

    const shown = (await visitor.get(`/v1/store/access/${token}/number`, proof)).json.number;
    assert.deepEqual([shown.auto_renew, shown.can_renew], [false, true]);
    const price = (await browser.get(`/v1/numbers/${number.id}/renewal-price`)).json.amount;
    const early = await visitor.post(`/v1/store/access/${token}/number/renew`, {}, proof);
    assert.deepEqual([early.status, early.json.error.code], [409, 'renewal_not_due'], 'not months ahead on the reseller’s wallet');
    const soon = new Date(Date.now() + 3 * day);
    await set(number.id, { expiresAt: soon });
    const before = await available(browser);
    const renewed = await visitor.post(`/v1/store/access/${token}/number/renew`, {}, proof);
    assert.equal(renewed.status, 200, JSON.stringify(renewed.json));
    const until = new Date(renewed.json.number.expires_at).getTime() - soon.getTime();
    assert.ok(until >= 28 * day && until <= 31 * day, 'one month more');
    const again = await visitor.post(`/v1/store/access/${token}/number/renew`, {}, proof);
    assert.equal(again.json.error.code, 'renewal_not_due', 'renewed once, not again straight away');
    assert.equal(before - (await available(browser)), price, 'taken from the reseller’s wallet');

    const switched = await visitor.post(`/v1/store/access/${token}/number/auto-renew`, { enabled: true }, proof);
    assert.equal(switched.json.number.auto_renew, true);
    assert.equal((await browser.get(`/v1/numbers/${number.id}`)).json.auto_renew, true, 'the reseller sees it');

    await prisma.ledgerAccount.updateMany({ where: { resellerId, mode: 'live', kind: { in: ['reseller_funding', 'reseller_earnings'] } }, data: { balanceMinor: 0n } });
    await prisma.virtualNumber.update({ where: { id: number.id }, data: { renewalAttemptAt: null, expiresAt: new Date(Date.now() + 3 * day) } });
    const refused = await visitor.post(`/v1/store/access/${token}/number/renew`, {}, proof);
    assert.deepEqual([refused.status, refused.json.error.code], [402, 'store_cannot_renew']);
    assert.match(refused.json.error.message, /cannot renew this number right now/);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'number.renewal_failed', title: { contains: 'Your customer could not renew' } } }), 'the reseller is told');

    // A refunded order's number is no longer the customer's to renew, switch or send from.
    await prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } });
    assert.equal((await visitor.post(`/v1/store/access/${token}/number/renew`, {}, proof)).json.error.code, 'order_not_active');
    assert.equal((await visitor.post(`/v1/store/access/${token}/number/auto-renew`, { enabled: false }, proof)).json.error.code, 'order_not_active');
  });
});
