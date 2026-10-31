// An Afrippa order's room (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 5): the buyer and seller write and send receipts
// (sealed in Afrippa's own private bucket, never BitoCard's), the system adds a line at every step, Afrippa's team reads
// every room and writes in open ones as "Afrippa", the room is read-only once the order closes, and the deadline
// reminders go out once each.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, afrippaAdminClient, fakeService, startApp, withTwoStepCode } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-room-secret-afrippa-room-secret-afr';
let server;
let prisma;
let afrippaBucket;
let bitocardBucket;
let operations;
let counter = 0;

/** A fake Spaces bucket, keeping each object as it was stored. */
function bucket() {
  const objects = new Map();
  return fakeService(call => {
    const key = decodeURIComponent(new URL(call.url, 'http://x').pathname);
    if (call.method === 'PUT') {
      objects.set(key, { body: call.raw, acl: call.headers['x-amz-acl'] });
      return { status: 200, body: '' };
    }
    if (call.method === 'GET') return objects.has(key) ? { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: objects.get(key).body } : { status: 404, body: '' };
    return { status: 405, body: '' };
  }).then(service => Object.assign(service, { objects }));
}

before(async () => {
  afrippaBucket = await bucket();
  bitocardBucket = await bucket();
  // BitoCard's own private bucket, from the environment: never Afrippa's.
  server = await startApp({
    env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret, CRON_SECRET: 'cron-secret', KYC_SPACES_KEY: 'bc-key', KYC_SPACES_SECRET: 'bc-secret', KYC_SPACES_BUCKET: 'bitocard-private', KYC_SPACES_ENDPOINT: bitocardBucket.url },
  });
  prisma = server.app.get(PrismaService);
  for (const key of ['crypto_wallets', 'p2p_trading']) {
    await prisma.featureSwitch.create({ data: { key, enabled: true } });
    await prisma.featureSwitch.create({ data: { key, countryCode: 'NG', enabled: true } });
  }
  await prisma.cryptoAsset.update({ where: { code: 'USDT' }, data: { enabled: true, p2pFeeBps: 0 } });
  operations = await afrippaAdminClient(server, ['super_admin']);
});

after(async () => {
  await server?.close();
  await afrippaBucket?.close();
  await bitocardBucket?.close();
});

function afrippaServer(token = null) {
  const request = async (method, path, body) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        'afrippa-signature': signAfrippaRequest(secret, { method, url: path, body: raw }),
        ...(raw !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `room-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const isJson = (res.headers.get('content-type') ?? '').includes('json');
    const bytes = Buffer.from(await res.arrayBuffer());
    const json = isJson && bytes.length ? JSON.parse(bytes.toString()) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json, bytes, type: res.headers.get('content-type'), headers: res.headers };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => withTwoStepCode(request, 'POST', path, body) };
}

const lastCodeTo = email => /\b(\d{6})\b/.exec(server.app.get(EmailService).outbox.filter(item => item.to === email).at(-1).subject)[1];

async function trader(name) {
  const client = afrippaServer();
  const email = `room-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  const declaration = await client.get('/v1/afrippa/crypto/declaration');
  assert.equal((await client.post('/v1/afrippa/crypto/declaration', { version: declaration.json.version })).status, 200);
  const added = await client.post('/v1/afrippa/p2p/payment-methods', { kind: 'bank', currency: 'NGN', bank_name: 'Example Bank', account_number: `60${String(counter).padStart(8, '0')}` });
  await prisma.p2pPaymentMethod.update({ where: { id: added.json.id }, data: { usableFrom: new Date(Date.now() - 1000) } });
  return { client, id: signup.json.customer.id, bank: added.json.id };
}

/** A seller's ad and a buyer's order on it. */
async function order() {
  const ada = await trader('Ada Seller');
  const bola = await trader('Bola Buyer');
  assert.equal((await ada.client.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '50' })).status, 201);
  const ad = (await ada.client.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'USDT', currency: 'NGN', price: 165000, amount: '50', min_fiat: 100000, max_fiat: 50000000, payment_method_ids: [ada.bank] })).json;
  const opened = await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: ad.payment_methods[0].id });
  assert.equal(opened.status, 201, JSON.stringify(opened.json));
  return { ada, bola, order: opened.json };
}

