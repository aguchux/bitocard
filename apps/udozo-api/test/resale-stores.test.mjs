// B2B reselling, stage 2 (docs/BITOCARD_B2B_RESELLING_PLAN.md): resellers' catalogue of suppliers' resale listings,
// store listings priced inside each supplier's limits, notes shown only once the supplier approves the exact text,
// suppliers and resellers in a chat with phones and deals, a supplier stopping a reseller, auto-listing rules, and the
// job telling resellers when a listing stops selling. Real responses are checked against the OpenAPI document.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, resellerClient, startApp } from './helpers.mjs';
import { responseChecker } from './openapi-docs.mjs';

let server;
let prisma;
let admin;
let house;
let job;
let check;

before(async () => {
  // Resale is Udozo's (docs/UDOZO_SPINOFF_PLAN.md): its responses are checked against Udozo's API document.
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  house = server.app.get((await import('../dist/checkout/house.service.js')).HouseService);
  const { ResaleStoresService } = await import('../dist/resale/resale-stores.service.js');
  job = () => server.app.get(ResaleStoresService).job();
  check = await responseChecker(server.app);
  admin = await adminClient(server);
  for (const key of ['classifieds', 'classifieds_resale', 'reseller_resale']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0, monthlyListingLimit: 100 } });
  assert.equal((await admin.put('/v1/admin/classifieds/resale-settings/NG', { reseller_fee_bps: 300, reseller_fee_cap: 500000 })).status, 200);
});

after(async () => {
  // Leave the switches as they were for the files that follow (Docker runs share one database).
  for (const key of ['classifieds_resale', 'reseller_resale']) await admin?.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: null });
  server?.close();
});

function shopper() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `resale2-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body) };
}

let counter = 0;
/** A BitoCard Shop seller ready to open listings to resellers (identity checked, payout account, a confirmed phone). */
async function supplier(name) {
  const seller = shopper();
  const email = `supplier${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await seller.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal((await seller.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await seller.post('/v1/classifieds/terms/accept', { version: (await seller.get('/v1/classifieds/terms')).json.version });
  seller.id = signup.json.customer.id;
  const seller_house = await house.resellerFor('NG');
  await prisma.identityVerification.create({
    data: { subject: 'customer', resellerId: seller_house.id, mode: 'live', customerReference: seller.id, method: 'document', provider: 'test', providerReference: randomUUID(), status: 'approved', country: 'NG', consentAt: new Date(), verifiedName: name },
  });
  await prisma.customerBankAccount.create({
    data: { customerId: seller.id, mode: 'live', country: 'NG', currency: 'NGN', bankCode: '044', bankName: 'Access Bank', accountNumberEncrypted: 'sealed', accountNumberLast4: '6789', accountName: name, payoutsFrom: new Date() },
  });
  await prisma.customer.update({ where: { id: seller.id }, data: { phone: `+23480${String(30000000 + counter).padStart(8, '0')}`, phoneVerifiedAt: new Date() } });
  return seller;
}

/** A live resale listing: ₦250,000, 10% discount, 30% markup limit. */
async function listing(seller, title, extra = {}) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const made = await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'new', category_id: cat.id, area_id: area.id, resale: true, resale_discount_bps: 1000, resale_markup_max_bps: 3000, stock: 3, ...extra });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: made.json.id, kind: 'photo', position, url: `https://media.test/${made.json.id}-${position}.jpg` })) });
  const live = await seller.post(`/v1/classifieds/listings/${made.json.id}/submit`);
  assert.equal(live.json.status, 'active', JSON.stringify(live.json));
  return live.json;
}

