// Live chat: a customer writes and the store is told (once per wait), staff answer and take it over, the customer polls
// for new messages and sees who answered, chats close and become tickets; resellers chat with BitoCard;
// bitocard.com's customers reach BitoCard; one open chat per requester, and a cap on how fast they write.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;
let counter = 0;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
});

after(async () => {
  await server?.close();
});

function storeServer(subdomain = null) {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(subdomain ? { 'bitocard-store': subdomain } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `store-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

async function customer(subdomain = null) {
  const shopper = storeServer(subdomain);
  const email = `chatter${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chidi Okafor', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function resellerStore() {
  const reseller = await resellerClient(server);
  await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
  const subdomain = `chat${(counter += 1)}${Date.now().toString(36)}`.slice(0, 30);
  const created = await reseller.browser.post('/v1/stores', { name: 'Ada Digital', subdomain });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal((await reseller.browser.post(`/v1/stores/${created.json.id}/publish`)).status, 200);
  assert.equal((await reseller.browser.patch(`/v1/stores/${created.json.id}`, { checkout_mode: 'live' })).status, 200);
  return { ...reseller, subdomain };
}

const waitingNotices = resellerId => prisma.notification.count({ where: { type: 'support.chat_waiting', resellerId } });

describe('a customer chats with their store', () => {
  test('the store is told once, answers (taking it), the customer polls new messages with who answered, the store ends it', async () => {
    const store = await resellerStore();
    const shopper = await customer(store.subdomain);
    assert.equal((await shopper.get('/v1/store/support/chat')).json.chat, null, 'no chat yet');
    const first = await shopper.post('/v1/store/support/chat/messages', { body: 'Hi, is the Amazon card for the US store?' });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.deepEqual([first.json.status, first.json.messages.length], ['waiting', 1]);
    await shopper.post('/v1/store/support/chat/messages', { body: 'Hello?' });
    const owners = await prisma.resellerMember.count({ where: { resellerId: store.resellerId } });
    assert.equal(await waitingNotices(store.resellerId), owners, 'told once for the wait, not per message');

    const inbox = (await store.browser.get('/v1/support/chats')).json.data;
    assert.deepEqual(inbox.map(item => [item.id, item.status, item.requester_name]), [[first.json.id, 'waiting', 'Chidi Okafor']]);
    const seen = (await store.browser.get(`/v1/support/chats/${first.json.id}`)).json;
    const lastSeen = seen.messages.at(-1).id;

    const replied = await store.browser.post(`/v1/support/chats/${first.json.id}/messages`, { body: 'Yes, it works on amazon.com.' });
    assert.deepEqual([replied.status, replied.json.status, replied.json.assignee_id], [201, 'with_staff', store.userId]);
    const polled = (await shopper.get(`/v1/store/support/chat/${first.json.id}/messages?after=${lastSeen}`)).json;
    assert.deepEqual([polled.status, polled.data.map(item => [item.author, item.author_name, item.body])], ['with_staff', [['reseller', 'Ada Obi', 'Yes, it works on amazon.com.']]]);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'customer.support.chat_replied', customerId: shopper.id } }));

    await shopper.post('/v1/store/support/chat/messages', { body: 'Thanks!' });
    assert.equal(await waitingNotices(store.resellerId), owners, 'not told while a person is answering');
    const ended = await store.browser.post(`/v1/support/chats/${first.json.id}/close`);
    assert.deepEqual([ended.status, ended.json.status], [200, 'closed']);
    assert.equal((await shopper.get('/v1/store/support/chat')).json.chat, null);
    const again = (await shopper.post('/v1/store/support/chat/messages', { body: 'One more question.' })).json;
    assert.notEqual(again.id, first.json.id, 'a new chat after one ends');
  });

  test('a chat becomes a ticket with its transcript; the customer is told its reference', async () => {
    const store = await resellerStore();
    const shopper = await customer(store.subdomain);
    const chat = (await shopper.post('/v1/store/support/chat/messages', { body: 'My token never arrived.' })).json;
    await store.browser.post(`/v1/support/chats/${chat.id}/messages`, { body: 'Let me check with the biller.' });
    const made = await store.browser.post(`/v1/support/chats/${chat.id}/ticket`, { subject: 'Missing electricity token', category: 'order' });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.equal(made.json.status, 'closed');
    assert.match(made.json.ticket_reference, /^T-\d{6}$/);
    const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { id: made.json.ticket_id }, include: { messages: true } });
    assert.deepEqual([ticket.source, ticket.queue, ticket.customerId, ticket.requester], ['chat', 'reseller', shopper.id, 'customer']);
    assert.match(ticket.messages[0].body, /Customer .*My token never arrived\.[\s\S]*Store .*Let me check with the biller\./);
    const seen = (await shopper.get(`/v1/store/support/chat/${chat.id}/messages`)).json;
    assert.match(seen.data.at(-1).body, new RegExp(made.json.ticket_reference));
    assert.equal((await store.browser.post(`/v1/support/chats/${chat.id}/ticket`, { subject: 'Again', category: 'order' })).json.error.code, 'chat_has_ticket');
  });

  test('one open chat even from two tabs; a cap on how fast the customer writes; stores never reach each other’s chats', async () => {
    const store = await resellerStore();
    const other = await resellerStore();
    const shopper = await customer(store.subdomain);
    const [a, b] = await Promise.all([shopper.post('/v1/store/support/chat/messages', { body: 'Tab one' }), shopper.post('/v1/store/support/chat/messages', { body: 'Tab two' })]);
    assert.equal(a.json.id, b.json.id);
    assert.equal(await prisma.supportConversation.count({ where: { customerId: shopper.id } }), 1);
    for (let n = 0; n < 10; n += 1) await shopper.post('/v1/store/support/chat/messages', { body: `Message ${n}` });
    const fast = await shopper.post('/v1/store/support/chat/messages', { body: 'Too fast' });
    assert.deepEqual([fast.status, fast.json.error.code], [429, 'chat_rate_limited']);
    assert.equal((await other.browser.get(`/v1/support/chats/${a.json.id}`)).status, 404);
    const stranger = await customer(store.subdomain);
    assert.equal((await stranger.get(`/v1/store/support/chat/${a.json.id}/messages`)).status, 404);
  });
});

