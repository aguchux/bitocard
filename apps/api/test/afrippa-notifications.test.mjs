// A trader's inbox on Afrippa's site (docs/CRYPTO_SPINOFF_PLAN.md, step 4): `/v1/afrippa/account/notifications`, the
// notices Afrippa leaves a trader, their own only, through Afrippa's signed server, past two-step.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, afrippaAdminClient, startApp } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { afrippaStoreId } = await import('../dist/afrippa/ids.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');
const { InboxService } = await import('../dist/notifications/inbox.service.js');

const secret = 'afrippa-inbox-secret-afrippa-inbox-secret-ab';
let server;
let prisma;
let counter = 0;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret } });
  prisma = server.app.get(PrismaService);
});

after(async () => {
  await server?.close();
});

function afrippaServer(token = null, { signed = true } = {}) {
  const request = async (method, path, body) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(signed ? { 'afrippa-signature': signAfrippaRequest(secret, { method, url: path, body: raw }) } : {}),
        ...(raw !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `inbox-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), token: () => token };
}

const lastCodeTo = email => /\b(\d{6})\b/.exec(server.app.get(EmailService).outbox.filter(item => item.to === email).at(-1).subject)[1];

/** A trader signed in past two-step. */
async function trader() {
  const client = afrippaServer();
  const email = `inbox-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name: 'Ada Trader', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  return { client, id: signup.json.customer.id };
}

describe("a trader's inbox", () => {
  test('lists their own notices, counts the unread, and marks them read', async () => {
    const ada = await trader();
    const bola = await trader();
    const inbox = server.app.get(InboxService);
    // Notices the account itself left (the two-step changes) are there too; start from read.
    assert.equal((await ada.client.post('/v1/afrippa/account/notifications/read-all')).status, 200);
    await inbox.customer({ customerId: ada.id, storeId: afrippaStoreId }, 'customer.p2p.order_paid', { subject: 'test:1', title: 'The buyer paid', body: 'Check your account.', link: '/orders/1' });

    const listed = await ada.client.get('/v1/afrippa/account/notifications?unread=true');
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    assert.deepEqual(
      listed.json.data.map(item => [item.title, item.link, item.read]),
      [['The buyer paid', '/orders/1', false]],
    );
    assert.equal((await ada.client.get('/v1/afrippa/account/notifications/unread-count')).json.count, 1);

    const id = listed.json.data[0].id;
    // Another trader's notice is not found; nothing about it is told.
    assert.equal((await bola.client.post(`/v1/afrippa/account/notifications/${id}/read`)).status, 404);
    assert.equal((await bola.client.get('/v1/afrippa/account/notifications')).json.data.some(item => item.id === id), false);

    assert.equal((await ada.client.post(`/v1/afrippa/account/notifications/${id}/read`)).status, 200);
    assert.equal((await ada.client.get('/v1/afrippa/account/notifications/unread-count')).json.count, 0);
  });

  test('only through Afrippa’s signed server, and never on a session still finishing two-step', async () => {
    const ada = await trader();
    const unsigned = afrippaServer(ada.client.token(), { signed: false });
    assert.equal((await unsigned.get('/v1/afrippa/account/notifications')).status, 404);

    const pending = afrippaServer();
    const email = `inbox-pending-${Date.now()}@example.com`;
    assert.equal((await pending.post('/v1/afrippa/account/signup', { name: 'New Trader', email, password: 'correct horse battery', country: 'NG' })).status, 201);
    const refused = await pending.get('/v1/afrippa/account/notifications');
    assert.equal(refused.status, 401);
    assert.equal(refused.json.error.code, 'mfa_required');
  });
});

describe("Afrippa's admins' inbox", () => {
  test('Afrippa notices reach only its own admins, by role; BitoCard notices only BitoCard admins', async () => {
    const inbox = server.app.get(InboxService);
    const operations = await afrippaAdminClient(server, ['operations']);
    const finance = await afrippaAdminClient(server, ['finance']);
    const bitocard = await adminClient(server, ['super_admin']);
    await inbox.afrippaAdmins('admin.p2p.order_appealed', { subject: 'order:test', title: 'ORD-000001 appealed', body: 'The buyer appealed.', link: '/orders/x', mode: 'test' });
    await inbox.afrippaAdmins('admin.crypto.custody_shortfall', { subject: 'shortfall:test', title: 'USDT short', body: 'Custody is short.', link: '/crypto' });
    await inbox.admins('admin.reseller.signed_up', { subject: 'reseller:test', title: 'New reseller', body: 'A reseller signed up.' });

    const titles = async client => (await client.get('/v1/afrippa/admin/notifications')).json.data.map(item => item.title).sort();
    assert.deepEqual(await titles(operations), ['ORD-000001 appealed', 'USDT short']);
    assert.deepEqual(await titles(finance), ['USDT short'], 'appeals are for operations and support');
    const theirs = (await bitocard.get('/v1/admin/notifications')).json.data.map(item => item.title);
    assert.ok(theirs.includes('New reseller'));
    assert.ok(!theirs.includes('USDT short') && !theirs.includes('ORD-000001 appealed'), "BitoCard's admins never see Afrippa's");

    assert.equal((await operations.get('/v1/afrippa/admin/notifications/unread-count')).json.count, 2);
    assert.equal((await operations.post('/v1/afrippa/admin/notifications/read-all', {})).status, 200);
    assert.equal((await operations.get('/v1/afrippa/admin/notifications/unread-count')).json.count, 0);
    // Neither realm reaches the other's inbox.
    assert.ok([401, 403].includes((await operations.get('/v1/admin/notifications')).status));
    assert.ok([401, 403].includes((await bitocard.get('/v1/afrippa/admin/notifications')).status));
  });
});
