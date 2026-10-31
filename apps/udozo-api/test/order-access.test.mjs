// Order pages: every order has one permanent link to its page, on the store's address. The link only points at the
// order: the page shows it only to the customer who proves it is theirs (signed in at its store, or a code emailed to
// the order's address). Reveal is unlimited for them, recorded, and followed by an email alert at most once a day.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';

const { EmailService } = await import('../dist/notifications/email.service.js');

let server;
let admin;
let prisma;
let wallets;
let visitor;
let product;

const sandbox = { 'bitocard-mode': 'test' };
const tokenOf = url => url.split('/a/')[1];
const outbox = () => server.app.get(EmailService).outbox;
const lastCode = to => outbox().filter(item => item.to === to).at(-1).text.match(/\b\d{6}\b/)[0];
const page = (url, headers = {}) => visitor.get(`/v1/store/access/${tokenOf(url)}`, headers);
const reveal = (url, headers = {}) => visitor.post(`/v1/store/access/${tokenOf(url)}/reveal`, {}, headers);
const sendCode = url => visitor.post(`/v1/store/access/${tokenOf(url)}/code`, {});
const verify = (url, code) => visitor.post(`/v1/store/access/${tokenOf(url)}/verify`, { code });
const withPass = pass => ({ 'bitocard-access-pass': pass });