/** A verified reseller with a Resale shop store (the template itself comes with stage 3). */
async function reseller(name = 'Ada Gadgets') {
  const owner = await resellerClient(server, { business: name });
  await prisma.reseller.update({ where: { id: owner.resellerId }, data: { status: 'active', verifiedAt: new Date() } });
  await prisma.user.update({ where: { id: owner.userId }, data: { phone: `+23481${String(40000000 + (counter += 1)).padStart(8, '0')}`, phoneVerifiedAt: new Date() } });
  const store = await prisma.store.create({ data: { resellerId: owner.resellerId, name, subdomain: `resale${counter}x${Date.now() % 100000}`, status: 'published', template: 'resale_shop' } });
  return { ...owner, api: owner.browser, store };
}

describe('who may resell', () => {
  test('the switch, verification and a Resale shop store', async () => {
    const shop = await reseller('Gate Store');
    assert.equal((await admin.put('/v1/admin/switches/reseller_resale', { country_code: 'NG', enabled: false })).status, 200);
    const closed = await shop.api.get('/v1/resale');
    check('GET /v1/resale', 200, closed.json);
    assert.deepEqual([closed.json.available, closed.json.reason], [false, 'switch_off']);
    assert.equal((await shop.api.get('/v1/resale/catalogue')).json.error.code, 'resale_unavailable');

    assert.equal((await admin.put('/v1/admin/switches/reseller_resale', { country_code: 'NG', enabled: true })).status, 200);
    const open = (await shop.api.get('/v1/resale')).json;
    assert.deepEqual([open.available, open.reason, open.stores.map(store => store.id), open.reseller_fee_bps], [true, null, [shop.store.id], 300]);

    await prisma.reseller.update({ where: { id: shop.resellerId }, data: { status: 'pending' } });
    assert.equal((await shop.api.get('/v1/resale')).json.reason, 'not_verified');
    await prisma.reseller.update({ where: { id: shop.resellerId }, data: { status: 'active' } });

    const other = await prisma.store.create({ data: { resellerId: shop.resellerId, name: 'Gift shop', subdomain: `plain${Date.now() % 100000}`, template: 'gift_cards' } });
    const seller = await supplier('Musa Bello');
    const item = await listing(seller, 'LG 43 inch TV');
    const refused = await shop.api.post('/v1/resale/listings', { store_id: other.id, listing_id: item.id, markup_bps: 1000 });
    assert.equal(refused.json.error?.code, 'store_not_resale_shop', JSON.stringify(refused.json));
  });
});

