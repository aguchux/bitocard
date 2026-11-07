// Buy orders (docs/UDOZO_RATINGS_PLAN.md phase 0): the buyer asks to buy at a price, the seller accepts (holding the
// units) or counters before they meet, they pay each other in person, and the seller marks it sold; the record of who
// bought what that reviews will read.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;
let service;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  service = server.app.get((await import('../dist/classifieds/buy-orders/buy-orders.service.js')).BuyOrdersService);
  admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  assert.equal((await admin.put('/v1/admin/switches/classifieds_buy_orders', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
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
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `buy-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = res.status === 204 ? null : await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

let counter = 0;
async function customer(name, { confirmPhone = true } = {}) {
  const shopper = storeServer();
  const email = `buy${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  if (confirmPhone) await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function live(seller, title, { stock = 1, contact = 'both' } = {}) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const draft = (await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'used', category_id: cat.id, area_id: area.id, contact, stock: 1 })).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  if (stock !== 1) await prisma.classifiedListing.update({ where: { id: draft.id }, data: { stock } });
  return submitted;
}

const ask = (buyer, listing, body = { price: 24000000 }) => buyer.post(`/v1/classifieds/listings/${listing.id}/buy-orders`, body);
const step = (who, order, action, body = {}) => who.post(`/v1/classifieds/buy-orders/${order.id}/${action}`, body);
const notices = (customerId, type) => prisma.notification.count({ where: { customerId, type } });

describe('Buy orders', () => {
  test('ask, counter, accept, hold the item, mark sold: recorded once, stock gone, both told, steps in the chat', async () => {
    const seller = await customer('Chinedu Okafor');
    const buyer = await customer('Kemi Adeyemi');
    const other = await customer('Tunde Bakare');
    const tv = await live(seller, 'Hisense 50 inch TV');

    const viewed = (await buyer.get(`/v1/classifieds/listings/${tv.id}/viewer`)).json;
    assert.deepEqual([viewed.buy_orders, viewed.buy_order], [true, null]);

    assert.equal((await ask(seller, tv)).json.error.code, 'own_listing');
    assert.equal((await storeServer().post(`/v1/classifieds/listings/${tv.id}/buy-orders`, { price: 1 })).status, 401);
    assert.equal((await ask(buyer, tv, { price: 0 })).status, 400);

    const asked = await ask(buyer, tv, { price: 24000000, note: 'Call me on 08031234567', meet_note: 'Gwarinpa mall, Saturday' });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.deepEqual([asked.json.status, asked.json.role, asked.json.number.startsWith('BO-'), asked.json.with.name], ['requested', 'buyer', true, 'Chinedu O.']);
    assert.deepEqual(asked.json.actions, ['cancel']);
    assert.doesNotMatch(asked.json.note, /08031234567/, 'numbers hidden in the note');
    assert.ok(asked.json.conversation_id, 'a chat is opened for the order');
    assert.equal((await ask(buyer, tv)).json.error.code, 'buy_order_open', 'one open order per buyer and listing');
    assert.equal(await notices(seller.id, 'customer.classifieds.buy_request'), 1);

    const selling = (await seller.get('/v1/classifieds/me/buy-orders?role=selling')).json;
    assert.equal(selling.waiting, 1);
    assert.deepEqual(selling.data[0].actions, ['accept', 'counter', 'decline']);
    assert.equal((await step(buyer, asked.json, 'accept')).json.error.code, 'buy_order_not_yours');
    assert.equal((await other.get(`/v1/classifieds/buy-orders/${asked.json.id}`)).status, 404, 'strangers never see it');

    const countered = await step(seller, asked.json, 'counter', { price: 24500000 });
    assert.deepEqual([countered.status, countered.json.status, countered.json.counter], [200, 'countered', 24500000]);
    assert.equal(await notices(buyer.id, 'customer.classifieds.buy_countered'), 1);
    assert.equal((await buyer.get('/v1/classifieds/me/buy-orders?role=buying')).json.waiting, 1, 'the buyer has a price to answer');

    // Another buyer's request waits; once the first is accepted the only unit is held for them.
    const second = (await ask(other, tv, { price: 25000000 })).json;
    const accepted = await step(buyer, asked.json, 'accept-counter');
    assert.deepEqual([accepted.status, accepted.json.status, accepted.json.price, accepted.json.counter], [200, 'accepted', 24500000, null]);
    assert.ok(accepted.json.meet_by);
    assert.equal(await notices(seller.id, 'customer.classifieds.buy_accepted'), 1);
    assert.equal((await step(seller, second, 'accept')).json.error.code, 'out_of_stock', 'a held unit cannot be accepted twice');
    assert.equal((await ask(await customer('Bola Ade'), tv)).json.error.code, 'out_of_stock');
    const page = (await storeServer().get(`/v1/classifieds/listings/${tv.ref}?country=NG`)).json;
    assert.equal(page.reserved, true, 'the listing shows reserved');

    const accepting = (await seller.get(`/v1/classifieds/me/listings/${tv.id}/buy-orders`)).json;
    assert.deepEqual(accepting.data.map(row => row.id), [asked.json.id], 'Mark sold offers the accepted order');
    assert.deepEqual(accepting.data[0].actions, ['complete', 'extend', 'no_show', 'cancel']);

    const extended = await step(seller, asked.json, 'extend');
    assert.equal(extended.json.meet_extended, true);
    assert.equal((await step(seller, asked.json, 'extend')).json.error.code, 'buy_order_not_pending', 'once only');

    const sold = await step(seller, asked.json, 'complete');
    assert.deepEqual([sold.status, sold.json.status, sold.json.completed_by], [200, 'completed', 'seller']);
    assert.equal((await step(seller, asked.json, 'complete')).json.error.code, 'buy_order_closed', 'completed once');
    const listing = await prisma.classifiedListing.findUniqueOrThrow({ where: { id: tv.id } });
    // The last one sold leaves it live but out of stock (90 days, then Anjio takes it off), and its seller is told.
    assert.deepEqual([listing.stock, listing.status, Boolean(listing.outOfStockAt)], [0, 'active', true]);
    assert.ok(listing.expiresAt.getTime() - Date.now() > 89 * 86_400_000, 'live 90 days out of stock');
    assert.equal(await notices(seller.id, 'customer.classifieds.out_of_stock'), 1);
    assert.equal(await notices(buyer.id, 'customer.classifieds.buy_completed'), 1);
    const mine = (await buyer.get(`/v1/classifieds/buy-orders/${asked.json.id}`)).json;
    assert.deepEqual(mine.actions, ['confirm', 'void'], 'Yes, I bought it, or not');
    assert.ok(mine.void_until);

    // The job closes the other buyer's request on the listing out of stock.
    const ran = await service.job();
    assert.equal(ran.closed, 1);
    const closed = (await other.get(`/v1/classifieds/buy-orders/${second.id}`)).json;
    assert.deepEqual([closed.status, closed.ended_by, closed.end_reason], ['cancelled', 'udozo', 'out_of_stock']);

    // Every step is a card in the chat, carrying the order as it stands.
    const chat = (await buyer.get(`/v1/classifieds/conversations/${asked.json.conversation_id}`)).json;
    const cards = chat.messages.filter(message => message.kind === 'buy_order');
    assert.equal(cards.length, 5, cards.map(card => card.body).join(' | '));
    assert.equal(cards.at(-1).buy_order.status, 'completed');
    assert.equal(cards.at(-1).buy_order.role, 'buyer');
  });

  test('the buyer says they bought it: it completes after 3 days without the seller; they cannot then deny it', async () => {
    const seller = await customer('Ada Eze');
    const buyer = await customer('Musa Bello');
    const phone = await live(seller, 'Samsung Galaxy phone', { stock: 3 });
    const order = (await ask(buyer, phone, { price: 50000000, quantity: 2 })).json;
    assert.equal((await step(seller, order, 'accept')).json.status, 'accepted');
    const bought = await step(buyer, order, 'bought');
    assert.ok(bought.json.bought_at);
    assert.ok(bought.json.completes_at);
    assert.deepEqual(bought.json.actions, ['no_show', 'cancel']);
    assert.equal(await notices(seller.id, 'customer.classifieds.buy_bought'), 1);
    assert.equal((await seller.get('/v1/classifieds/me/buy-orders?role=selling')).json.waiting, 1, 'a sale to confirm');

    assert.equal((await service.job()).completed, 0, 'not before 3 days');
    await prisma.classifiedBuyOrder.update({ where: { id: order.id }, data: { boughtAt: new Date(Date.now() - 4 * 86_400_000) } });
    const ran = await service.job();
    assert.equal(ran.completed, 1);
    assert.equal((await service.job()).completed, 0, 'run twice, completed once');
    const done = (await buyer.get(`/v1/classifieds/buy-orders/${order.id}`)).json;
    assert.deepEqual([done.status, done.completed_by, done.actions], ['completed', 'auto', []]);
    const listing = await prisma.classifiedListing.findUniqueOrThrow({ where: { id: phone.id } });
    assert.deepEqual([listing.stock, listing.status], [1, 'active'], 'two of three sold');
    assert.equal((await step(buyer, order, 'void', { reason: 'Never met' })).json.error.code, 'void_closed');
  });

  test('requests lapse, accepted orders are reminded then expire, and the hold goes back', async () => {
    const seller = await customer('Ngozi Obi');
    const buyer = await customer('Femi Ojo');
    const fridge = await live(seller, 'LG double door fridge');
    const quiet = (await ask(buyer, fridge)).json;
    await prisma.classifiedBuyOrder.update({ where: { id: quiet.id }, data: { respondBy: new Date(Date.now() - 1000) } });
    assert.equal((await service.job()).lapsed, 1);
    const lapsed = (await buyer.get(`/v1/classifieds/buy-orders/${quiet.id}`)).json;
    assert.deepEqual([lapsed.status, lapsed.ended_by], ['lapsed', 'seller']);
    assert.equal(await notices(buyer.id, 'customer.classifieds.buy_lapsed'), 1);

    const order = (await ask(buyer, fridge)).json;
    await step(seller, order, 'accept');
    await prisma.classifiedBuyOrder.update({ where: { id: order.id }, data: { meetBy: new Date(Date.now() + 3_600_000) } });
    assert.equal((await service.job()).reminded, 1);
    assert.equal((await service.job()).reminded, 0, 'reminded once');
    assert.equal(await notices(buyer.id, 'customer.classifieds.buy_meet_reminder'), 1);
    await prisma.classifiedBuyOrder.update({ where: { id: order.id }, data: { meetBy: new Date(Date.now() - 1000) } });
    assert.equal((await service.job()).expired, 1);
    assert.equal((await buyer.get(`/v1/classifieds/buy-orders/${order.id}`)).json.status, 'expired');
    const again = await ask(await customer('Ike Uche'), fridge);
    assert.equal(again.status, 201, 'the item is no longer held');
  });

  test('declining, cancelling and saying it did not happen end it; the buyer may deny a sale within 7 days, and three denials pause the seller', async () => {
    const seller = await customer('Bisi Lawal');
    const radio = await live(seller, 'Sony radio and speakers', { stock: 10 });
    const buyers = [await customer('Ola One'), await customer('Ola Two'), await customer('Ola Three'), await customer('Ola Four')];

    const declined = (await step(seller, (await ask(buyers[0], radio)).json, 'decline', { reason: 'Price too low' })).json;
    assert.deepEqual([declined.status, declined.ended_by, declined.end_reason], ['declined', 'seller', 'Price too low']);
    assert.equal(await notices(buyers[0].id, 'customer.classifieds.buy_declined'), 1);

    const cancelled = (await step(buyers[0], (await ask(buyers[0], radio)).json, 'cancel')).json;
    assert.deepEqual([cancelled.status, cancelled.ended_by], ['cancelled', 'buyer']);

    const met = (await ask(buyers[0], radio)).json;
    await step(seller, met, 'accept');
    const noShow = (await step(buyers[0], met, 'no-show', { reason: 'The seller did not come' })).json;
    assert.deepEqual([noShow.status, noShow.ended_by], ['no_show', 'buyer']);

    for (const [index, buyer] of buyers.slice(1).entries()) {
      const order = (await ask(buyer, radio)).json;
      await step(seller, order, 'accept');
      await step(seller, order, 'complete');
      assert.equal((await step(buyer, order, 'void')).json.error.param, 'reason', 'they say what happened');
      const voided = (await step(buyer, order, 'void', { reason: 'I never met the seller' })).json;
      assert.equal(voided.status, 'voided', `void ${index}`);
    }
    const row = await prisma.classifiedSeller.findUniqueOrThrow({ where: { customerId: seller.id } });
    assert.ok(row.buyOrdersPausedUntil > new Date(), 'paused after three');
    assert.equal(await prisma.notification.count({ where: { type: 'admin.classifieds.buy_orders_paused' } }) > 0, true);
    assert.equal((await ask(await customer('Late Buyer'), radio)).json.error.code, 'buy_orders_paused');

    // Admins see it, with the steps, and can unpause.
    const listed = await admin.get(`/v1/admin/classifieds/buy-orders?seller=${seller.id}`);
    assert.equal(listed.status, 200);
    assert.equal(listed.json.total, 6);
    const detail = await admin.get(`/v1/admin/classifieds/buy-orders/${met.id}`);
    assert.deepEqual(detail.json.steps.map(item => item.by), ['buyer', 'seller', 'buyer']);
    const sellerView = (await admin.get(`/v1/admin/classifieds/sellers/${seller.id}`)).json;
    assert.ok(sellerView.buy_orders_paused_until);
    assert.equal((await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/buy-orders/unpause`, { reason: 'Checked with the buyers' })).status, 200);
    assert.equal((await ask(await customer('Later Buyer'), radio)).status, 201);
  });

  test('refused without a confirmed mobile, or with the switch off', async () => {
    const seller = await customer('Kola Ade');
    const tv = await live(seller, 'Panasonic 43 inch TV');
    const unconfirmed = await customer('No Phone', { confirmPhone: false });
    await prisma.customer.update({ where: { id: unconfirmed.id }, data: { phoneVerifiedAt: null } });
    const code = (await ask(unconfirmed, tv)).json.error?.code;
    assert.ok(['phone_required', 'phone_not_verified'].includes(code), code);

    assert.equal((await admin.put('/v1/admin/switches/classifieds_buy_orders', { country_code: 'NG', enabled: false })).status, 200);
    const buyer = await customer('Switch Off');
    const refused = await ask(buyer, tv);
    assert.deepEqual([refused.status, refused.json.error.code], [503, 'buy_orders_unavailable']);
    assert.equal((await buyer.get(`/v1/classifieds/listings/${tv.id}/viewer`)).json.buy_orders, false);
    assert.equal((await admin.put('/v1/admin/switches/classifieds_buy_orders', { country_code: 'NG', enabled: true })).status, 200);
  });
});
