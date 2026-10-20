// Live chat, continued: signed-out visitors chat with a store after giving their name and email (the store answers,
// BitoCard monitors bitocard.com's), files sent in chats are checked, stripped, sealed in the private bucket and read
// back only by the chat's own side, and everyone sees the name of the person who answered.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, appOrigin, fakeService, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;
let bucket;
let counter = 0;
const objects = new Map();

before(async () => {
  bucket = await fakeService(call => {
    const key = decodeURIComponent(new URL(call.url, 'http://x').pathname);
    if (call.method === 'PUT') {
      objects.set(key, { body: call.raw, acl: call.headers['x-amz-acl'] });
      return { status: 200, body: '' };
    }
    if (call.method === 'GET') return objects.has(key) ? { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: objects.get(key).body } : { status: 404, body: '' };
    if (call.method === 'DELETE') {
      objects.delete(key);
      return { status: 204, body: '' };
    }
    return { status: 405, body: '' };
  });
  server = await startApp({ env: { KYC_SPACES_KEY: 'kyc-key', KYC_SPACES_SECRET: 'kyc-secret', KYC_SPACES_BUCKET: 'kyc-private', KYC_SPACES_ENDPOINT: bucket.url } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
});

after(async () => {
  await server?.close();
  await bucket?.close();
});

/** A minimal JPEG carrying an EXIF block (which must never be stored). */
function jpeg(tag = 'GPSDATA-LAGOS') {
  const u16 = value => Buffer.from([value >> 8, value & 0xff]);
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from(tag)]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(exif.length + 2), exif]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x30, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, sos, Buffer.from(`pixels-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
}
const pdf = () => Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');

/** The store's server: a customer session or a visitor token, and the store it names. */
function storeServer(subdomain = null) {
  const state = { token: null, visitor: null };
  const headers = method => ({
    ...(subdomain ? { 'bitocard-store': subdomain } : {}),
    ...(state.token ? { 'bitocard-customer-session': state.token } : {}),
    ...(state.visitor ? { 'bitocard-chat-visitor': state.visitor } : {}),
    ...(method === 'POST' ? { 'idempotency-key': `store-${Date.now()}-${Math.random()}` } : {}),
  });
  const request = async (method, path, { body, form } = {}) => {
    const res = await fetch(`${server.base}${path}`, { method, headers: { ...headers(method), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), type, headers: res.headers };
    const json = await res.json();
    if (json?.session?.token) state.token = json.session.token;
    if (json?.token) state.visitor = json.token;
    return { status: res.status, json };
  };
  return {
    state,
    get: path => request('GET', path),
    post: (path, body = {}) => request('POST', path, { body }),
    upload: (path, bytes, type, name, caption) => {
      const form = new FormData();
      if (caption) form.set('body', caption);
      form.set('file', new Blob([bytes], { type }), name);
      return request('POST', path, { form });
    },
  };
}

/** A multipart upload from a signed-in console (SHQ or admin) with its cookies. */
async function consoleUpload(browser, path, bytes, type, name) {
  const form = new FormData();
  form.set('file', new Blob([bytes], { type }), name);
  const cookie = [...browser.jar].map(([key, value]) => `${key}=${value}`).join('; ');
  const res = await fetch(`${server.base}${path}`, { method: 'POST', headers: { cookie, origin: appOrigin, 'idempotency-key': `up-${Math.random()}` }, body: form });
  return { status: res.status, json: await res.json() };
}

async function consoleGet(browser, path) {
  const cookie = [...browser.jar].map(([key, value]) => `${key}=${value}`).join('; ');
  const res = await fetch(`${server.base}${path}`, { headers: { cookie } });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') };
}

async function resellerStore() {
  const reseller = await resellerClient(server);
  await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
  const subdomain = `vis${(counter += 1)}${Date.now().toString(36)}`.slice(0, 30);
  const created = await reseller.browser.post('/v1/stores', { name: 'Ada Digital', subdomain });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal((await reseller.browser.post(`/v1/stores/${created.json.id}/publish`)).status, 200);
  assert.equal((await reseller.browser.patch(`/v1/stores/${created.json.id}`, { checkout_mode: 'live' })).status, 200);
  return { ...reseller, subdomain };
}

async function customer(subdomain) {
  const shopper = storeServer(subdomain);
  const email = `filer${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chidi Okafor', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  return shopper;
}

describe('visitors', () => {
  test('a visitor gives name and email, the store sees and answers them by name, and the visitor is emailed once', async () => {
    const store = await resellerStore();
    const visitor = storeServer(store.subdomain);
    const empty = await visitor.get('/v1/store/support/visitor-chat');
    assert.deepEqual([empty.status, empty.json.chat, empty.json.visitor], [200, null, null]);
    assert.equal((await visitor.post('/v1/store/support/visitor-chat/messages', { body: 'Hello' })).json.error.code, 'visitor_unknown', 'no token: name and email first');
    assert.equal((await visitor.post('/v1/store/support/visitor-chat', { name: 'Ngozi', email: 'not-an-email', body: 'Hi' })).status, 400);

    const started = await visitor.post('/v1/store/support/visitor-chat', { name: 'Ngozi Eze', email: 'Ngozi@Example.com', body: 'Do you sell Steam cards?' });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.match(started.json.token, /^bcv_[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(started.json.visitor, { name: 'Ngozi Eze', email: 'ngozi@example.com' });
    assert.equal(started.json.chat.status, 'waiting');
    const row = await prisma.supportVisitor.findFirstOrThrow({ where: { email: 'ngozi@example.com' } });
    assert.notEqual(row.tokenHash, started.json.token, 'only the token’s hash is kept');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'support.chat_waiting', resellerId: store.resellerId, title: 'A visitor is waiting in chat' } }));

    const inbox = (await store.browser.get('/v1/support/chats')).json.data;
    assert.deepEqual(inbox.map(chat => [chat.id, chat.requester_name, chat.visitor]), [[started.json.chat.id, 'Ngozi Eze', { name: 'Ngozi Eze', email: 'ngozi@example.com' }]]);
    await store.browser.post(`/v1/support/chats/${started.json.chat.id}/take`);
    await store.browser.post(`/v1/support/chats/${started.json.chat.id}/messages`, { body: 'Yes, from $10.' });
    await store.browser.post(`/v1/support/chats/${started.json.chat.id}/messages`, { body: 'Anything else?' });
    const seen = (await visitor.get('/v1/store/support/visitor-chat')).json;
    assert.deepEqual(seen.visitor, { name: 'Ngozi Eze', email: 'ngozi@example.com' });
    assert.deepEqual(seen.chat.messages.slice(-2).map(message => [message.author, message.author_name]), [['reseller', 'Ada Obi'], ['reseller', 'Ada Obi']], 'the visitor sees who answered');
    const emails = server.app.get((await import('../dist/notifications/email.service.js')).EmailService).outbox.filter(mail => mail.to === 'ngozi@example.com');
    assert.equal(emails.length, 1, 'emailed once for the two replies');
    assert.match(emails[0].text, new RegExp(`${store.subdomain}\\.[^/]+/\\?chat=1`));

    const again = await visitor.post('/v1/store/support/visitor-chat', { name: 'Ngozi E.', email: 'ngozi@example.com', body: 'One more' });
    assert.deepEqual([again.json.token, again.json.chat.id], [null, started.json.chat.id], 'the same browser keeps its identity and chat');
    assert.equal((await store.browser.post(`/v1/support/chats/${started.json.chat.id}/ticket`, { subject: 'Steam', category: 'product' })).json.error.code, 'visitor_chat');

    const elsewhere = storeServer((await resellerStore()).subdomain);
    elsewhere.state.visitor = started.json.token;
    assert.equal((await elsewhere.get('/v1/store/support/visitor-chat')).json.visitor, null, 'a token works only at its own store');
    assert.equal((await visitor.post(`/v1/store/support/visitor-chat/${started.json.chat.id}/close`)).json.status, 'closed');
  });

  test('bitocard.com’s visitors reach BitoCard, who can monitor and join', async () => {
    const visitor = storeServer(null);
    const started = (await visitor.post('/v1/store/support/visitor-chat', { name: 'Kwame Mensah', email: 'kwame@example.com', body: 'Do you sell in Ghana?' })).json;
    const queue = (await admin.get('/v1/admin/support/chats')).json.data;
    assert.ok(queue.some(chat => chat.id === started.chat.id && chat.visitor?.email === 'kwame@example.com'));
    assert.equal((await admin.post(`/v1/admin/support/chats/${started.chat.id}/take`)).json.status, 'with_staff');
    await admin.post(`/v1/admin/support/chats/${started.chat.id}/messages`, { body: 'Yes, we do.' });
    const last = (await visitor.get('/v1/store/support/visitor-chat')).json.chat.messages.at(-1);
    assert.deepEqual([last.author, last.author_name], ['bitocard', 'Test Admin']);
  });

  test('starting a chat is a rate-limited route', async () => {
    const { isSensitive } = await import('../dist/common/rate-limit/rate-limit.guard.js');
    assert.equal(isSensitive('POST', '/v1/store/support/visitor-chat'), true);
    assert.equal(isSensitive('POST', '/v1/store/support/visitor-chat/messages'), false);
  });
});