describe('catalogue, prices and store listings', () => {
  test('a supplier’s listing sells on the store at a price inside their limits, and its state follows the supplier', async () => {
    const seller = await supplier('Chinedu Okafor');
    const item = await listing(seller, 'Hisense 50 inch 4K TV');
    const shopOnly = await listing(seller, 'Not for resellers', { resale: false });
    const shop = await reseller('Ada Gadgets');

    const catalogue = await shop.api.get(`/v1/resale/catalogue?store_id=${shop.store.id}&q=hisense`);
    check('GET /v1/resale/catalogue', 200, catalogue.json);
    const card = catalogue.json.data.find(row => row.id === item.id);
    assert.ok(card, JSON.stringify(catalogue.json));
    assert.deepEqual([card.supplier_price, card.discount_bps, card.markup_max_bps, card.price_range, card.available], [25000000, 1000, 3000, { min: 25000000, max: 32500000 }, 3]);
    assert.equal(card.earnings_at_max, 9700000, 'margin ₦100,000 less 3% (under the cap)');
    assert.equal(card.supplier.name, 'Chinedu O.');
    assert.ok(!(await shop.api.get('/v1/resale/catalogue?q=resellers')).json.data.some(row => row.id === shopOnly.id), 'a listing not open to resellers is not in the catalogue');
    const detail = await shop.api.get(`/v1/resale/catalogue/${item.id}`);
    check('GET /v1/resale/catalogue/{id}', 200, detail.json);
    assert.equal(detail.json.photos.length, 4);

    const preview = await shop.api.get(`/v1/resale/price-preview?listing_id=${item.id}&markup_bps=1500`);
    check('GET /v1/resale/price-preview', 200, preview.json);
    assert.deepEqual([preview.json.price, preview.json.margin, preview.json.reseller_fee, preview.json.earnings], [28750000, 6250000, 187500, 6062500]);

    for (const [body, code] of [
      [{ markup_bps: 3500 }, 'resale_price_out_of_range'],
      [{ markup_bps: -100 }, 'resale_price_out_of_range'],
      [{ fixed_price: 24000000 }, 'resale_price_out_of_range'],
      [{ markup_bps: 100, fixed_price: 26000000 }, 'parameter_invalid'],
    ]) {
      const refused = await shop.api.post('/v1/resale/listings', { store_id: shop.store.id, listing_id: item.id, ...body });
      assert.equal(refused.json.error?.code, code, JSON.stringify(body));
    }
    const added = await shop.api.post('/v1/resale/listings', { store_id: shop.store.id, listing_id: item.id, fixed_price: 30000000 });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    check('POST /v1/resale/listings', 201, added.json);
    assert.deepEqual([added.json.state, added.json.price, added.json.earnings], ['selling', 30000000, 7275000]);
    assert.equal((await shop.api.post('/v1/resale/listings', { store_id: shop.store.id, listing_id: item.id, markup_bps: 0 })).json.error.code, 'already_in_store');

    // The supplier hears of their new reseller; the relationship is there for both.
    assert.ok(await prisma.notification.count({ where: { customerId: seller.id, type: 'customer.resale.reseller_added' } }), JSON.stringify(await prisma.notification.findMany({ where: { customerId: seller.id } })));
    const mine = (await seller.get('/v1/classifieds/me/resellers')).json;
    assert.deepEqual([mine.data.length, mine.data[0].reseller.name, mine.data[0].listings_carried], [1, 'Ada Gadgets', 1]);

    // State follows the supplier: paused, repriced past the fixed price's range, then sold out.
    const first = await job();
    assert.equal(first.told, 0, 'a new listing starts from what it is');
    await seller.patch(`/v1/classifieds/listings/${item.id}`, { resale_paused: true });
    assert.equal((await shop.api.get(`/v1/resale/listings/${added.json.id}`)).json.state, 'supplier_paused');
    await seller.patch(`/v1/classifieds/listings/${item.id}`, { resale_paused: false, price: 20000000 });
    const repriced = (await shop.api.get(`/v1/resale/listings/${added.json.id}`)).json;
    check('GET /v1/resale/listings/{id}', 200, repriced);
    assert.deepEqual([repriced.state, repriced.price_range], ['price_out_of_range', { min: 20000000, max: 26000000 }], 'the fixed price is now above the limit');
    assert.ok((await job()).told >= 1);
    assert.equal(await prisma.notification.count({ where: { type: 'resale.listing_unavailable', resellerId: shop.resellerId } }), 1, 'told once');
    assert.equal((await job()).told, 0, 'and not again');

    const moved = await shop.api.patch(`/v1/resale/listings/${added.json.id}`, { markup_bps: 2000, fixed_price: null });
    check('PATCH /v1/resale/listings/{id}', 200, moved.json);
    assert.deepEqual([moved.json.state, moved.json.price], ['selling', 24000000], 'a markup follows the price');
    const paused = await shop.api.patch(`/v1/resale/listings/${added.json.id}`, { status: 'paused' });
    assert.equal(paused.json.state, 'paused');
    const listed = await shop.api.get(`/v1/resale/listings?store_id=${shop.store.id}`);
    check('GET /v1/resale/listings', 200, listed.json);
    const removed = await shop.api.delete(`/v1/resale/listings/${added.json.id}`);
    check('DELETE /v1/resale/listings/{id}', 200, removed.json);
    assert.equal((await shop.api.get(`/v1/resale/listings?store_id=${shop.store.id}`)).json.total, 0);
  });

  test('another reseller’s listings and other stores stay out of reach', async () => {
    const seller = await supplier('Bola Ade');
    const item = await listing(seller, 'Samsung 55 inch TV');
    const [one, two] = [await reseller('First Store'), await reseller('Second Store')];
    const added = (await one.api.post('/v1/resale/listings', { store_id: one.store.id, listing_id: item.id, markup_bps: 500 })).json;
    assert.equal((await two.api.get(`/v1/resale/listings/${added.id}`)).status, 404);
    assert.equal((await two.api.patch(`/v1/resale/listings/${added.id}`, { status: 'paused' })).status, 404);
    assert.equal((await two.api.post('/v1/resale/listings', { store_id: one.store.id, listing_id: item.id, markup_bps: 500 })).status, 404, 'not their store');
  });
});