describe('BitoCard’s chats', () => {
  test('a reseller’s team chats with BitoCard; admins see it, take it, answer; the reseller ends it', async () => {
    const reseller = await resellerClient(server);
    // Chat with BitoCard is priority support: refused on Standard, open on Premium.
    const refused = await reseller.browser.post('/v1/support/bitocard-chat/messages', { body: 'Hello?' });
    assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.param], [403, 'plan_feature_required', 'priority_support']);
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { planCode: 'premium' } });
    assert.equal((await reseller.browser.get('/v1/support/bitocard-chat')).json.chat, null);
    const chat = (await reseller.browser.post('/v1/support/bitocard-chat/messages', { body: 'How do I enable mobile money?' })).json;
    assert.deepEqual([chat.requester, chat.queue, chat.status], ['reseller', 'bitocard', 'waiting']);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.support.chat_waiting' } }));
    const queue = (await admin.get('/v1/admin/support/chats')).json.data;
    assert.ok(queue.some(item => item.id === chat.id && item.reseller_id === reseller.resellerId && item.requester_name === 'Ada Obi'));
    const taken = await admin.post(`/v1/admin/support/chats/${chat.id}/take`);
    assert.deepEqual([taken.status, taken.json.status], [200, 'with_staff']);
    await admin.post(`/v1/admin/support/chats/${chat.id}/messages`, { body: 'Ask us to switch it on for your market.' });
    const mine = (await reseller.browser.get('/v1/support/bitocard-chat')).json.chat;
    assert.deepEqual(mine.messages.map(item => item.author), ['reseller', 'system', 'bitocard']);
    assert.equal(mine.assignee_id, null, 'BitoCard’s assignee is BitoCard’s business');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'support.chat_replied', resellerId: reseller.resellerId } }));
    assert.equal((await reseller.browser.post(`/v1/support/bitocard-chat/${chat.id}/close`)).json.status, 'closed');
    assert.equal((await reseller.browser.get('/v1/support/chats')).json.data.length, 0, 'their own chat is not in their customers’ inbox');
  });

  test('a bitocard.com customer reaches BitoCard, not a store', async () => {
    const shopper = await customer(null);
    const chat = (await shopper.post('/v1/store/support/chat/messages', { body: 'Which countries do you sell in?' })).json;
    const row = await prisma.supportConversation.findUniqueOrThrow({ where: { id: chat.id } });
    assert.equal(row.queue, 'bitocard');
    const made = await admin.post(`/v1/admin/support/chats/${chat.id}/ticket`, { subject: 'Countries', category: 'other' });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.equal((await prisma.supportTicket.findUniqueOrThrow({ where: { id: made.json.ticket_id } })).queue, 'bitocard');
  });
});

describe('retention', () => {
  test('chats that ended more than 12 months ago are deleted; recent and open ones stay', async () => {
    const chats = server.app.get((await import('../dist/support/chats.service.js')).ChatsService);
    const reseller = await resellerClient(server);
    const old = await prisma.supportConversation.create({ data: { resellerId: reseller.resellerId, mode: 'live', requester: 'reseller', queue: 'bitocard', status: 'closed', closedAt: new Date(Date.now() - 400 * 24 * 3600_000), messages: { create: [{ author: 'reseller', body: 'Long ago' }] } } });
    const recent = await prisma.supportConversation.create({ data: { resellerId: reseller.resellerId, mode: 'test', requester: 'reseller', queue: 'bitocard', status: 'closed', closedAt: new Date(Date.now() - 30 * 24 * 3600_000) } });
    assert.ok((await chats.purgeOld()) >= 1);
    assert.equal(await prisma.supportConversation.count({ where: { id: old.id } }), 0);
    assert.equal(await prisma.supportChatMessage.count({ where: { conversationId: old.id } }), 0);
    assert.equal(await prisma.supportConversation.count({ where: { id: recent.id } }), 1);
  });
});