describe('files in chat', () => {
  test('a customer sends a photo: checked, stripped and sealed; the store reads it and sends a PDF back; strangers cannot', async () => {
    const store = await resellerStore();
    const shopper = await customer(store.subdomain);
    const refused = await shopper.upload('/v1/store/support/chat/attachments', Buffer.from('<script>'), 'image/png', 'x.png');
    assert.deepEqual([refused.status, refused.json.error.code], [400, 'file_invalid']);

    const sent = await shopper.upload('/v1/store/support/chat/attachments', jpeg(), 'image/jpeg', 'C:\\phone\\receipt "1".jpg', 'My receipt');
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    const message = sent.json.messages.at(-1);
    assert.equal(message.body, 'My receipt');
    assert.deepEqual([message.attachments.length, message.attachments[0].name, message.attachments[0].content_type], [1, 'receipt 1.jpg', 'image/jpeg']);
    const stored = [...objects.entries()].find(([key]) => key.includes(`/chat/${sent.json.id}/`));
    assert.ok(stored, 'kept under the chat');
    assert.equal(stored[1].acl, 'private');
    assert.ok(!stored[1].body.includes(Buffer.from('GPSDATA')), 'never readable in the bucket');

    const file = message.attachments[0];
    const mine = await shopper.get(`/v1/store/support/chat/${sent.json.id}/files/${file.id}`);
    assert.deepEqual([mine.status, mine.type], [200, 'image/jpeg']);
    assert.equal(mine.headers.get('cache-control'), 'no-store, private');
    assert.ok(!mine.bytes.includes(Buffer.from('GPSDATA')), 'its metadata was removed');
    const theirs = await consoleGet(store.browser, `/v1/support/chats/${sent.json.id}/files/${file.id}`);
    assert.deepEqual([theirs.status, theirs.type], [200, 'image/jpeg']);

    const back = await consoleUpload(store.browser, `/v1/support/chats/${sent.json.id}/attachments`, pdf(), 'application/pdf', 'invoice.pdf');
    assert.equal(back.status, 201, JSON.stringify(back.json));
    assert.deepEqual([back.json.status, back.json.messages.at(-1).author, back.json.messages.at(-1).attachments[0].content_type], ['with_staff', 'reseller', 'application/pdf']);

    const stranger = await customer(store.subdomain);
    assert.equal((await stranger.get(`/v1/store/support/chat/${sent.json.id}/files/${file.id}`)).status, 404);
    const other = await resellerStore();
    assert.equal((await consoleGet(other.browser, `/v1/support/chats/${sent.json.id}/files/${file.id}`)).status, 404);
  });

  test('visitors, resellers and admins send files too; old chats are deleted with their files', async () => {
    const visitor = storeServer(null);
    const started = (await visitor.post('/v1/store/support/visitor-chat', { name: 'Ama', email: 'ama@example.com', body: 'See this' })).json;
    const sent = await visitor.upload('/v1/store/support/visitor-chat/attachments', jpeg(), 'image/jpeg', 'screen.jpg');
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    assert.equal(sent.json.messages.at(-1).body, '');
    const adminFile = await consoleGet(admin, `/v1/admin/support/chats/${started.chat.id}/files/${sent.json.messages.at(-1).attachments[0].id}`);
    assert.equal(adminFile.status, 200);
    assert.equal((await consoleUpload(admin, `/v1/admin/support/chats/${started.chat.id}/attachments`, jpeg(), 'image/jpeg', 'help.jpg')).status, 201);

    const reseller = await resellerClient(server);
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { planCode: 'premium' } });
    const own = await consoleUpload(reseller.browser, '/v1/support/bitocard-chat/attachments', pdf(), 'application/pdf', 'statement.pdf');
    assert.deepEqual([own.status, own.json.requester, own.json.status], [201, 'reseller', 'waiting']);

    const chats = server.app.get((await import('../dist/support/chats.service.js')).ChatsService);
    await prisma.supportConversation.update({ where: { id: started.chat.id }, data: { status: 'closed', closedAt: new Date(Date.now() - 400 * 24 * 3600_000) } });
    const keys = (await prisma.supportChatAttachment.findMany({ where: { conversationId: started.chat.id } })).map(file => file.objectKey);
    assert.equal(keys.length, 2);
    await chats.purgeOld();
    assert.equal(await prisma.supportConversation.count({ where: { id: started.chat.id } }), 0);
    assert.ok(keys.every(key => ![...objects.keys()].some(stored => stored.endsWith(key))), 'files removed from the bucket');
  });
});