describe('notes', () => {
  test('shown only once the supplier approves the exact text; any change asks again', async () => {
    const seller = await supplier('Ngozi Obi');
    const item = await listing(seller, 'Sony 65 inch TV');
    const shop = await reseller('Note Store');
    const added = (await shop.api.post('/v1/resale/listings', { store_id: shop.store.id, listing_id: item.id, markup_bps: 1000 })).json;

    for (const note of ['Call 0803 123 4567 for more', 'See www.example.com', 'Email me at ada@example.com', 'Follow @adagadgets']) {
      assert.equal((await shop.api.put(`/v1/resale/listings/${added.id}/note`, { note })).json.error?.code, 'note_refused', note);
    }
    const noted = await shop.api.put(`/v1/resale/listings/${added.id}/note`, { note: 'Free wall bracket with every order this month.' });
    check('PUT /v1/resale/listings/{id}/note', 200, noted.json);
    assert.deepEqual([noted.json.note.text, noted.json.note.status], ['Free wall bracket with every order this month.', 'pending']);
    assert.ok(await prisma.notification.count({ where: { customerId: seller.id, type: 'customer.resale.note_pending' } }));
    const counts = (await seller.get('/v1/classifieds/conversations/unread')).json;
    assert.deepEqual([counts.resellers, counts.resellers_waiting], [1, 1], 'My Resellers: one reseller, one note waiting');

    const relationship = (await seller.get('/v1/classifieds/me/resellers')).json.data[0];
    const detail = (await seller.get(`/v1/classifieds/me/resellers/${relationship.id}`)).json;
    assert.equal(detail.listings[0].note.status, 'pending');
    // The reseller changes it before the supplier approves: the old text cannot be approved.
    await shop.api.put(`/v1/resale/listings/${added.id}/note`, { note: 'Free delivery within Abuja this week.' });
    assert.equal((await seller.post(`/v1/classifieds/me/resale-notes/${added.id}/approve`, { note: 'Free wall bracket with every order this month.' })).json.error.code, 'note_changed');
    const approved = await seller.post(`/v1/classifieds/me/resale-notes/${added.id}/approve`, { note: 'Free delivery within Abuja this week.' });
    assert.equal(approved.status, 200, JSON.stringify(approved.json));
    assert.equal((await shop.api.get(`/v1/resale/listings/${added.id}`)).json.note.status, 'approved');
    assert.ok(await prisma.notification.count({ where: { type: 'resale.note_decided', resellerId: shop.resellerId } }));

    const withdrawn = await seller.post(`/v1/classifieds/me/resale-notes/${added.id}/withdraw`, { reason: 'Delivery is no longer free.' });
    assert.equal(withdrawn.status, 200);
    const after = (await shop.api.get(`/v1/resale/listings/${added.id}`)).json.note;
    assert.deepEqual([after.status, after.reason], ['withdrawn', 'Delivery is no longer free.']);
    const cleared = await shop.api.delete(`/v1/resale/listings/${added.id}/note`);
    check('DELETE /v1/resale/listings/{id}/note', 200, cleared.json);
    assert.equal(cleared.json.note, null);
  });
});

