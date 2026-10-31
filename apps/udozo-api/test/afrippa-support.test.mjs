// Afrippa's help desk (docs/CRYPTO_SPINOFF_PLAN.md, Instruments lifted): a trader's tickets go to Afrippa's own queue
// (`afrippa`), answered by Afrippa's admins only. BitoCard's admins never reach them (lists, reads, replies,
// engineering), no reseller webhook event is written for them, and Afrippa's admins never reach BitoCard's tickets.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, afrippaAdminClient, startApp } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { afrippaOperatorId } = await import('../dist/afrippa/ids.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-support-secret-afrippa-support-secret';
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

function afrippaServer(token = null) {
  const request = async (method, path, body) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        'afrippa-signature': signAfrippaRequest(secret, { method, url: path, body: raw }),
        ...(raw !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `help-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

const lastCodeTo = email => /\b(\d{6})\b/.exec(server.app.get(EmailService).outbox.filter(item => item.to === email).at(-1).subject)[1];

async function trader() {
  const client = afrippaServer();
  const email = `help-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name: 'Ada Trader', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  return { client, id: signup.json.customer.id };
}

describe("Afrippa's help desk", () => {
  test('a trader asks Afrippa; only Afrippa’s admins answer, as "Afrippa"; BitoCard never sees it', async () => {
    const ada = await trader();
    const support = await afrippaAdminClient(server, ['support']);
    const bitocard = await adminClient(server, ['super_admin']);

    const opened = await ada.client.post('/v1/afrippa/account/support/tickets', { subject: 'My order is stuck', category: 'order', message: 'The seller has not released my coins.' });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    const id = opened.json.id;
    const row = await prisma.supportTicket.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.queue, row.resellerId], ['afrippa', afrippaOperatorId]);
    assert.equal(await prisma.event.count({ where: { resellerId: afrippaOperatorId } }), 0, 'no reseller webhook events');

    // Afrippa's admins: told, and it is in their queue.
    const told = (await support.get('/v1/afrippa/admin/notifications')).json.data;
    assert.ok(told.some(item => item.title === 'A trader needs help' && item.link === `/support/tickets/${id}`));
    assert.ok((await support.get('/v1/afrippa/admin/support/tickets')).json.data.some(item => item.id === id));

    // BitoCard's admins: not in any queue, not found by id, not escalated to engineering.
    for (const queue of ['', '?queue=reseller', '?queue=bitocard']) {
      assert.equal((await bitocard.get(`/v1/admin/support/tickets${queue}`)).json.data.some(item => item.id === id), false);
    }
    assert.equal((await bitocard.get(`/v1/admin/support/tickets/${id}`)).status, 404);
    assert.equal((await bitocard.post(`/v1/admin/support/tickets/${id}/messages`, { body: 'Hello' })).status, 404);
    assert.equal((await bitocard.get(`/v1/admin/support/tickets/${id}/github-issue/draft`)).status, 404);
    assert.equal((await bitocard.post(`/v1/admin/support/tickets/${id}/resolve`, {})).status, 404);

    // Afrippa answers: the trader's turn, the trader told on afrippa.com's /help, never the person's name.
    const answered = await support.post(`/v1/afrippa/admin/support/tickets/${id}/messages`, { body: 'We are looking at the order now.' });
    assert.equal(answered.status, 201, JSON.stringify(answered.json));
    assert.equal(answered.json.status, 'pending');
    const seen = (await ada.client.get(`/v1/afrippa/account/support/tickets/${id}`)).json;
    assert.deepEqual([seen.messages.at(-1).author, seen.messages.at(-1).author_name], ['afrippa', null]);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: ada.id, type: 'customer.support.ticket_replied', link: `/help/${id}` } }));

    // A staff note stays with Afrippa's admins.
    await support.post(`/v1/afrippa/admin/support/tickets/${id}/messages`, { body: 'Checked the room: the buyer paid.', visibility: 'staff' });
    assert.equal((await ada.client.get(`/v1/afrippa/account/support/tickets/${id}`)).json.messages.some(item => item.body.includes('buyer paid')), false);

    // The trader replies: Afrippa's turn again, its admins told.
    assert.equal((await ada.client.post(`/v1/afrippa/account/support/tickets/${id}/messages`, { body: 'Thank you.' })).json.status, 'open');
    assert.ok((await support.get('/v1/afrippa/admin/notifications')).json.data.some(item => item.title === 'A trader replied to a ticket'));

    const resolved = await support.post(`/v1/afrippa/admin/support/tickets/${id}/resolve`, { note: 'Released by the seller.' });
    assert.equal(resolved.json.status, 'resolved');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'support_ticket.resolved', targetId: id, platform: 'afrippa' } }));
    assert.equal(await prisma.event.count({ where: { resellerId: afrippaOperatorId } }), 0);
  });

  test('Afrippa’s admins never reach BitoCard’s tickets, and assign only to their own admins', async () => {
    const support = await afrippaAdminClient(server, ['support']);
    const bitocardAdmin = await adminClient(server, ['support']);
    const store = await prisma.store.findFirstOrThrow({ where: { platform: 'bitocard' } });
    const theirs = await prisma.supportTicket.create({ data: { resellerId: store.resellerId, mode: 'test', requester: 'reseller', queue: 'bitocard', category: 'other', subject: 'A BitoCard question' } });
    assert.equal((await support.get(`/v1/afrippa/admin/support/tickets/${theirs.id}`)).status, 404);
    assert.equal((await support.get('/v1/afrippa/admin/support/tickets')).json.data.some(item => item.id === theirs.id), false);

    const ada = await trader();
    const mine = (await ada.client.post('/v1/afrippa/account/support/tickets', { subject: 'A question', category: 'account', message: 'How do I change my method?' })).json;
    const bitocardUser = await prisma.user.findFirstOrThrow({ where: { realm: 'admin', email: bitocardAdmin.admin.email } });
    assert.equal((await support.patch(`/v1/afrippa/admin/support/tickets/${mine.id}`, { assignee_id: bitocardUser.id })).json.error.code, 'parameter_invalid');
    const self = await prisma.user.findFirstOrThrow({ where: { realm: 'afrippa_admin', email: support.admin.email } });
    assert.equal((await support.patch(`/v1/afrippa/admin/support/tickets/${mine.id}`, { assignee_id: self.id, priority: 'high' })).json.priority, 'high');
  });
});