function jpeg() {
  const u16 = value => Buffer.from([value >> 8, value & 0xff]);
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPSDATA-LAGOS')]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(exif.length + 2), exif]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x30, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, sos, Buffer.from(`pixels-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
}

describe("An Afrippa order's room", () => {
  test('the parties write, the system adds a line at every step, and others cannot read it', async () => {
    const { ada, bola, order: opened } = await order();
    const start = (await bola.client.get(`/v1/afrippa/p2p/orders/${opened.id}/messages`)).json;
    assert.equal(start.open, true);
    assert.equal(start.data[0].from, 'system');
    assert.match(start.data[0].body, /opened/);
    const said = await bola.client.post(`/v1/afrippa/p2p/orders/${opened.id}/messages`, { body: 'Paying from my GTBank account now.' });
    assert.equal(said.status, 201, JSON.stringify(said.json));
    assert.equal(said.json.from, 'you');
    assert.ok(await prisma.notification.findFirst({ where: { customerId: ada.id, type: 'customer.p2p.order_message' } }));
    await bola.client.post(`/v1/afrippa/p2p/orders/${opened.id}/paid`, { payment_method_id: bola.bank });
    const seen = (await ada.client.get(`/v1/afrippa/p2p/orders/${opened.id}/messages`)).json.data;
    assert.deepEqual(seen.map(message => message.from), ['system', 'buyer', 'system']);
    assert.match(seen[2].body, /marked the order paid/);
    // Since the buyer's line, only what came after.
    assert.equal((await ada.client.get(`/v1/afrippa/p2p/orders/${opened.id}/messages?after=${said.json.id}`)).json.data.length, 1);

    const cara = await trader('Cara Other');
    assert.equal((await cara.client.get(`/v1/afrippa/p2p/orders/${opened.id}/messages`)).status, 404);
    assert.equal((await cara.client.post(`/v1/afrippa/p2p/orders/${opened.id}/messages`, { body: 'Hello' })).status, 404);
    assert.equal((await bola.client.post(`/v1/afrippa/p2p/orders/${opened.id}/messages`, { body: '   ' })).status, 400);

    // Once closed, the room is kept but takes no more messages.
    await ada.client.post(`/v1/afrippa/p2p/orders/${opened.id}/release`, { payer_checked: true });
    const closed = (await bola.client.get(`/v1/afrippa/p2p/orders/${opened.id}/messages`)).json;
    assert.equal(closed.open, false);
    assert.match(closed.data.at(-1).body, /released the coins/);
    assert.equal((await bola.client.post(`/v1/afrippa/p2p/orders/${opened.id}/messages`, { body: 'Thanks!' })).json.error.code, 'order_room_closed');
  });

  test("receipts are checked, stripped and sealed in Afrippa's own private bucket, read back by the parties and Afrippa only", async () => {
    const { ada, bola, order: opened } = await order();
    const receipt = { file_name: 'C:\\phone\\receipt.jpg', content_type: 'image/jpeg', data: jpeg().toString('base64'), body: 'My transfer receipt' };
    // Until Afrippa sets its own private bucket, nothing is stored (BitoCard's, from the environment, is never used).
    const unset = await bola.client.post(`/v1/afrippa/p2p/orders/${opened.id}/attachments`, receipt);
    assert.deepEqual([unset.status, unset.json.error.code], [503, 'storage_not_configured']);
    const saved = await operations.put('/v1/afrippa/admin/integrations/kyc_storage', {
      values: { KYC_SPACES_KEY: 'afrippa-key', KYC_SPACES_SECRET: 'afrippa-secret', KYC_SPACES_BUCKET: 'afrippa-private', KYC_SPACES_ENDPOINT: afrippaBucket.url },
      code: await adminCode(server, operations),
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));

    const sent = await bola.client.post(`/v1/afrippa/p2p/orders/${opened.id}/attachments`, receipt);
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    assert.deepEqual([sent.json.file.name, sent.json.file.content_type, sent.json.body], ['receipt.jpg', 'image/jpeg', 'My transfer receipt']);
    assert.equal(afrippaBucket.objects.size, 1);
    assert.equal(bitocardBucket.objects.size, 0);
    const [[key, stored]] = [...afrippaBucket.objects];
    assert.match(key, new RegExp(`/p2p-orders/${opened.id}/${sent.json.id}$`));
    assert.equal(stored.acl, 'private');
    assert.equal(stored.body.includes('GPSDATA'), false, 'sealed');

    const read = await ada.client.get(`/v1/afrippa/p2p/orders/${opened.id}/files/${sent.json.id}`);
    assert.deepEqual([read.status, read.type, read.headers.get('cache-control')], [200, 'image/jpeg', 'no-store, private']);
    assert.equal(read.bytes.includes('GPSDATA'), false, 'stripped of its metadata');
    // The admin client reads JSON; a file is fetched directly with the admin's session.
    const cookie = [...operations.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const admin = await fetch(`${server.base}/v1/afrippa/admin/p2p/orders/${opened.id}/files/${sent.json.id}`, { headers: { cookie } });
    assert.deepEqual([admin.status, admin.headers.get('content-type')], [200, 'image/jpeg']);
    const cara = await trader('Cara Nosy');
    assert.equal((await cara.client.get(`/v1/afrippa/p2p/orders/${opened.id}/files/${sent.json.id}`)).status, 404);

    const script = await bola.client.post(`/v1/afrippa/p2p/orders/${opened.id}/attachments`, { file_name: 'x.png', content_type: 'image/png', data: Buffer.from('<script>alert(1)</script>').toString('base64') });
    assert.deepEqual([script.status, script.json.error.code], [400, 'file_invalid']);
  });

  test("during an appeal Afrippa's team reads the room and writes as Afrippa; BitoCard's admins cannot", async () => {
    const { ada, bola, order: opened } = await order();
    await bola.client.post(`/v1/afrippa/p2p/orders/${opened.id}/paid`, { payment_method_id: bola.bank });
    await ada.client.post(`/v1/afrippa/p2p/orders/${opened.id}/appeal`, { reason: 'Nothing arrived in my account.' });
    const team = await afrippaAdminClient(server, ['support']);
    const room = await team.get(`/v1/afrippa/admin/p2p/orders/${opened.id}/messages`);
    assert.equal(room.status, 200);
    assert.ok(room.json.data.some(message => message.from === 'system' && /appealed, saying: “Nothing arrived/.test(message.body)));
    const wrote = await team.post(`/v1/afrippa/admin/p2p/orders/${opened.id}/messages`, { body: 'Please both send your bank statements for today.' });
    assert.equal(wrote.status, 201, JSON.stringify(wrote.json));
    const seen = (await bola.client.get(`/v1/afrippa/p2p/orders/${opened.id}/messages`)).json.data.at(-1);
    assert.deepEqual([seen.from, seen.body], ['afrippa', 'Please both send your bank statements for today.']);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: ada.id, type: 'customer.p2p.order_message', title: "Afrippa's team wrote in your order" } }));
    const bitocard = await adminClient(server, ['super_admin']);
    assert.equal((await bitocard.get(`/v1/afrippa/admin/p2p/orders/${opened.id}/messages`)).status, 401);
  });

  test('reminders: the buyer near the end of the window, the seller once paid and waiting; each once', async () => {
    const first = await order();
    await prisma.p2pOrder.update({ where: { id: first.order.id }, data: { payBy: new Date(Date.now() + 3 * 60_000) } });
    const second = await order();
    await second.bola.client.post(`/v1/afrippa/p2p/orders/${second.order.id}/paid`, { payment_method_id: second.bola.bank });
    await prisma.p2pOrder.update({ where: { id: second.order.id }, data: { paidAt: new Date(Date.now() - 20 * 60_000) } });
    const cron = () => fetch(`${server.base}/v1/cron/p2p-orders`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
    assert.ok((await cron()).result.reminded >= 2);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: first.bola.id, type: 'customer.p2p.order_reminder' } }), 'the buyer, to pay');
    assert.ok(await prisma.notification.findFirst({ where: { customerId: second.ada.id, type: 'customer.p2p.order_reminder' } }), 'the seller, to release');
    await cron();
    assert.equal(await prisma.notification.count({ where: { customerId: { in: [first.bola.id, second.ada.id] }, type: 'customer.p2p.order_reminder' } }), 2, 'once each');
  });
});
