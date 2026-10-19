// Support tickets: customers ask their store, the store answers (staff notes the customer never sees) and can pass a
// ticket to BitoCard, which answers, resolves or sends it back; resellers ask BitoCard (BitoCard's notes kept from
// them); bitocard.com's customers go straight to BitoCard; turns (`open`/`pending`), reopening, events, notices, the
// public API's scopes and its documented responses.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, lastEmailCode, resellerClient, startApp } from './helpers.mjs';
import { responseChecker } from './openapi-docs.mjs';

let server;
let admin;
let prisma;
let check;
let counter = 0;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
  check = await responseChecker(server.app);
});

after(async () => {
  await server?.close();
});

/** A store's server: the store in `BitoCard-Store` (none: bitocard.com), the customer's session in a header. */
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
  const email = `asker${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chidi Okafor', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

/** A verified reseller with a published store on <subdomain>.bitocard.com. */
async function resellerStore() {
  const reseller = await resellerClient(server);
  await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
  const subdomain = `help${(counter += 1)}${Date.now().toString(36)}`.slice(0, 30);
  const created = await reseller.browser.post('/v1/stores', { name: 'Ada Digital', subdomain });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal((await reseller.browser.post(`/v1/stores/${created.json.id}/publish`)).status, 200);
  // Customers' tickets follow the store's mode, as its orders do: a sandbox store's are sandbox tickets.
  assert.equal((await reseller.browser.patch(`/v1/stores/${created.json.id}`, { checkout_mode: 'live' })).status, 200);
  return { ...reseller, subdomain, storeId: created.json.id };
}

const events = (resellerId, type) => prisma.event.findMany({ where: { resellerId, type }, orderBy: { createdAt: 'asc' } });

describe('a customer’s ticket: the store answers, BitoCard helps when asked', () => {
  test('opened on the store, answered with staff notes the customer never sees, turns taken, reopened, resolved', async () => {
    const store = await resellerStore();
    const shopper = await customer(store.subdomain);
    const opened = await shopper.post('/v1/store/support/tickets', { subject: 'Where is my token?', category: 'order', message: 'I paid an hour ago and have no electricity token.' });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    assert.match(opened.json.reference, /^T-\d{6}$/);
    assert.deepEqual([opened.json.status, opened.json.messages.length], ['open', 1]);
    assert.equal(opened.json.mode, undefined, 'customers see no internal fields');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'support.ticket_created', resellerId: store.resellerId } }), 'the store is told');
    assert.equal((await events(store.resellerId, 'support_ticket.created')).length, 1);

    const stranger = await customer(store.subdomain);
    assert.equal((await stranger.get(`/v1/store/support/tickets/${opened.json.id}`)).status, 404, 'only the customer’s own');

    const list = await store.browser.get('/v1/support/tickets');
    check('GET /v1/support/tickets', 200, list.json);
    assert.deepEqual(list.json.data.map(item => [item.id, item.requester, item.queue, item.status]), [[opened.json.id, 'customer', 'reseller', 'open']]);

    const note = await store.browser.post(`/v1/support/tickets/${opened.json.id}/messages`, { body: 'Checked: the biller is slow today.', visibility: 'staff' });
    assert.equal(note.json.status, 'open', 'a note is not an answer');
    const answered = await store.browser.post(`/v1/support/tickets/${opened.json.id}/messages`, { body: 'Your token is on the order page now.' });
    check('POST /v1/support/tickets/{id}/messages', 201, answered.json);
    assert.equal(answered.json.status, 'pending', 'the customer’s turn');
    const seen = (await shopper.get(`/v1/store/support/tickets/${opened.json.id}`)).json;
    assert.deepEqual(seen.messages.map(item => [item.author, item.author_name, item.body]), [
      ['customer', 'Chidi Okafor', 'I paid an hour ago and have no electricity token.'],
      ['reseller', null, 'Your token is on the order page now.'],
    ], 'never the staff note, never staff names');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'customer.support.ticket_replied', customerId: shopper.id } }));

    const replied = await shopper.post(`/v1/store/support/tickets/${opened.json.id}/messages`, { body: 'Got it, thanks!' });
    assert.equal(replied.json.status, 'open');
    assert.equal((await events(store.resellerId, 'support_ticket.message_received')).length, 1);

    const resolved = await store.browser.post(`/v1/support/tickets/${opened.json.id}/resolve`, { note: 'Glad it arrived.' });
    check('POST /v1/support/tickets/{id}/resolve', 200, resolved.json);
    assert.equal(resolved.json.status, 'resolved');
    assert.equal((await store.browser.post(`/v1/support/tickets/${opened.json.id}/messages`, { body: 'More?' })).json.error.code, 'ticket_resolved');
    const reopened = await shopper.post(`/v1/store/support/tickets/${opened.json.id}/messages`, { body: 'Actually the token was rejected by my meter.' });
    assert.deepEqual([reopened.json.status, reopened.json.resolved_at], ['open', null], 'the customer’s reply reopens it');
    const updates = await events(store.resellerId, 'support_ticket.updated');
    assert.deepEqual(updates.map(item => item.payload && JSON.parse(item.payload).data.object.status), ['pending', 'open', 'resolved', 'open']);
  });

  test('passed to BitoCard with a note, answered by BitoCard, sent back; the store is told throughout', async () => {
    const store = await resellerStore();
    const shopper = await customer(store.subdomain);
    const opened = (await shopper.post('/v1/store/support/tickets', { subject: 'Token rejected', category: 'order', message: 'The meter rejects the token.' })).json;
    const escalated = await store.browser.post(`/v1/support/tickets/${opened.id}/escalate`, { note: 'The token looks right; please check with the biller.' });
    check('POST /v1/support/tickets/{id}/escalate', 200, escalated.json);
    assert.deepEqual([escalated.json.queue, escalated.json.status, Boolean(escalated.json.escalated_at)], ['bitocard', 'open', true]);
    assert.equal((await store.browser.post(`/v1/support/tickets/${opened.id}/escalate`, { note: 'Again, please, it is urgent.' })).json.error.code, 'ticket_not_yours');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.support.ticket_created' } }));

    const queue = (await admin.get('/v1/admin/support/tickets')).json.data;
    assert.ok(queue.some(item => item.id === opened.id && item.reseller_id === store.resellerId));
    const adminNote = await admin.post(`/v1/admin/support/tickets/${opened.id}/messages`, { body: 'Biller confirms a delay.', visibility: 'staff' });
    assert.equal(adminNote.json.status, 'open');
    const answer = await admin.post(`/v1/admin/support/tickets/${opened.id}/messages`, { body: 'The biller re-sent your token: try it again.' });
    assert.equal(answer.json.status, 'pending');
    const storeView = (await store.browser.get(`/v1/support/tickets/${opened.id}`)).json;
    assert.deepEqual(storeView.messages.map(item => item.author), ['customer', 'reseller', 'bitocard', 'bitocard'], 'the store sees BitoCard’s notes on its customers’ tickets');
    assert.equal(storeView.assignee_id, null);
    const customerView = (await shopper.get(`/v1/store/support/tickets/${opened.id}`)).json;
    assert.deepEqual(customerView.messages.map(item => item.author), ['customer', 'bitocard']);

    const returned = await admin.post(`/v1/admin/support/tickets/${opened.id}/return`, { note: 'Please follow up with the customer tomorrow.' });
    assert.deepEqual([returned.status, returned.json.queue, returned.json.status], [200, 'reseller', 'open']);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'support_ticket.returned', targetId: opened.id } }));
    assert.ok(await prisma.notification.findFirst({ where: { type: 'support.ticket_updated', resellerId: store.resellerId } }));
  });

  test('priority and assignment; one store never reaches another’s tickets; customers cannot flood the queue', async () => {
    const store = await resellerStore();
    const other = await resellerStore();
    const shopper = await customer(store.subdomain);
    const opened = (await shopper.post('/v1/store/support/tickets', { subject: 'Account email', category: 'account', message: 'How do I change my email?' })).json;
    const updated = await store.browser.patch(`/v1/support/tickets/${opened.id}`, { priority: 'high', assignee_id: store.userId });
    check('PATCH /v1/support/tickets/{id}', 200, updated.json);
    assert.deepEqual([updated.json.priority, updated.json.assignee_id], ['high', store.userId]);
    assert.equal((await store.browser.patch(`/v1/support/tickets/${opened.id}`, { assignee_id: other.userId })).json.error.param, 'assignee_id', 'only their own team');
    assert.equal((await other.browser.get(`/v1/support/tickets/${opened.id}`)).status, 404);

    const flood = await customer(store.subdomain);
    for (let n = 0; n < 10; n += 1) assert.equal((await flood.post('/v1/store/support/tickets', { subject: `Question ${n}`, category: 'other', message: 'Hello there' })).status, 201);
    assert.equal((await flood.post('/v1/store/support/tickets', { subject: 'One more', category: 'other', message: 'Hello there' })).json.error.code, 'too_many_tickets');
    const first = (await flood.get('/v1/store/support/tickets')).json.data.at(-1);
    assert.equal((await flood.post(`/v1/store/support/tickets/${first.id}/close`)).json.status, 'resolved');
    assert.equal((await flood.post('/v1/store/support/tickets', { subject: 'One more', category: 'other', message: 'Hello there' })).status, 201, 'closing one makes room');
  });
});

describe('BitoCard’s own store and resellers’ questions', () => {
  test('a bitocard.com customer’s ticket goes straight to BitoCard and cannot be sent back', async () => {
    const shopper = await customer(null);
    const opened = (await shopper.post('/v1/store/support/tickets', { subject: 'Card declined', category: 'payment', message: 'My card was declined twice.' })).json;
    const row = await prisma.supportTicket.findUniqueOrThrow({ where: { id: opened.id } });
    assert.equal(row.queue, 'bitocard');
    assert.equal((await admin.post(`/v1/admin/support/tickets/${opened.id}/return`, { note: 'Back to the store' })).json.error.code, 'ticket_not_returnable');
    const resolved = await admin.post(`/v1/admin/support/tickets/${opened.id}/resolve`, { note: 'Your bank released the hold.' });
    assert.equal(resolved.json.status, 'resolved');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'customer.support.ticket_resolved', customerId: shopper.id } }));
  });

  test('a reseller asks BitoCard: BitoCard’s notes stay BitoCard’s, the reseller’s reply reopens, they resolve it', async () => {
    const reseller = await resellerClient(server);
    const opened = await reseller.browser.post('/v1/support/tickets', { requester: 'reseller', subject: 'Webhooks failing', category: 'technical', message: 'Deliveries fail since this morning.' });
    check('POST /v1/support/tickets', 201, opened.json);
    assert.deepEqual([opened.json.requester, opened.json.queue, opened.json.source], ['reseller', 'bitocard', 'form']);
    assert.equal((await reseller.browser.post(`/v1/support/tickets/${opened.json.id}/messages`, { body: 'A note', visibility: 'staff' })).json.error.param, 'visibility');
    await admin.post(`/v1/admin/support/tickets/${opened.json.id}/messages`, { body: 'Their endpoint returns 301.', visibility: 'staff' });
    await admin.post(`/v1/admin/support/tickets/${opened.json.id}/messages`, { body: 'Your endpoint redirects: use the final address.' });
    const got = await reseller.browser.get(`/v1/support/tickets/${opened.json.id}`);
    check('GET /v1/support/tickets/{id}', 200, got.json);
    assert.deepEqual([got.json.status, got.json.messages.map(item => item.author)], ['pending', ['reseller', 'bitocard']], 'never BitoCard’s note');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'support.ticket_replied', resellerId: reseller.resellerId } }));
    const again = await reseller.browser.post(`/v1/support/tickets/${opened.json.id}/messages`, { body: 'Fixed, thanks.' });
    assert.equal(again.json.status, 'open');
    assert.equal((await reseller.browser.post(`/v1/support/tickets/${opened.json.id}/resolve`, {})).json.status, 'resolved');
  });

  test('API keys: read needs support:read, writing support:write; tickets opened by key are marked api', async () => {
    const reseller = await resellerClient(server);
    const readOnly = (await reseller.browser.post('/v1/api-keys', { name: 'Read', mode: 'test', scopes: ['support:read'] })).json.secret;
    const writer = (await reseller.browser.post('/v1/api-keys', { name: 'Write', mode: 'test', scopes: ['support:read', 'support:write'] })).json.secret;
    const api = client(server.base, { origin: null, autoIdempotency: true });
    const read = { authorization: `Bearer ${readOnly}` };
    assert.equal((await api.get('/v1/support/tickets', read)).status, 200);
    assert.equal((await api.post('/v1/support/tickets', { requester: 'reseller', subject: 'Hello', category: 'other', message: 'Hello there' }, read)).status, 403);
    const opened = await api.post('/v1/support/tickets', { requester: 'customer', subject: 'Customer asks', category: 'product', message: 'Which gift card works in Ghana?', customer_reference: 'cust_42' }, { authorization: `Bearer ${writer}` });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    assert.deepEqual([opened.json.source, opened.json.mode, opened.json.queue, opened.json.customer_reference], ['api', 'test', 'reseller', 'cust_42']);
  });
});

describe('retention', () => {
  test('tickets resolved more than two years ago are deleted; open and recent ones stay', async () => {
    const tickets = server.app.get((await import('../dist/support/tickets.service.js')).TicketsService);
    const reseller = await resellerClient(server);
    const base = { resellerId: reseller.resellerId, mode: 'live', requester: 'reseller', queue: 'bitocard', category: 'other', subject: 'Old' };
    const old = await prisma.supportTicket.create({ data: { ...base, status: 'resolved', resolvedAt: new Date(Date.now() - 800 * 24 * 3600_000) } });
    const open = await prisma.supportTicket.create({ data: { ...base, status: 'open', createdAt: new Date(Date.now() - 800 * 24 * 3600_000) } });
    assert.ok((await tickets.purgeOld()) >= 1);
    assert.equal(await prisma.supportTicket.count({ where: { id: old.id } }), 0);
    assert.equal(await prisma.supportTicket.count({ where: { id: open.id } }), 1);
  });
});
