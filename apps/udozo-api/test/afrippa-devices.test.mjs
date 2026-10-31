// Afrippa's device checks (docs/CRYPTO_SPINOFF_PLAN.md, fraud controls; step 4): afrippa.com sends each browser's random
// device ID with its signed requests; the API keeps only a keyed hash per trader, tells a trader of a sign-in from a new
// device, refuses an order between two traders who used one device, and refuses a fourth account from one device.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { afrippaAdminClient, startApp, withTwoStepCode } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-device-secret-afrippa-device-secret';
let server;
let prisma;
let counter = 0;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret } });
  prisma = server.app.get(PrismaService);
  for (const key of ['crypto_wallets', 'p2p_trading']) {
    await prisma.featureSwitch.create({ data: { key, enabled: true } });
    await prisma.featureSwitch.create({ data: { key, countryCode: 'NG', enabled: true } });
  }
  await prisma.cryptoAsset.update({ where: { code: 'USDT' }, data: { enabled: true, p2pFeeBps: 0 } });
});

after(async () => {
  await server?.close();
});

const newDevice = () => `afd_${randomBytes(32).toString('base64url')}`;

/** afrippa.com's server for one browser: its device ID with every request. */
function afrippaServer(device, token = null) {
  const request = async (method, path, body) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        'afrippa-signature': signAfrippaRequest(secret, { method, url: path, body: raw }),
        ...(device ? { 'afrippa-device': device } : {}),
        ...(raw !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `device-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => withTwoStepCode(request, 'POST', path, body), token: () => token };
}

const outbox = () => server.app.get(EmailService).outbox;
const lastCodeTo = email => /\b(\d{6})\b/.exec(outbox().filter(item => item.to === email).at(-1).subject)[1];

/** A trader signed up and through two-step on `device`. */
async function trader(device, name = 'Ada Trader') {
  const client = afrippaServer(device);
  const email = `device-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  if (signup.status !== 201) return { signup };
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  return { signup, client, id: signup.json.customer.id, email };
}

describe("Afrippa's device checks", () => {
  test('only a hash is kept; a sign-in from a new device tells the trader, a known one does not', async () => {
    const home = newDevice();
    const ada = await trader(home);
    const rows = await prisma.traderDevice.findMany({ where: { customerId: ada.id } });
    assert.equal(rows.length, 1);
    assert.match(rows[0].deviceHash, /^[0-9a-f]{64}$/);
    assert.notEqual(rows[0].deviceHash, home, 'never the ID itself');

    const alerts = () => outbox().filter(item => item.to === ada.email && /new device/i.test(item.subject)).length;
    assert.equal(alerts(), 0, 'signing up is not an alert');
    const again = afrippaServer(home);
    assert.equal((await again.post('/v1/afrippa/account/signin', { email: ada.email, password: 'correct horse battery' })).status, 200);
    assert.equal(alerts(), 0, 'a known device');

    const phone = afrippaServer(newDevice());
    assert.equal((await phone.post('/v1/afrippa/account/signin', { email: ada.email, password: 'correct horse battery' })).status, 200);
    assert.equal(alerts(), 1);
    const notice = await prisma.notification.findFirst({ where: { customerId: ada.id, type: 'customer.security.new_device' } });
    assert.equal(notice.link, '/security');
    assert.equal(await prisma.traderDevice.count({ where: { customerId: ada.id } }), 2);

    // No device ID (another client): never refused for that alone, and nothing recorded.
    assert.equal((await afrippaServer(null).post('/v1/afrippa/account/signin', { email: ada.email, password: 'correct horse battery' })).status, 200);
    assert.equal(await prisma.traderDevice.count({ where: { customerId: ada.id } }), 2);
  });

  test('a fourth account from one device within 30 days is refused', async () => {
    const shared = newDevice();
    for (let i = 0; i < 3; i += 1) assert.equal((await trader(shared, `Trader ${i}`)).signup.status, 201);
    const fourth = await trader(shared, 'Trader 3');
    assert.deepEqual([fourth.signup.status, fourth.signup.json.error.code], [429, 'device_limit']);
    assert.equal((await trader(newDevice(), 'Trader 4')).signup.status, 201, 'another device is fine');
  });

  test('an order between two traders who used one device is refused as the same person; admins see who shared it', async () => {
    const seller = await trader(newDevice(), 'Ada Seller');
    const laptop = newDevice();
    const buyer = await trader(laptop, 'Bola Buyer');
    for (const one of [seller, buyer]) {
      const declaration = await one.client.get('/v1/afrippa/crypto/declaration');
      assert.equal((await one.client.post('/v1/afrippa/crypto/declaration', { version: declaration.json.version })).status, 200);
    }
    const bank = await seller.client.post('/v1/afrippa/p2p/payment-methods', { kind: 'bank', currency: 'NGN', bank_name: 'Example Bank', account_number: `70${String(counter).padStart(8, '0')}` });
    await prisma.p2pPaymentMethod.update({ where: { id: bank.json.id }, data: { usableFrom: new Date(Date.now() - 1000) } });
    assert.equal((await seller.client.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '50' })).status, 201);
    const ad = (await seller.client.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'USDT', currency: 'NGN', price: 165000, amount: '50', min_fiat: 100000, max_fiat: 50000000, payment_method_ids: [bank.json.id] })).json;
    const take = client => client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: ad.payment_methods[0].id, preview: true });
    assert.equal((await take(buyer.client)).status, 201, 'different devices: allowed');

    // The seller signs in on the buyer's laptop: now they shared a device.
    const sameLaptop = afrippaServer(laptop);
    assert.equal((await sameLaptop.post('/v1/afrippa/account/signin', { email: seller.email, password: 'correct horse battery' })).status, 200);
    const refused = await take(buyer.client);
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'same_person']);

    const operations = await afrippaAdminClient(server, ['operations']);
    const devices = (await operations.get(`/v1/afrippa/admin/traders/${buyer.id}/devices`)).json.data;
    assert.ok(devices.some(device => device.shared_with.some(other => other.id === seller.id)));
    assert.ok(!JSON.stringify(devices).includes(laptop), 'never the ID');
  });
});
