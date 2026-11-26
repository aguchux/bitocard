// Customers sell gift cards to Prestmit through BitoCard (decided 15 November 2026): the cards Prestmit buys are
// synced, matched to BitoCard's gift card products, and shown at their rate after BitoCard's margin; a sale is
// credited to the customer's wallet only once Prestmit approves it, once, with the margin to BitoCard; a rejected or
// refused one credits nothing; an unclear send is looked up by BitoCard's reference before anything is decided.
// BitoCard's sandbox never sells to Prestmit (simulated). Prestmit's name, rate and BitoCard's margin are never shown.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, fakeService, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

const { prestmitHash, prestmitSignatureValid, prestmitForm, prestmitCountry } = await import('../dist/gift-card-sales/prestmit.js');
const { matchBrand, afterMargin, marginBpsOf } = await import('../dist/gift-card-sales/gift-card-sales.service.js');

const cards = [
  { id: 11, name: 'Amazon (USA) E-code', rate: 1200, minimum: 25, form: 'Physical and Ecode', country: 'USA', terms: 'No used cards', category: { id: 1, name: 'Amazon', image: null } },
  { id: 12, name: 'iTunes UK', rate: 950.5, minimum: 10, form: 'Ecode', country: 'UK', terms: null, category: { id: 2, name: 'iTunes', image: null } },
  { id: 13, name: 'Mystery Card', rate: 100, minimum: 5, form: 'Physical', country: 'ATLANTIS', terms: null, category: { id: 3, name: 'Zzqx Unknown', image: null } },
];

/** A fake Prestmit: the rate calculator, trades by our reference, and what to answer for each. */
function fakePrestmit() {
  const trades = new Map();
  const state = { createStatus: 200, history: 'PENDING', total: null, availability: { buyGiftCard: true, sellGiftCard: true } };
  return {
    state,
    trades,
    service: fakeService(call => {
      const url = new URL(call.url, 'http://x');
      if (url.pathname.endsWith('/general/service-availability')) {
        const hash = createHmac('sha256', 'sk_test').update('pk_test:{}').digest('hex');
        if (call.headers['api-key'] !== 'pk_test' || call.headers['api-hash'] !== hash || call.headers['content-type'] !== 'application/json') {
          return { status: 401, body: { message: 'Invalid credentials' } };
        }
        return { body: { data: state.availability } };
      }
      if (url.pathname.endsWith('/giftcard-trade/sell/rate-calculator-data')) return { body: { data: { sellableGiftcards: cards, giftCardCategories: [] } } };
      if (url.pathname.endsWith('/giftcard-trade/sell/create')) {
        if (state.createStatus !== 200) return { status: state.createStatus, body: { message: 'Card not accepted' } };
        const id = /name="uniqueIdentifier"\r\n\r\n([^\r]+)/.exec(call.raw.toString('latin1'))?.[1];
        trades.set(id, { reference: `PM-${trades.size + 1}`, status: 'PENDING' });
        return { status: 201, body: { success: true, trade: { reference: trades.get(id).reference, status: 'PENDING', totalAmount: null } } };
      }
      if (url.pathname.endsWith('/giftcard-trade/sell/history')) {
        const id = url.searchParams.get('uniqueIdentifier');
        const trade = trades.get(id);
        if (!trade) return { body: { data: [] } };
        return { body: { data: { data: [{ ...trade, uniqueIdentifier: id, status: state.history, totalAmount: state.total, rejectionReason: state.history === 'REJECTED' ? 'Code already used' : null }] } } };
      }
      return { status: 404, body: { message: 'unknown' } };
    }),
  };
}

function storeClient(server, store = null) {
  let token = null;
  const request = async (method, path, body, form) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(store ? { 'bitocard-store': store } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `gs-${Date.now()}-${Math.random()}` } : {}),
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return {
    get: path => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    sell: fields => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'photos') for (const photo of value) form.append('photos', new Blob([photo], { type: 'image/png' }), 'card.png');
        else form.append(key, String(value));
      }
      return request('POST', '/v1/store/gift-card-sales', undefined, form);
    },
  };
}