before(async () => {
  server = await startApp();
  admin = await adminClient(server);
  visitor = client(server.base, { autoIdempotency: true });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  await prisma.countryCategory.upsert({
    where: { countryCode_category: { countryCode: 'NG', category: 'software' } },
    create: { countryCode: 'NG', category: 'software', enabled: true },
    update: { enabled: true },
  });
  const created = await admin.post('/v1/admin/stock', {
    category: 'software',
    brand: 'Microsoft',
    duration_months: 12,
    title: 'Access Page Suite',
    description: 'One PC.',
    redeem_instructions: 'Sign in and enter the key.',
    currency: 'USD',
    face_value: 2999,
    cost: 1500,
    listed: true,
    codes: [{ code: 'ACCESS-KEY-0001' }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  product = created.json.product;
});

after(async () => {
  await server?.close();
});

async function funded() {
  const reseller = await resellerClient(server);
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
  for (const mode of ['live', 'test']) await wallets.adjust(null, { resellerId: reseller.resellerId, mode, balance: 'funding', amount: 500_000_000, reason: 'Test funding' });
  return reseller;
}

let emails = 0;
async function order({ email = true } = {}) {
  const { browser } = await funded();
  const to = `access-${(emails += 1)}-${Date.now()}@example.com`;
  const quote = (await browser.post('/v1/quotes', { product_id: product.id, face_value: 2999, ...(email ? { recipient: { email: to } } : {}) }, sandbox)).json;
  const placed = await browser.post('/v1/orders', { quote_id: quote.id }, sandbox);
  assert.equal(placed.status, 201, JSON.stringify(placed.json));
  return { ...placed.json, browser, to };
}

/** An order whose customer has proved it is theirs with the emailed code: its pass. */
async function passFor(placed) {
  assert.equal((await sendCode(placed.access.url)).status, 200);
  const verified = await verify(placed.access.url, lastCode(placed.to));
  assert.equal(verified.status, 200, JSON.stringify(verified.json));
  return verified.json.pass;
}

describe('order links', () => {
  test('every order has one permanent link, only on the single order', async () => {
    const placed = await order();
    assert.match(placed.access.url, /^https:\/\/bitocard\.com\/a\/bca_[\w-]{43}$/, 'no hosted store: BitoCard’s neutral page');
    assert.equal((await placed.browser.get(`/v1/orders/${placed.id}`, sandbox)).json.access.url, placed.access.url, 'the same link every time');
    assert.equal((await placed.browser.get('/v1/orders', sandbox)).json.data.find(item => item.id === placed.id).access, undefined, 'never in lists');
    const stored = await prisma.orderAccess.findUniqueOrThrow({ where: { orderId: placed.id } });
    assert.ok(!stored.tokenEncrypted.includes(tokenOf(placed.access.url)) && stored.tokenHash !== tokenOf(placed.access.url), 'only a hash and an encrypted copy');
    assert.ok(outbox().filter(item => item.to === placed.to).at(-1).text.includes(placed.access.url), 'the delivery email carries it');
  });

  test('on a published hosted store, the link is on the store’s own address', async () => {
    const reseller = await funded();
    const subdomain = `access${Date.now().toString(36)}`;
    await prisma.store.create({ data: { resellerId: reseller.resellerId, name: 'Access Shop', subdomain, status: 'published', publishedAt: new Date() } });
    const quote = (await reseller.browser.post('/v1/quotes', { product_id: product.id, face_value: 2999 }, sandbox)).json;
    const placed = (await reseller.browser.post('/v1/orders', { quote_id: quote.id }, sandbox)).json;
    assert.ok(placed.access.url.startsWith(`https://${subdomain}.bitocard.com/a/bca_`), placed.access.url);
    assert.deepEqual((await page(placed.access.url)).json.store, { name: 'Access Shop', subdomain, logo_url: null, primary_color: '#070f4c' });
  });
});

describe('proving the order is yours', () => {
  test('the link alone shows nothing but the store and how to prove it', async () => {
    const placed = await order();
    const shown = await page(placed.access.url);
    assert.equal(shown.status, 200);
    assert.equal(shown.res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(shown.json.access, { method: 'email', verified: false, email_hint: `a***@example.com` });
    assert.equal(shown.json.order, null);
    assert.ok(!JSON.stringify(shown.json).includes(product.name) && !JSON.stringify(shown.json).includes(placed.to), 'not even the product or the address');
    assert.deepEqual([(await reveal(placed.access.url)).status, (await reveal(placed.access.url)).json.error.code], [401, 'access_required']);
    assert.equal((await visitor.get('/v1/store/access/bca_not-a-real-token')).status, 404);
  });

  test('an emailed code gives a pass: the order shows, codes on Reveal, and the customer is alerted once a day', async () => {
    const placed = await order();
    const sent = await sendCode(placed.access.url);
    assert.deepEqual([sent.json.object, sent.json.email_hint], ['order_access_code', 'a***@example.com']);
    assert.equal((await sendCode(placed.access.url)).json.error.code, 'code_recently_sent');
    assert.equal((await verify(placed.access.url, '000000')).json.error.code === 'code_invalid' || lastCode(placed.to) === '000000', true);
    const verified = await verify(placed.access.url, lastCode(placed.to));
    assert.equal(verified.status, 200, JSON.stringify(verified.json));
    assert.equal((await verify(placed.access.url, lastCode(placed.to))).json.error.code, 'code_invalid', 'single use');

    const shown = (await page(placed.access.url, withPass(verified.json.pass))).json;
    assert.deepEqual([shown.access.verified, shown.order.product.name, shown.order.deliveries[0].hidden, shown.order.deliveries[0].code], [true, product.name, true, null]);
    assert.ok(!/stock|supplier|reseller_id|wholesale/i.test(JSON.stringify(shown)), 'never the source, ids or costs');

    const alerts = () => outbox().filter(item => item.to === placed.to && /were viewed/.test(item.subject)).length;
    const first = await reveal(placed.access.url, withPass(verified.json.pass));
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.deepEqual([first.json.order.deliveries[0].hidden, first.json.order.deliveries[0].code], [false, placed.deliveries[0].code]);
    const again = await reveal(placed.access.url, withPass(verified.json.pass));
    assert.equal(again.json.order.deliveries[0].code, placed.deliveries[0].code, 'reveal as often as needed');
    assert.equal(again.json.order.revealed_at, first.json.order.revealed_at, 'the first reveal is kept');
    assert.equal(alerts(), 1, 'alerted once a day, not on every reveal');
    assert.equal((await placed.browser.get(`/v1/orders/${placed.id}`, sandbox)).json.access.revealed_at, first.json.order.revealed_at, 'the reseller sees it');
    assert.equal(await prisma.idempotencyKey.count({ where: { path: { contains: '/v1/store/access/' } } }), 0, 'codes and passes are never stored for replay');
  });

  test('a pass opens only its order, until the link is replaced; tampered passes are refused', async () => {
    const one = await order();
    const two = await order();
    const pass = await passFor(one);
    assert.equal((await page(two.access.url, withPass(pass))).json.order, null, 'another order');
    const [payload, signature] = pass.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), e: 9_999_999_999 })).toString('base64url')}.${signature}`;
    assert.equal((await page(one.access.url, withPass(forged))).json.order, null, 'a changed pass');

    const replaced = (await one.browser.post(`/v1/orders/${one.id}/access/replace`, {}, sandbox)).json;
    assert.equal((await page(one.access.url)).status, 404, 'the old link stops working');
    assert.equal((await page(replaced.url, withPass(pass))).json.order, null, 'and so does every pass made with it');
  });

  test('code limits: parallel guesses get five tries, and at most ten codes a day', async () => {
    const placed = await order();
    await sendCode(placed.access.url);
    const code = lastCode(placed.to);
    const wrong = code === '000000' ? '111111' : '000000';
    const guesses = await Promise.all(Array.from({ length: 12 }, () => verify(placed.access.url, wrong)));
    assert.equal(guesses.filter(guess => guess.json.error.code === 'code_invalid').length, 5);
    assert.equal((await verify(placed.access.url, code)).json.error.code, 'code_attempts_exceeded');

    await prisma.orderAccessCode.updateMany({ where: { orderId: placed.id }, data: { createdAt: new Date(Date.now() - 2 * 60_000) } });
    for (let n = 0; n < 9; n += 1) await prisma.orderAccessCode.create({ data: { orderId: placed.id, codeHash: 'x', expiresAt: new Date(), createdAt: new Date(Date.now() - (n + 3) * 60_000) } });
    assert.equal((await sendCode(placed.access.url)).json.error.code, 'too_many_codes');
  });

  test('orders with no email and no store account show nothing; the store has their codes', async () => {
    const placed = await order({ email: false });
    const shown = (await page(placed.access.url)).json;
    assert.deepEqual([shown.access.method, shown.access.verified, shown.order], ['none', false, null]);
    assert.equal((await sendCode(placed.access.url)).json.error.code, 'access_code_unavailable');
    assert.equal((await reveal(placed.access.url)).status, 401);
  });

  test('a store customer’s order opens only for them, signed in', async () => {
    const placed = await order({ email: false });
    const signup = async name => {
      const res = await visitor.post('/v1/store/account/signup', { name, email: `${name}-${Date.now()}@example.com`, password: 'correct horse battery', country: 'NG' });
      assert.equal(res.status, 201, JSON.stringify(res.json));
      return res.json;
    };
    const buyer = await signup('buyer');
    const stranger = await signup('stranger');
    await prisma.order.update({ where: { id: placed.id }, data: { customerId: buyer.customer.id } });
    const as = session => ({ 'bitocard-customer-session': session });

    const signedOut = (await page(placed.access.url)).json;
    assert.deepEqual([signedOut.access.method, signedOut.access.verified, signedOut.order], ['customer', false, null]);
    assert.equal((await page(placed.access.url, as(stranger.session.token))).json.order, null, 'another customer');
    const mine = (await page(placed.access.url, as(buyer.session.token))).json;
    assert.deepEqual([mine.access.verified, mine.order.product.name], [true, product.name]);
    assert.equal((await reveal(placed.access.url, as(buyer.session.token))).json.order.deliveries[0].code, placed.deliveries[0].code);
    assert.ok(outbox().some(item => item.to === buyer.customer.email && /were viewed/.test(item.subject)), 'the alert goes to their account email');
    assert.equal((await sendCode(placed.access.url)).json.error.code, 'access_code_unavailable', 'they sign in instead');
  });

  test('a refunded order’s codes are not shown', async () => {
    const placed = await order();
    const pass = await passFor(placed);
    await prisma.order.update({ where: { id: placed.id }, data: { status: 'refunded' } });
    const revealed = await reveal(placed.access.url, withPass(pass));
    assert.deepEqual([revealed.json.order.status, revealed.json.order.deliveries], ['refunded', []]);
  });
});