describe('suppliers, chat and deals', () => {
  test('phones and chat between them; a deal lowers the floor; ending it takes the price back out of range', async () => {
    const seller = await supplier('Tunde Bakare');
    const item = await listing(seller, 'TCL 50 inch TV');
    const shop = await reseller('Deal Store');
    const added = (await shop.api.post('/v1/resale/listings', { store_id: shop.store.id, listing_id: item.id, markup_bps: 0 })).json;

    const suppliers = await shop.api.get('/v1/resale/suppliers');
    check('GET /v1/resale/suppliers', 200, suppliers.json);
    const row = suppliers.json.data[0];
    assert.match(row.supplier.phone, /^\+234/, 'the supplier’s confirmed phone');
    const relationship = (await seller.get(`/v1/classifieds/me/resellers/${row.id}`)).json;
    assert.match(relationship.reseller.phone, /^\+234/, 'the reseller owner’s confirmed phone');
    assert.equal(relationship.stores[0].name, 'Deal Store');

    const sent = await shop.api.post(`/v1/resale/suppliers/${row.id}/messages`, { body: 'Can you do a better price on ten units?' });
    check('POST /v1/resale/suppliers/{id}/messages', 201, sent.json);
    assert.equal(sent.json.author_name, 'Ada Obi');
    assert.equal((await seller.get(`/v1/classifieds/me/resellers/${row.id}/messages`)).json.data[0].author_name, 'Deal Store', 'suppliers see the business');

    assert.equal((await seller.post(`/v1/classifieds/me/resellers/${row.id}/deals`, { discount_bps: 9000 })).json.error.code, 'resale_discount_out_of_range');
    assert.equal((await seller.post(`/v1/classifieds/me/resellers/${row.id}/deals`, { discount_bps: 1500, floor_bps: 2000 })).json.error.param, 'floor_bps');
    const offered = await seller.post(`/v1/classifieds/me/resellers/${row.id}/deals`, { discount_bps: 1500, floor_bps: 500, ends_at: new Date(Date.now() + 30 * 86400000).toISOString() });
    assert.equal(offered.status, 201, JSON.stringify(offered.json));
    assert.ok(await prisma.notification.count({ where: { type: 'resale.deal_offered', resellerId: shop.resellerId } }));
    const thread = await shop.api.get(`/v1/resale/suppliers/${row.id}/messages`);
    check('GET /v1/resale/suppliers/{id}/messages', 200, thread.json);
    assert.equal(thread.json.data.at(-1).deal.id, offered.json.id, 'the offer is in the chat');

    // Below the supplier's price only once the deal runs.
    assert.equal((await shop.api.patch(`/v1/resale/listings/${added.id}`, { markup_bps: -500 })).json.error.code, 'resale_price_out_of_range');
    const accepted = await shop.api.post(`/v1/resale/deals/${offered.json.id}/accept`);
    check('POST /v1/resale/deals/{id}/accept', 200, accepted.json);
    assert.equal(accepted.json.status, 'active');
    const lowered = (await shop.api.patch(`/v1/resale/listings/${added.id}`, { markup_bps: -500 })).json;
    assert.deepEqual([lowered.state, lowered.price, lowered.discount_bps, lowered.margin], ['selling', 23750000, 1500, 2500000], '₦237,500 with ₦212,500 to the supplier');
    const card = (await shop.api.get(`/v1/resale/catalogue/${item.id}`)).json;
    assert.deepEqual([card.discount_bps, card.floor_bps, card.deal_id], [1500, 500, offered.json.id]);

    const ended = await seller.post(`/v1/classifieds/me/resale-deals/${offered.json.id}/end`);
    assert.equal(ended.json.status, 'ended');
    assert.equal((await shop.api.get(`/v1/resale/listings/${added.id}`)).json.state, 'price_out_of_range', 'below the floor again');

    // A deal past its end date ends by itself.
    const short = (await seller.post(`/v1/classifieds/me/resellers/${row.id}/deals`, { discount_bps: 1200 })).json;
    await shop.api.post(`/v1/resale/deals/${short.id}/accept`);
    await prisma.resaleDeal.update({ where: { id: short.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    assert.ok((await job()).deals_ended >= 1);
    assert.deepEqual([(await prisma.resaleDeal.findUniqueOrThrow({ where: { id: short.id } })).endedBy], ['expired']);
  });

  test('a supplier stops a reseller: off every store, no adding, chat closed', async () => {
    const seller = await supplier('Femi Ade');
    const item = await listing(seller, 'Panasonic 40 inch TV');
    const shop = await reseller('Stopped Store');
    const added = (await shop.api.post('/v1/resale/listings', { store_id: shop.store.id, listing_id: item.id, markup_bps: 500 })).json;
    const relationship = (await seller.get('/v1/classifieds/me/resellers')).json.data[0];

    assert.equal((await seller.post(`/v1/classifieds/me/resellers/${relationship.id}/stop`)).json.stopped, true);
    assert.equal((await shop.api.get(`/v1/resale/listings/${added.id}`)).json.state, 'supplier_stopped');
    assert.ok(!(await shop.api.get('/v1/resale/catalogue?q=panasonic')).json.data.some(row => row.id === item.id), 'gone from their catalogue');
    assert.equal((await shop.api.post(`/v1/resale/suppliers/${relationship.id}/messages`, { body: 'Hello?' })).json.error.code, 'chat_closed');
    const theirs = (await shop.api.get(`/v1/resale/suppliers/${relationship.id}`)).json;
    check('GET /v1/resale/suppliers/{id}', 200, theirs);
    assert.deepEqual([theirs.stopped_by_supplier, theirs.supplier.phone], [true, null], 'no phone once stopped');
    assert.ok(await prisma.notification.count({ where: { type: 'resale.supplier_stopped', resellerId: shop.resellerId } }));

    await seller.post(`/v1/classifieds/me/resellers/${relationship.id}/resume`);
    assert.equal((await shop.api.get(`/v1/resale/listings/${added.id}`)).json.state, 'selling');
  });
});

describe('auto-listing rules', () => {
  test('a rule adds matching listings, now and as they open, held to each markup limit; removed ones stay out', async () => {
    const seller = await supplier('Kemi Adeyemi');
    const shop = await reseller('Rule Store');
    const first = await listing(seller, 'Rule TV one', { resale_markup_max_bps: 1000 });
    const rule = await shop.api.post('/v1/resale/rules', { store_id: shop.store.id, category: 'tvs', markup_bps: 1500 });
    assert.equal(rule.status, 201, JSON.stringify(rule.json));
    check('POST /v1/resale/rules', 201, rule.json);
    const mine = (await shop.api.get(`/v1/resale/listings?store_id=${shop.store.id}&limit=100`)).json.data;
    const one = mine.find(row => row.listing_id === first.id);
    assert.deepEqual([one.markup_bps, one.rule_id], [1000, rule.json.id], 'held to the listing’s 10% limit');

    await shop.api.delete(`/v1/resale/listings/${one.id}`);
    const second = await listing(seller, 'Rule TV two');
    await job();
    const now = (await shop.api.get(`/v1/resale/listings?store_id=${shop.store.id}&limit=100`)).json.data;
    assert.ok(now.some(row => row.listing_id === second.id), 'the new listing was added by the job');
    assert.ok(!now.some(row => row.listing_id === first.id), 'the removed one stays out');

    const rules = await shop.api.get('/v1/resale/rules');
    check('GET /v1/resale/rules', 200, rules.json);
    const off = await shop.api.patch(`/v1/resale/rules/${rule.json.id}`, { active: false });
    check('PATCH /v1/resale/rules/{id}', 200, off.json);
    const gone = await shop.api.delete(`/v1/resale/rules/${rule.json.id}`);
    check('DELETE /v1/resale/rules/{id}', 200, gone.json);
  });
});