// A 1x1 PNG.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let counter = 0;
async function customer(server, country = 'NG', store = null) {
  const shopper = storeClient(server, store);
  const email = `seller${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Seller', email, password: 'correct horse battery', country });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

describe('Prestmit helpers', () => {
  test('Prestmit sandbox and live URLs stay in their respective environments', async () => {
    const { inSandbox, providerUrl } = await import('../dist/integrations/endpoints.js');
    const sandbox = 'https://dev-api.prestmit.io/partners/v1';
    assert.equal(inSandbox({ PRESTMIT_API_URL: sandbox + '/' }, 'prestmit'), true);
    assert.equal(providerUrl({ PRESTMIT_API_URL: 'https://api.prestmit.io/partners/v1/' }, 'prestmit', 'sandbox'), sandbox);
    assert.equal(providerUrl({ PRESTMIT_API_URL: 'https://prestmit.com/api/partners/v1' }, 'prestmit', 'sandbox'), sandbox);
  });
  test('API-Hash, forms, countries and brands', () => {
    assert.equal(prestmitHash('key', 'secret', { a: '1' }), createHmac('sha256', 'secret').update('key:{"a":"1"}').digest('hex'));
    assert.deepEqual(['Physical', 'Ecode', 'Physical and Ecode'].map(prestmitForm), ['physical', 'ecode', 'both']);
    assert.deepEqual(['USA', 'UK', 'canada', 'Atlantis'].map(prestmitCountry), ['US', 'GB', 'CA', null]);
    assert.equal(matchBrand('Amazon', 'Amazon (USA)'), 'amazon');
    assert.equal(matchBrand('iTunes', 'iTunes UK'), 'apple');
    assert.equal(matchBrand('Zzqx Unknown', 'Mystery Card'), null);
    assert.equal(afterMargin(10_000n, 500), 9_500n);
    assert.equal(afterMargin(999n, 500), 949n);
    assert.deepEqual(['5', '2.5', '', '60'].map(value => marginBpsOf(value)), [500, 250, null, null]);
  });

  test('webhook signatures: hex or base64 of the body, compared exactly', () => {
    const body = Buffer.from('{"event":"giftcard-trade.sell.approved","data":{"id":1}}');
    const mac = createHmac('sha256', 'whsec').update(body).digest();
    assert.equal(prestmitSignatureValid('whsec', body, mac.toString('hex')), true);
    assert.equal(prestmitSignatureValid('whsec', body, mac.toString('base64')), true);
    assert.equal(prestmitSignatureValid('whsec', body, 'x'.repeat(64)), false);
    assert.equal(prestmitSignatureValid(undefined, body, mac.toString('hex')), false);
  });
});

describe('selling gift cards in the sandbox', () => {
  let server;
  let admin;
  let prisma;
  let prestmit;

  before(async () => {
    prestmit = fakePrestmit();
    const fake = await prestmit.service;
    prestmit.close = fake.close;
    server = await startApp({ env: { CHECKOUT_SANDBOX: 'on', PRESTMIT_SANDBOX: 'on', PRESTMIT_API_KEY: 'pk_test', PRESTMIT_API_SECRET: 'sk_test', PRESTMIT_API_URL: fake.url } });
    prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    admin = await adminClient(server);
  });

  after(async () => {
    await server?.close();
    await prestmit?.close();
  });

  test('synced cards are matched to brands; selling stays closed until switched on with a margin', async () => {
    const connection = await admin.post('/v1/admin/integrations/prestmit/test');
    assert.deepEqual([connection.status, connection.json.environment, connection.json.ok], [200, 'sandbox', true]);
    assert.match(connection.json.message, /Buying: available\. Selling: available\./);
    prestmit.state.availability = {};
    try {
      const malformed = await admin.post('/v1/admin/integrations/prestmit/test');
      assert.equal(malformed.json.ok, false);
      assert.match(malformed.json.message, /unexpected service availability response/);
    } finally {
      prestmit.state.availability = { buyGiftCard: true, sellGiftCard: true };
    }
    const synced = await admin.post('/v1/admin/gift-card-sales/offers/sync');
    assert.equal(synced.status, 200, JSON.stringify(synced.json));
    assert.deepEqual([synced.json.mode, synced.json.cards], ['test', 3]);
    const offers = await admin.get('/v1/admin/gift-card-sales/offers?mode=test');
    assert.deepEqual(offers.json.data.map(offer => [offer.name, offer.brand, offer.country, offer.form]).sort((a, b) => a[0].localeCompare(b[0])), [
      ['Amazon (USA) E-code', 'amazon', 'US', 'both'],
      ['iTunes UK', 'apple', 'GB', 'ecode'],
      ['Mystery Card', null, null, 'physical'],
    ]);

    const closed = await fetch(`${server.base}/v1/store/gift-card-sales/offers?product=gift_cards:US:amazon&country=NG`).then(res => res.json());
    assert.deepEqual([closed.available, closed.reason], [false, 'not_enabled']);
    assert.equal((await admin.put('/v1/admin/switches/gift_card_selling', { enabled: true })).status, 200);
    const noMargin = await fetch(`${server.base}/v1/store/gift-card-sales/offers?product=gift_cards:US:amazon&country=NG`).then(res => res.json());
    assert.deepEqual([noMargin.available, noMargin.reason], [false, 'not_configured']);
  });

  test('a sale is credited once, after approval, less the margin; a rejected one credits nothing', async () => {
    const saved = await admin.put('/v1/admin/integrations/prestmit', { values: { PRESTMIT_SELL_MARGIN_PERCENT: '5' }, code: await adminCode(server, admin) });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));

    const ghana = await fetch(`${server.base}/v1/store/gift-card-sales/offers?product=gift_cards:US:amazon&country=GH`).then(res => res.json());
    assert.deepEqual([ghana.available, ghana.reason], [false, 'country_unsupported']);
    const open = await fetch(`${server.base}/v1/store/gift-card-sales/offers?product=gift_cards:US:amazon&country=NG`).then(res => res.json());
    assert.equal(open.available, true, JSON.stringify(open));
    assert.equal(open.offers.length, 1);
    const [offer] = open.offers;
    // ₦1,200 a dollar less 5%: ₦1,140 (in kobo), never Prestmit's own rate or name.
    assert.deepEqual([offer.rate, offer.currency, offer.minimum, offer.form], [114_000, 'NGN', 25, 'both']);
    assert.doesNotMatch(JSON.stringify(open), /prestmit|1200/i);
    assert.equal((await fetch(`${server.base}/v1/store/gift-card-sales/offers?product=gift_cards:GB:apple&country=NG`).then(res => res.json())).offers[0].name, 'iTunes UK');
    // A synced key with a variant where the brand would be still finds the card by the product's own brand.
    await prisma.product.create({ data: { key: 'gift_cards:US:amazon-us', category: 'gift_cards', country: 'US', brand: 'amazon', name: 'Amazon US', faceCurrency: 'USD', denominationType: 'range', minValueMinor: 500n, maxValueMinor: 50_000n } });
    assert.equal((await fetch(`${server.base}/v1/store/gift-card-sales/offers?product=gift_cards:US:amazon-us&country=NG`).then(res => res.json())).offers[0]?.name, 'Amazon (USA) E-code');
    // The retired country stores never buy cards, nor a store that does not exist (resellers' stores: below).
    assert.equal((await fetch(`${server.base}/v1/store/gift-card-sales/offers?product=gift_cards:US:amazon&country=NG&store=ng`).then(res => res.json())).reason, 'store_unavailable');
    const reseller = await fetch(`${server.base}/v1/store/gift-card-sales/offers?product=gift_cards:US:amazon&country=NG&store=ada-digital`).then(res => res.json());
    assert.deepEqual([reseller.available, reseller.reason], [false, 'store_unavailable']);

    const ada = await customer(server);
    const quote = await ada.post('/v1/store/gift-card-sales/quote', { offer_id: offer.id, amount: 100 });
    assert.deepEqual([quote.status, quote.json.payout], [200, 11_400_000]);
    assert.equal((await ada.post('/v1/store/gift-card-sales/quote', { offer_id: offer.id, amount: 10 })).json.error.code, 'amount_out_of_range');
    const higher = await ada.sell({ offer_id: offer.id, amount: 100, expected_payout: 11_500_000, code: 'ABCD-1234-EFGH' });
    assert.deepEqual([higher.status, higher.json.error.code], [409, 'rate_changed']);
    assert.equal((await ada.sell({ offer_id: offer.id, amount: 100 })).json.error.code, 'photos_required');

    const sold = await ada.sell({ offer_id: offer.id, amount: 100, expected_payout: 11_400_000, code: 'ABCD-1234-EFGH' });
    assert.equal(sold.status, 201, JSON.stringify(sold.json));
    assert.deepEqual([sold.json.status, sold.json.form, sold.json.code_hint, sold.json.quoted, sold.json.paid], ['pending', 'ecode', 'EFGH', 11_400_000, null]);
    assert.doesNotMatch(JSON.stringify(sold.json), /ABCD-1234|prestmit/i);
    // The sandbox never sends a card to Prestmit.
    assert.equal(prestmit.trades.size, 0);
    const wallet = async () => (await prisma.ledgerAccount.findFirst({ where: { kind: 'customer_wallet', customerId: ada.id, mode: 'test', currency: 'NGN' } }))?.balanceMinor ?? 0n;
    assert.equal(await wallet(), 0n);

    const approved = await ada.post(`/v1/store/gift-card-sales/${sold.json.id}/simulate`, { outcome: 'approved' });
    assert.deepEqual([approved.status, approved.json.status, approved.json.paid], [200, 'completed', 11_400_000]);
    assert.equal(await wallet(), 11_400_000n);
    // Prestmit's ₦120,000 into BitoCard's Prestmit float: ₦114,000 to the customer, ₦6,000 to BitoCard.
    const revenue = await prisma.ledgerAccount.findFirst({ where: { kind: 'platform_revenue', mode: 'test', currency: 'NGN' } });
    assert.equal(revenue.balanceMinor, 600_000n);
    assert.equal((await ada.post(`/v1/store/gift-card-sales/${sold.json.id}/simulate`, { outcome: 'approved' })).json.error.code, 'sale_closed');
    assert.equal(await wallet(), 11_400_000n);
    assert.equal((await admin.get('/v1/admin/ledger/check?mode=test')).json.ok, true);

    const photos = await ada.sell({ offer_id: offer.id, amount: 50, photos: [png, png] });
    assert.deepEqual([photos.status, photos.json.form, photos.json.photos], [201, 'physical', 2], JSON.stringify(photos.json));
    const rejected = await ada.post(`/v1/store/gift-card-sales/${photos.json.id}/simulate`, { outcome: 'rejected' });
    assert.deepEqual([rejected.json.status, rejected.json.paid], ['rejected', null]);
    assert.equal(await wallet(), 11_400_000n);

    const listed = await ada.get('/v1/store/gift-card-sales');
    assert.deepEqual(listed.json.data.map(sale => sale.status), ['rejected', 'completed']);
    const other = await customer(server);
    assert.equal((await other.get(`/v1/store/gift-card-sales/${sold.json.id}`)).status, 404);
    const notices = await prisma.notification.findMany({ where: { customerId: ada.id, type: { startsWith: 'customer.gift_card_sale.' } } });
    assert.deepEqual(notices.map(notice => notice.type).sort(), ['customer.gift_card_sale.accepted', 'customer.gift_card_sale.declined']);
  });

  test('buy back on a reseller’s store: BitoCard’s rate less the reseller’s gift card markup (capped), their cut to their earnings', async () => {
    const owner = await resellerClient(server);
    await owner.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, owner.email) });
    await prisma.reseller.update({ where: { id: owner.resellerId }, data: { status: 'active' } });
    await prisma.resellerMarkup.create({ data: { resellerId: owner.resellerId, category: 'gift_cards', markupBps: 800 } });
    const subdomain = `buyback${Date.now().toString(36)}`.slice(0, 30);
    const store = await owner.browser.post('/v1/stores', { name: 'Ada Digital', subdomain });
    assert.equal(store.status, 201, JSON.stringify(store.json));
    assert.equal((await owner.browser.post(`/v1/stores/${store.json.id}/publish`)).status, 200);
    const offersAt = () => fetch(`${server.base}/v1/store/gift-card-sales/offers?product=gift_cards:US:amazon&country=GH&store=${subdomain}`).then(res => res.json());

    // Off by default: the reseller's store buys nothing, and SHQ says why.
    assert.deepEqual([(await offersAt()).available, (await offersAt()).reason], [false, 'store_unavailable']);
    const shq = () => owner.browser.get('/v1/gift-card-sales/buy-back', { 'bitocard-mode': 'test' });
    assert.deepEqual([(await shq()).json.available, (await shq()).json.reason], [false, 'not_enabled']);

    assert.equal((await admin.put('/v1/admin/switches/reseller_gift_card_buyback', { reseller_id: owner.resellerId, enabled: true })).status, 200);
    const open = await offersAt();
    assert.equal(open.available, true, JSON.stringify(open));
    // ₦1,140 a dollar (BitoCard's rate) less the reseller's 8%: ₦1,048.80, in the reseller's currency whatever country was asked.
    assert.deepEqual([open.offers[0].rate, open.offers[0].currency], [104_880, 'NGN']);

    const shopper = await customer(server, 'NG', subdomain);
    const quote = await shopper.post('/v1/store/gift-card-sales/quote', { offer_id: open.offers[0].id, amount: 100 });
    assert.deepEqual([quote.status, quote.json.payout], [200, 10_488_000], JSON.stringify(quote.json));
    const sold = await shopper.sell({ offer_id: open.offers[0].id, amount: 100, expected_payout: 10_488_000, code: 'WXYZ-9876' });
    assert.equal(sold.status, 201, JSON.stringify(sold.json));
    const revenueBefore = (await prisma.ledgerAccount.findFirst({ where: { kind: 'platform_revenue', mode: 'test', currency: 'NGN' } })).balanceMinor;
    const approved = await shopper.post(`/v1/store/gift-card-sales/${sold.json.id}/simulate`, { outcome: 'approved' });
    assert.deepEqual([approved.json.status, approved.json.paid], ['completed', 10_488_000]);
    const balance = async (kind, where) => (await prisma.ledgerAccount.findFirst({ where: { kind, mode: 'test', currency: 'NGN', ...where } }))?.balanceMinor ?? 0n;
    assert.equal(await balance('customer_wallet', { customerId: shopper.id }), 10_488_000n);
    // ₦120,000 from Prestmit: ₦6,000 BitoCard's margin, ₦9,120 the reseller's 8% of the rest, ₦104,880 the customer's.
    assert.equal((await balance('platform_revenue', {})) - revenueBefore, 600_000n);
    assert.equal(await balance('reseller_earnings_held', { resellerId: owner.resellerId }), 912_000n);
    const lot = await prisma.earningsLot.findUnique({ where: { reference: `gift_card_sale:${sold.json.id}` } });
    assert.equal(lot.amountMinor, 912_000n);
    assert.equal((await admin.get('/v1/admin/ledger/check?mode=test')).json.ok, true);

    const seen = (await shq()).json;
    assert.deepEqual([seen.available, seen.spread_bps, seen.cap_bps, seen.currency], [true, 800, 1000, 'NGN']);
    assert.deepEqual(seen.data.map(sale => [sale.status, sale.paid, sale.earned, sale.spread_bps, sale.customer.id]), [['completed', 10_488_000, 912_000, 800, shopper.id]]);
    assert.doesNotMatch(JSON.stringify(seen), /prestmit|margin|"rate"|provider/i);

    // A markup above the cap takes only the cap: 10% unless admins set another.
    await prisma.resellerMarkup.updateMany({ where: { resellerId: owner.resellerId }, data: { markupBps: 3000 } });
    assert.equal((await offersAt()).offers[0].rate, 102_600);
    // Switched off again: nothing more is bought there.
    assert.equal((await admin.put('/v1/admin/switches/reseller_gift_card_buyback', { reseller_id: owner.resellerId, enabled: false })).status, 200);
    assert.equal((await shopper.post('/v1/store/gift-card-sales/quote', { offer_id: open.offers[0].id, amount: 100 })).json.error.code, 'gift_card_selling_unavailable');
  });
});

describe('selling gift cards live', () => {
  let server;
  let admin;
  let prisma;
  let prestmit;

  before(async () => {
    prestmit = fakePrestmit();
    const fake = await prestmit.service;
    prestmit.close = fake.close;
    server = await startApp({
      env: { PRESTMIT_API_KEY: 'pk_live', PRESTMIT_API_SECRET: 'sk_live', PRESTMIT_API_URL: fake.url, PRESTMIT_SELL_MARGIN_PERCENT: '5', PRESTMIT_WEBHOOK_SECRET: 'whsec_live' },
    });
    prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    admin = await adminClient(server);
    assert.equal((await admin.post('/v1/admin/gift-card-sales/offers/sync')).json.mode, 'live');
    assert.equal((await admin.put('/v1/admin/switches/gift_card_selling', { enabled: true })).status, 200);
  });

  after(async () => {
    await server?.close();
    await prestmit?.close();
  });

  test('the identity check first; sent with our reference; credited when Prestmit says it is complete', async () => {
    const { data } = await fetch(`${server.base}/v1/store/gift-card-sales/offers?product=gift_cards:US:amazon&country=NG`).then(res => res.json()).then(body => ({ data: body.offers }));
    const ada = await customer(server);
    const refused = await ada.sell({ offer_id: data[0].id, amount: 100, code: 'LIVE-CODE-0001' });
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'customer_verification_required']);
    const house = await prisma.reseller.findFirstOrThrow({ where: { house: true, country: 'NG' } });
    await prisma.identityVerification.create({
      data: { subject: 'customer', resellerId: house.id, mode: 'live', customerReference: ada.id, method: 'document', provider: 'bitocard', providerReference: `gs-${ada.id}`, status: 'approved', country: 'NG', consentAt: new Date(), verifiedName: 'ADA SELLER' },
    });

    const sold = await ada.sell({ offer_id: data[0].id, amount: 100, code: 'LIVE-CODE-0001' });
    assert.deepEqual([sold.status, sold.json.status], [201, 'pending'], JSON.stringify(sold.json));
    const reference = `bc_gs_${sold.json.id.replace(/-/g, '')}`;
    assert.ok(prestmit.trades.has(reference));

    const wallet = async () => (await prisma.ledgerAccount.findFirst({ where: { kind: 'customer_wallet', customerId: ada.id, mode: 'live', currency: 'NGN' } }))?.balanceMinor ?? 0n;
    // Still pending at Prestmit: nothing yet.
    await prisma.giftCardSale.update({ where: { id: sold.json.id }, data: { nextCheckAt: new Date(0) } });
    const { GiftCardSalesService } = await import('../dist/gift-card-sales/gift-card-sales.service.js');
    const service = server.app.get(GiftCardSalesService);
    await service.job();
    assert.equal(await wallet(), 0n);

    // A webhook with a bad signature is refused; a good one has the trade read back and credited.
    prestmit.state.history = 'COMPLETED';
    prestmit.state.total = 118_000;
    const body = JSON.stringify({ event: 'giftcard-trade.sell.approved', data: { partnersApiIdentifier: reference, amount: 999_999_999 } });
    const post = signature => fetch(`${server.base}/v1/webhooks/prestmit`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-prestmit-signature': signature }, body });
    assert.equal((await post('bad')).status, 401);
    assert.equal((await post(createHmac('sha256', 'whsec_live').update(body).digest('hex'))).status, 200);
    // Prestmit's own total (₦118,000), less 5%: ₦112,100, never the body's amount.
    assert.equal(await wallet(), 11_210_000n);
    assert.equal((await post(createHmac('sha256', 'whsec_live').update(body).digest('base64'))).status, 200);
    assert.equal(await wallet(), 11_210_000n);
    assert.equal((await ada.get(`/v1/store/gift-card-sales/${sold.json.id}`)).json.paid, 11_210_000);
    assert.equal((await admin.get('/v1/admin/ledger/check?mode=live')).json.ok, true);
  });

  test('a refused card fails at once; an unclear send is looked up before it is decided', async () => {
    const { offers } = await fetch(`${server.base}/v1/store/gift-card-sales/offers?product=gift_cards:US:amazon&country=NG`).then(res => res.json());
    const ada = await customer(server);
    const house = await prisma.reseller.findFirstOrThrow({ where: { house: true, country: 'NG' } });
    await prisma.identityVerification.create({
      data: { subject: 'customer', resellerId: house.id, mode: 'live', customerReference: ada.id, method: 'document', provider: 'bitocard', providerReference: `gs2-${ada.id}`, status: 'approved', country: 'NG', consentAt: new Date(), verifiedName: 'ADA SELLER' },
    });
    prestmit.state.createStatus = 422;
    const refused = await ada.sell({ offer_id: offers[0].id, amount: 30, code: 'BAD-CODE-0001' });
    assert.deepEqual([refused.status, refused.json.status], [201, 'failed']);

    prestmit.state.createStatus = 503;
    const unclear = await ada.sell({ offer_id: offers[0].id, amount: 30, code: 'SLOW-CODE-0001' });
    assert.equal(unclear.json.status, 'pending');
    const { GiftCardSalesService } = await import('../dist/gift-card-sales/gift-card-sales.service.js');
    const service = server.app.get(GiftCardSalesService);
    // Prestmit has no trade under our reference: kept waiting at first, failed only once it is long enough ago.
    await prisma.giftCardSale.update({ where: { id: unclear.json.id }, data: { nextCheckAt: new Date(0) } });
    await service.job();
    assert.equal((await prisma.giftCardSale.findUnique({ where: { id: unclear.json.id } })).status, 'submitting');
    await prisma.giftCardSale.update({ where: { id: unclear.json.id }, data: { nextCheckAt: new Date(0), createdAt: new Date(Date.now() - 3_600_000) } });
    await service.job();
    assert.equal((await prisma.giftCardSale.findUnique({ where: { id: unclear.json.id } })).status, 'failed');
    prestmit.state.createStatus = 200;
  });

  test('switching Prestmit to sandbox closes live selling even with previously synced live offers', async () => {
    const path = '/v1/store/gift-card-sales/offers?product=gift_cards:US:amazon&country=NG';
    const shopper = await customer(server);
    const before = await shopper.get(path);
    assert.ok(before.json.offers.length > 0);
    const saved = await admin.put('/v1/admin/integrations/prestmit', { values: { PRESTMIT_SANDBOX: true }, code: await adminCode(server, admin) });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const closed = await shopper.get(path);
    assert.deepEqual([closed.json.available, closed.json.reason], [false, 'not_configured']);
    const sale = await shopper.sell({ offer_id: before.json.offers[0].id, amount: 100, code: 'DO-NOT-SEND' });
    assert.deepEqual([sale.status, sale.json.error.code], [409, 'gift_card_selling_unavailable']);
    assert.equal(await prisma.giftCardSale.count({ where: { customerId: shopper.id } }), 0);
  });
});
