// Assistants answering: chats start with the store's active chat assistant, which answers each message (redacted before
// it is sent), uses tools scoped to the store and customer, hands over to a person (by its tool, on request, or when its
// AI fails), and turns a chat into a ticket; ticket assistants draft replies for staff (sent as they are or edited, or
// discarded) or reply by themselves, and stay out once a person writes; BitoCard's assistant answers resellers; the job
// answers what an after-reply run missed.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, listForTest, resellerClient, startApp } from './helpers.mjs';
import { fakeAi } from './fakes.mjs';
import { responseChecker } from './openapi-docs.mjs';

const { redact } = await import('../dist/support/redact.js');

let server;
let ai;
let admin;
let prisma;
let replies;
let check;
let counter = 0;

before(async () => {
  ai = await fakeAi();
  server = await startApp({ env: { ...ai.env, ANTHROPIC_API_KEY: 'good-anthropic-bitocard', AI_BITOCARD_MODELS: 'anthropic:claude-haiku-5-5' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  replies = server.app.get((await import('../dist/support/replies.service.js')).RepliesService);
  check = await responseChecker(server.app);
});

after(async () => {
  await server?.close();
  await ai?.close();
});

const until = async (probe, tries = 60) => {
  for (let n = 0; n < tries; n += 1) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return probe();
};

function storeServer(subdomain) {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: { 'bitocard-store': subdomain, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { 'bitocard-customer-session': token } : {}), ...(method === 'POST' ? { 'idempotency-key': `s-${Date.now()}-${Math.random()}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

async function customer(subdomain) {
  const shopper = storeServer(subdomain);
  const email = `asks${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chidi Okafor', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) });
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function giftCard(title) {
  const created = await admin.post('/v1/admin/stock', { category: 'gift_cards', country: 'NG', brand: 'amazon', title, description: 'An Amazon gift card.', redeem_instructions: 'Redeem at amazon.com.', currency: 'USD', face_value: 2500, cost: 2000, listed: true, codes: [{ code: `${title}-${Date.now()}`.replace(/\W/g, '') }] });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.product;
}

/** A live store with an active assistant on the reseller's own key. */
async function storeWithAssistant(roles = ['chat', 'tickets'], extra = {}) {
  const reseller = await resellerClient(server);
  await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
  const subdomain = `reply${(counter += 1)}${Date.now().toString(36)}`.slice(0, 30);
  const store = (await reseller.browser.post('/v1/stores', { name: 'Ada Digital', subdomain })).json;
  await reseller.browser.post(`/v1/stores/${store.id}/publish`);
  await reseller.browser.patch(`/v1/stores/${store.id}`, { checkout_mode: 'live' });
  await reseller.browser.put('/v1/support/ai/keys/anthropic', { api_key: 'good-reseller-anthropic-key' });
  const bot = (await reseller.browser.post('/v1/support/bots', { name: 'Kemi', roles, provider: 'anthropic', model: 'claude-haiku-5-5', funding: 'own', store_id: store.id, ...extra })).json;
  await reseller.browser.put(`/v1/support/bots/${bot.id}/knowledge`, { content: '# About the store\nWe sell gift cards. Open 9 to 5.' });
  assert.equal((await reseller.browser.post(`/v1/support/bots/${bot.id}/activate`)).json.status, 'active');
  return { ...reseller, subdomain, storeId: store.id, botId: bot.id };
}

describe('redaction', () => {
  test('cards, account numbers, codes, keys and PINs never reach the AI; ordinary words and meter numbers do', () => {
    assert.equal(redact('my card is 4111 1111 1111 1111'), 'my card is [number hidden]');
    assert.equal(redact('PIN: 4321 please'), 'PIN: [hidden] please');
    assert.equal(redact('code ABCD-1234-EFGH-5678 failed'), 'code [code hidden] failed');
    assert.equal(redact('key X7K2M9Q4W8E1R5T3'), 'key [code hidden]');
    assert.equal(redact('meter 45702044269 has no token'), 'meter 45702044269 has no token');
  });
});

describe('chats with an assistant', () => {
  test('the assistant answers by name, with redacted words; customers see it is the assistant', async () => {
    const store = await storeWithAssistant();
    const shopper = await customer(store.subdomain);
    const current = (await shopper.get('/v1/store/support/chat')).json;
    assert.deepEqual(current.assistant, { name: 'Kemi', avatar_url: null, greeting: null });
    ai.state.next = 'We are open from 9 to 5.';
    const chat = (await shopper.post('/v1/store/support/chat/messages', { body: 'When are you open? My card 4111 1111 1111 1111 was charged.' })).json;
    assert.equal(chat.status, 'bot');
    const answered = await until(async () => (await shopper.get(`/v1/store/support/chat/${chat.id}/messages`)).json.data.find(item => item.author === 'bot'));
    assert.deepEqual([answered.author_name, answered.body], ['Kemi', 'We are open from 9 to 5.']);
    const sent = JSON.stringify(ai.state.calls.at(-1).body.messages);
    assert.ok(sent.includes('[number hidden]') && !sent.includes('4111'), 'never the card number');
    assert.equal(await prisma.notification.count({ where: { type: 'support.chat_waiting', resellerId: store.resellerId } }), 0, 'staff are not paged while the assistant answers');
    const usage = await prisma.aiUsage.findFirstOrThrow({ where: { botId: store.botId, kind: 'chat' } });
    assert.equal(usage.funding, 'own');
  });

  test('the assistant answers with its face and knows who it is talking to; staff see the same details', async () => {
    const store = await storeWithAssistant();
    const face = 'https://cdn.example.com/bots/kemi.png';
    await prisma.supportBot.update({ where: { id: store.botId }, data: { avatarUrl: face } });
    const shopper = await customer(store.subdomain);
    await prisma.customer.update({ where: { id: shopper.id }, data: { phone: '+2348012345678', phoneVerifiedAt: new Date() } });
    ai.state.next = 'Hi Chidi, happy to help.';
    const chat = (await shopper.post('/v1/store/support/chat/messages', { body: 'Hello' })).json;
    const answered = await until(async () => (await shopper.get(`/v1/store/support/chat/${chat.id}/messages`)).json.data.find(item => item.author === 'bot'));
    assert.deepEqual([answered.author_name, answered.author_avatar_url], ['Kemi', face]);
    const request = ai.state.calls.at(-1).body;
    assert.ok(request.system[1].cache_control, 'the knowledge stays the cached block');
    const about = request.system[2].text;
    for (const fact of ['Chidi Okafor', shopper.email ?? '@example.com', '+2348012345678', '(NG)', 'NGN', 'first name']) assert.ok(about.includes(fact), `${fact} in ${about}`);
    assert.ok(!request.system[0].text.includes('Chidi'), 'the rules block is the same for everyone');
    const staffView = (await store.browser.get(`/v1/support/chats/${chat.id}`)).json;
    assert.deepEqual([staffView.requester_profile.kind, staffView.requester_profile.phone, staffView.requester_profile.currency], ['customer', '+2348012345678', 'NGN']);
    assert.equal(staffView.messages.find(item => item.author === 'bot').author_avatar_url, face);
  });

  test('tools: products the store lists; handing over stops the assistant and pages staff', async () => {
    const product = await giftCard('Amazon Reply Card');
    const store = await storeWithAssistant();
    await listForTest(server, { resellerId: store.resellerId, productIds: [product.id] });
    const shopper = await customer(store.subdomain);
    ai.state.tool = { name: 'search_products', arguments: { query: 'Amazon Reply' } };
    ai.state.next = 'Yes, we sell the Amazon Reply Card.';
    const chat = (await shopper.post('/v1/store/support/chat/messages', { body: 'Do you sell Amazon cards?' })).json;
    await until(async () => (await prisma.supportChatMessage.count({ where: { conversationId: chat.id, author: 'bot' } })) > 0);
    const toolResult = ai.state.calls.at(-1).body.messages.at(-1).content[0];
    assert.equal(toolResult.type, 'tool_result');
    assert.match(toolResult.content, /Amazon Reply Card/);

    ai.state.tool = { name: 'handoff', arguments: { reason: 'Wants a refund' } };
    await shopper.post('/v1/store/support/chat/messages', { body: 'I want my money back.' });
    const waiting = await until(async () => (await prisma.supportConversation.findUniqueOrThrow({ where: { id: chat.id } })).status === 'waiting');
    assert.ok(waiting);
    const notice = await prisma.notification.findFirst({ where: { type: 'support.chat_waiting', resellerId: store.resellerId } });
    assert.match(notice.body, /Wants a refund/);
    const calls = ai.state.calls.length;
    await shopper.post('/v1/store/support/chat/messages', { body: 'Hello?' });
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(ai.state.calls.length, calls, 'the assistant stays out once a person is needed');
  });

  test('asking for a person, an AI that fails, and a ticket made by the assistant', async () => {
    const store = await storeWithAssistant();
    const shopper = await customer(store.subdomain);
    ai.state.next = 'Hello!';
    const chat = (await shopper.post('/v1/store/support/chat/messages', { body: 'Hi' })).json;
    await until(async () => (await prisma.supportChatMessage.count({ where: { conversationId: chat.id, author: 'bot' } })) > 0);
    const human = await shopper.post(`/v1/store/support/chat/${chat.id}/human`);
    assert.equal(human.json.status, 'waiting');
    assert.match(human.json.messages.at(-1).body, /A person will reply/);

    const failing = await storeWithAssistant();
    await failing.browser.delete('/v1/support/ai/keys/anthropic');
    const other = await customer(failing.subdomain);
    const broken = (await other.post('/v1/store/support/chat/messages', { body: 'Hi there' })).json;
    assert.ok(await until(async () => (await prisma.supportConversation.findUniqueOrThrow({ where: { id: broken.id } })).status === 'waiting'), 'a person takes over when the AI cannot answer');

    const ticketing = await customer(store.subdomain);
    ai.state.tool = { name: 'create_ticket', arguments: { subject: 'Token not received', category: 'order' } };
    const asked = (await ticketing.post('/v1/store/support/chat/messages', { body: 'My electricity token never came.' })).json;
    const closed = await until(async () => {
      const row = await prisma.supportConversation.findUniqueOrThrow({ where: { id: asked.id } });
      return row.status === 'closed' ? row : null;
    });
    const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { id: closed.ticketId } });
    assert.deepEqual([ticket.source, ticket.subject, ticket.customerId], ['bot', 'Token not received', ticketing.id]);
  });

  test('the job answers a chat whose after-reply run never happened', async () => {
    const store = await storeWithAssistant();
    const shopper = await customer(store.subdomain);
    ai.state.next = 'First answer.';
    const chat = (await shopper.post('/v1/store/support/chat/messages', { body: 'Hi' })).json;
    await until(async () => (await prisma.supportChatMessage.count({ where: { conversationId: chat.id, author: 'bot' } })) > 0);
    const old = new Date(Date.now() - 60_000);
    await prisma.supportChatMessage.create({ data: { conversationId: chat.id, author: 'customer', body: 'Are you there?', createdAt: old } });
    await prisma.supportConversation.update({ where: { id: chat.id }, data: { lastAskedAt: old } });
    await prisma.supportChatMessage.updateMany({ where: { conversationId: chat.id, author: 'bot' }, data: { createdAt: new Date(old.getTime() - 1000) } });
    ai.state.next = 'Yes, I am here.';
    const ran = await replies.job();
    assert.ok(ran.chat_answers >= 1);
    assert.ok(await prisma.supportChatMessage.findFirst({ where: { conversationId: chat.id, author: 'bot', body: 'Yes, I am here.' } }));
  });
});

describe('tickets with an assistant', () => {
  test('drafts for staff: never shown to the customer, sent as they are (the assistant’s words) or discarded', async () => {
    const store = await storeWithAssistant(['tickets'], { ticket_reply_mode: 'draft' });
    const shopper = await customer(store.subdomain);
    ai.state.next = 'Your token is on the order page: press Reveal.';
    const ticket = (await shopper.post('/v1/store/support/tickets', { subject: 'Where is my token?', category: 'order', message: 'No token yet.' })).json;
    const draft = await until(async () => prisma.supportTicketMessage.findFirst({ where: { ticketId: ticket.id, draft: true } }));
    assert.equal(draft.body, 'Your token is on the order page: press Reveal.');
    assert.equal((await shopper.get(`/v1/store/support/tickets/${ticket.id}`)).json.messages.length, 1, 'the customer never sees drafts');
    const staff = (await store.browser.get(`/v1/support/tickets/${ticket.id}`)).json;
    check('GET /v1/support/tickets/{id}', 200, staff);
    assert.deepEqual(staff.messages.map(item => [item.author, item.draft]), [['customer', false], ['bot', true]]);
    const sent = await store.browser.post(`/v1/support/tickets/${ticket.id}/drafts/${draft.id}/send`, {});
    check('POST /v1/support/tickets/{id}/drafts/{draft}/send', 200, sent.json);
    assert.deepEqual([sent.json.status, sent.json.messages.at(-1).author, sent.json.messages.at(-1).author_name], ['pending', 'bot', 'Kemi']);
    assert.equal((await shopper.get(`/v1/store/support/tickets/${ticket.id}`)).json.messages.at(-1).author_name, 'Kemi');

    // The draft went out unchanged, so it is still the assistant’s answer: it drafts again for the next message.
    ai.state.next = 'Another suggestion.';
    await shopper.post(`/v1/store/support/tickets/${ticket.id}/messages`, { body: 'It says invalid.' });
    const next = await until(async () => prisma.supportTicketMessage.findFirst({ where: { ticketId: ticket.id, draft: true } }));
    assert.equal(next.body, 'Another suggestion.');
  });

  test('automatic replies, re-answering the customer, and staying out once a person writes', async () => {
    const store = await storeWithAssistant(['tickets'], { ticket_reply_mode: 'auto' });
    const shopper = await customer(store.subdomain);
    ai.state.next = 'Gift cards arrive at once.';
    const ticket = (await shopper.post('/v1/store/support/tickets', { subject: 'Delivery time', category: 'product', message: 'How fast do gift cards arrive?' })).json;
    const replied = await until(async () => (await shopper.get(`/v1/store/support/tickets/${ticket.id}`)).json.messages.find(item => item.author === 'bot'));
    assert.equal(replied.body, 'Gift cards arrive at once.');
    assert.equal((await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status, 'pending');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'customer.support.ticket_replied', customerId: shopper.id } }));

    await store.browser.post(`/v1/support/tickets/${ticket.id}/messages`, { body: 'Hi, Ada here: anything else?' });
    const calls = ai.state.calls.length;
    await shopper.post(`/v1/store/support/tickets/${ticket.id}/messages`, { body: 'No thanks.' });
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(ai.state.calls.length, calls, 'a person is answering: the assistant stays out');
  });

  test('discarding a draft removes it; staff can edit before sending (then it is theirs)', async () => {
    const store = await storeWithAssistant(['tickets']);
    const shopper = await customer(store.subdomain);
    ai.state.next = 'Draft one.';
    const ticket = (await shopper.post('/v1/store/support/tickets', { subject: 'Question', category: 'other', message: 'A question.' })).json;
    const first = await until(async () => prisma.supportTicketMessage.findFirst({ where: { ticketId: ticket.id, draft: true } }));
    const discarded = await store.browser.post(`/v1/support/tickets/${ticket.id}/drafts/${first.id}/discard`);
    check('POST /v1/support/tickets/{id}/drafts/{draft}/discard', 200, discarded.json);
    assert.equal(discarded.json.messages.length, 1);
    await prisma.supportTicketMessage.create({ data: { ticketId: ticket.id, author: 'bot', authorName: 'Kemi', body: 'Draft two.', visibility: 'staff', draft: true } });
    const second = await prisma.supportTicketMessage.findFirstOrThrow({ where: { ticketId: ticket.id, draft: true } });
    const edited = await store.browser.post(`/v1/support/tickets/${ticket.id}/drafts/${second.id}/send`, { body: 'Draft two, checked by Ada.' });
    assert.deepEqual([edited.json.messages.at(-1).author, edited.json.messages.at(-1).body], ['reseller', 'Draft two, checked by Ada.']);
  });
});

describe('BitoCard’s assistant for resellers', () => {
  test('answers a reseller’s chat with BitoCard and their own tickets', async () => {
    const existing = await prisma.supportBot.findFirst({ where: { scope: 'platform' } });
    let platformId = existing?.id;
    if (!platformId) {
      platformId = (await admin.post('/v1/admin/support/bots', { name: 'Bito', roles: ['chat', 'tickets'], provider: 'anthropic', model: 'claude-haiku-5-5', funding: 'bitocard', scope: 'platform', ticket_reply_mode: 'auto' })).json.id;
      await admin.put(`/v1/admin/support/bots/${platformId}/knowledge`, { content: '# SHQ\nHelp for resellers.' });
      assert.equal((await admin.post(`/v1/admin/support/bots/${platformId}/activate`)).json.status, 'active');
    }
    const reseller = await resellerClient(server);
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { planCode: 'premium' } });
    ai.state.tool = { name: 'my_account', arguments: {} };
    ai.state.next = 'Your account is pending until your identity check is done.';
    const chat = (await reseller.browser.post('/v1/support/bitocard-chat/messages', { body: 'Why can I not sell live?' })).json;
    assert.equal(chat.status, 'bot');
    const answer = await until(async () => (await reseller.browser.get('/v1/support/bitocard-chat')).json.chat.messages.find(item => item.author === 'bot'));
    assert.match(answer.body, /identity check/);
    assert.match(JSON.stringify(ai.state.calls.at(-1).body.messages), /identity_checked/);
    ai.state.next = 'You can enable mobile money on request.';
    const ticket = (await reseller.browser.post('/v1/support/tickets', { requester: 'reseller', subject: 'Mobile money', category: 'other', message: 'How do I enable it?' })).json;
    assert.ok(await until(async () => (await prisma.supportTicketMessage.count({ where: { ticketId: ticket.id, author: 'bot', draft: false } })) > 0));
  });
});
