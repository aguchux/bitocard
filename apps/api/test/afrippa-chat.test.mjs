// Afrippa's live chat (docs/CRYPTO_SPINOFF_PLAN.md, Instruments lifted): a trader's chat goes to Afrippa's own queue
// (`afrippa`), answered by Afrippa's admins only and shown to the trader as "Afrippa"; its files are sealed in Afrippa's
// own private bucket (never BitoCard's); BitoCard's admins never reach it, nor Afrippa's admins BitoCard's chats.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, afrippaAdminClient, fakeService, startApp } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-chat-secret-afrippa-chat-secret-abc';
let server;
let prisma;
let afrippaBucket;
let bitocardBucket;
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
    env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret, KYC_SPACES_KEY: 'bc-key', KYC_SPACES_SECRET: 'bc-secret', KYC_SPACES_BUCKET: 'bitocard-private', KYC_SPACES_ENDPOINT: bitocardBucket.url },
  });
  prisma = server.app.get(PrismaService);
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
        ...(method === 'POST' ? { 'idempotency-key': `chat-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    let json = null;
    try {
      json = bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
    } catch {
      json = null;
    }
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json, bytes, type: res.headers.get('content-type') };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

const lastCodeTo = email => /\b(\d{6})\b/.exec(server.app.get(EmailService).outbox.filter(item => item.to === email).at(-1).subject)[1];

async function trader() {
  const client = afrippaServer();
  const email = `chat-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name: 'Ada Trader', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  return { client, id: signup.json.customer.id };
}

/** A small JPEG with an EXIF block that must not survive. */
function jpeg() {
  const u16 = value => Buffer.from([value >> 8, value & 0xff]);
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPSDATA-ACCRA')]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(exif.length + 2), exif]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x30, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, sos, Buffer.from(`pixels-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
}

describe("Afrippa's live chat", () => {
  test('a trader chats with Afrippa; its admins answer as "Afrippa"; BitoCard never sees it', async () => {
    const ada = await trader();
    const support = await afrippaAdminClient(server, ['support']);
    const bitocard = await adminClient(server, ['super_admin']);

    const started = await ada.client.post('/v1/afrippa/account/support/chat/messages', { body: 'Is my deposit on its way?' });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    const id = started.json.id;
    assert.equal((await prisma.supportConversation.findUniqueOrThrow({ where: { id } })).queue, 'afrippa');
    assert.ok((await support.get('/v1/afrippa/admin/notifications')).json.data.some(item => item.title === 'A trader is waiting in chat' && item.link === `/support/chats/${id}`));
    assert.ok((await support.get('/v1/afrippa/admin/support/chats')).json.data.some(item => item.id === id));

    assert.equal((await bitocard.get('/v1/admin/support/chats')).json.data.some(item => item.id === id), false);
    assert.equal((await bitocard.get(`/v1/admin/support/chats/${id}`)).status, 404);
    assert.equal((await bitocard.post(`/v1/admin/support/chats/${id}/messages`, { body: 'Hi' })).status, 404);

    assert.equal((await support.post(`/v1/afrippa/admin/support/chats/${id}/take`, {})).status, 200);
    const replied = await support.post(`/v1/afrippa/admin/support/chats/${id}/messages`, { body: 'Yes, it needs two more confirmations.' });
    assert.equal(replied.status, 201, JSON.stringify(replied.json));
    assert.equal(replied.json.messages.at(-1).author_name, 'Test Admin', "Afrippa's admins see who wrote");

    const seen = (await ada.client.get('/v1/afrippa/account/support/chat')).json;
    assert.deepEqual([seen.messages.at(-1).author, seen.messages.at(-1).author_name], ['afrippa', null]);
    assert.ok(seen.messages.some(item => item.body === "Afrippa's team joined the chat."));
    const polled = (await ada.client.get(`/v1/afrippa/account/support/chat/${id}/messages`)).json;
    assert.equal(polled.data.at(-1).author_name, null);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: ada.id, type: 'customer.support.chat_replied', link: '/help?chat=1', title: 'Afrippa replied in chat' } }));

    // Turned into a ticket: on Afrippa's queue, its admins told.
    const ticketed = await support.post(`/v1/afrippa/admin/support/chats/${id}/ticket`, { subject: 'Deposit question', category: 'payment' });
    assert.equal(ticketed.status, 200, JSON.stringify(ticketed.json));
    const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketed.json.ticket_id } });
    assert.equal(ticket.queue, 'afrippa');
    assert.match((await prisma.supportTicketMessage.findFirstOrThrow({ where: { ticketId: ticket.id } })).body, /Afrippa \(/);
  });

  test("a trader's files are sealed in Afrippa's own bucket, never BitoCard's, and read only by the trader and Afrippa", async () => {
    const ada = await trader();
    const operations = await afrippaAdminClient(server, ['super_admin']);
    const proof = { file_name: 'receipt.jpg', content_type: 'image/jpeg', data: jpeg().toString('base64'), body: 'My transfer' };
    const unset = await ada.client.post('/v1/afrippa/account/support/chat/attachments', proof);
    assert.deepEqual([unset.status, unset.json.error.code], [503, 'storage_not_configured']);
    const saved = await operations.put('/v1/afrippa/admin/integrations/kyc_storage', {
      values: { KYC_SPACES_KEY: 'afrippa-key', KYC_SPACES_SECRET: 'afrippa-secret', KYC_SPACES_BUCKET: 'afrippa-private', KYC_SPACES_ENDPOINT: afrippaBucket.url },
      code: await adminCode(server, operations),
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));

    const sent = await ada.client.post('/v1/afrippa/account/support/chat/attachments', proof);
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    const file = sent.json.messages.at(-1).attachments[0];
    assert.equal(afrippaBucket.objects.size, 1);
    assert.equal(bitocardBucket.objects.size, 0);
    const [[key]] = [...afrippaBucket.objects];
    assert.match(key, new RegExp(`/chat/${sent.json.id}/${file.id}$`));

    const read = await ada.client.get(`/v1/afrippa/account/support/chat/${sent.json.id}/files/${file.id}`);
    assert.deepEqual([read.status, read.type], [200, 'image/jpeg']);
    assert.equal(read.bytes.includes('GPSDATA'), false, 'stripped of its metadata');
    const cookie = [...operations.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    assert.equal((await fetch(`${server.base}/v1/afrippa/admin/support/chats/${sent.json.id}/files/${file.id}`, { headers: { cookie } })).status, 200);
    const bola = await trader();
    assert.equal((await bola.client.get(`/v1/afrippa/account/support/chat/${sent.json.id}/files/${file.id}`)).status, 404);
  });

  test("Afrippa's admins never reach BitoCard's chats", async () => {
    const support = await afrippaAdminClient(server, ['support']);
    const store = await prisma.store.findFirstOrThrow({ where: { platform: 'bitocard' } });
    const theirs = await prisma.supportConversation.create({ data: { resellerId: store.resellerId, mode: 'test', requester: 'reseller', queue: 'bitocard' } });
    assert.equal((await support.get(`/v1/afrippa/admin/support/chats/${theirs.id}`)).status, 404);
    assert.equal((await support.get('/v1/afrippa/admin/support/chats')).json.data.some(item => item.id === theirs.id), false);
  });
});
