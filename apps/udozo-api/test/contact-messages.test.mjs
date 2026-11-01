// udozo.com's Contact us form: anyone writes to Udozo's support team, who work each message in the admin app (status,
// assignee, replies emailed to the sender, notes), and old messages are deleted.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, startApp } from './helpers.mjs';

let server;
let prisma;
let outbox;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  const { EmailService } = await import('../dist/notifications/email.service.js');
  outbox = server.app.get(EmailService).outbox;
  // Someone to tell about new messages.
  await adminClient(server, ['support']);
});

after(async () => {
  await server?.close();
});

const visitor = () => client(server.base, { autoIdempotency: true });
const message = (over = {}) => ({ kind: 'safe_pay', name: 'Chiamaka Eze', email: `chiamaka${Math.random().toString(36).slice(2, 8)}@example.com`, phone: '+234 803 112 0042', body: 'I paid with Safe pay but the seller has not answered.', country: 'ng', ...over });

describe('Contact us', () => {
  test('anyone sends a message: it is kept, the team told, the sender emailed its reference and nothing they wrote', async () => {
    const sent = message();
    const res = await visitor().post('/v1/contact-messages', sent);
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.match(res.json.reference, /^C-\d{6}$/);
    assert.deepEqual(Object.keys(res.json).sort(), ['created_at', 'kind', 'object', 'reference'], 'never echoes the message back');
    const row = await prisma.contactMessage.findFirstOrThrow({ where: { email: sent.email } });
    assert.deepEqual([row.status, row.country, row.customerId], ['new', 'NG', null]);
    const receipt = outbox.filter(item => item.to === sent.email).at(-1);
    assert.ok(receipt.subject.includes(res.json.reference));
    assert.ok(!receipt.text.includes('seller has not answered'));
    assert.equal(await prisma.notification.count({ where: { type: 'admin.support.contact_message', link: `/support/contact/${row.id}` } }) > 0, true);
  });

  test('checks what it is about, the email and the message, and stops one address flooding', async () => {
    const browser = visitor();
    assert.equal((await browser.post('/v1/contact-messages', message({ kind: 'jobs' }))).status, 400);
    assert.equal((await browser.post('/v1/contact-messages', message({ email: 'not-an-email' }))).status, 400);
    assert.equal((await browser.post('/v1/contact-messages', message({ body: 'Help' }))).status, 400);
    assert.equal((await browser.post('/v1/contact-messages', message({ phone: 'call me maybe' }))).status, 400);
    assert.equal((await browser.post('/v1/contact-messages', message({ phone: '' }))).status, 201, 'the phone is optional');

    const email = `flood${Date.now()}@example.com`;
    for (let i = 0; i < 5; i += 1) assert.equal((await browser.post('/v1/contact-messages', message({ email: i % 2 ? email.toUpperCase() : email }))).status, 201);
    const sixth = await browser.post('/v1/contact-messages', message({ email }));
    assert.deepEqual([sixth.status, sixth.json.error.code], [429, 'contact_limit']);
  });

  test('the support team works it: notes, assigning, a reply emailed to the sender, then resolved', async () => {
    const sent = message({ kind: 'order' });
    await visitor().post('/v1/contact-messages', sent);
    const row = await prisma.contactMessage.findFirstOrThrow({ where: { email: sent.email } });
    const admin = await adminClient(server, ['support']);

    const list = await admin.get(`/v1/admin/support/contact-messages?status=active&q=${encodeURIComponent(sent.email)}`);
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.deepEqual(list.json.data.map(item => [item.id, item.status, item.body]), [[row.id, 'new', sent.body]]);
    assert.ok(list.json.counts.new >= 1);
    assert.equal((await admin.get(`/v1/admin/support/contact-messages?q=C-${String(row.number).padStart(6, '0')}`)).json.data[0].id, row.id);

    const noted = await admin.post(`/v1/admin/support/contact-messages/${row.id}/notes`, { body: 'Checking the order with the seller.' });
    assert.deepEqual([noted.json.status, noted.json.entries.map(entry => entry.kind)], ['open', ['note']]);
    assert.ok(!outbox.some(item => item.to === sent.email && item.text.includes('Checking the order')), 'notes are never emailed');

    const mine = await admin.patch(`/v1/admin/support/contact-messages/${row.id}`, { assignee_id: (await prisma.user.findFirstOrThrow({ where: { realm: 'admin', adminRoles: { has: 'support' } }, orderBy: { createdAt: 'desc' } })).id });
    assert.ok(mine.json.assignee_id);
    assert.equal((await admin.get('/v1/admin/support/contact-messages?assignee=me')).json.data.some(item => item.id === row.id), true);

    const replied = await admin.post(`/v1/admin/support/contact-messages/${row.id}/replies`, { body: 'The seller has shipped it today.\n\nYou will get the tracking number soon.' });
    assert.equal(replied.status, 201, JSON.stringify(replied.json));
    assert.equal(replied.json.status, 'waiting');
    const email = outbox.filter(item => item.to === sent.email).at(-1);
    assert.ok(email.subject.includes(`C-${String(row.number).padStart(6, '0')}`));
    assert.ok(email.text.includes('The seller has shipped it today.'));

    const resolved = await admin.patch(`/v1/admin/support/contact-messages/${row.id}`, { status: 'resolved' });
    assert.deepEqual([resolved.json.status, Boolean(resolved.json.resolved_at)], ['resolved', true]);
    assert.ok(await prisma.auditLog.count({ where: { targetId: row.id, action: 'contact_message.replied' } }));

    const spam = await admin.patch(`/v1/admin/support/contact-messages/${row.id}`, { status: 'spam' });
    assert.equal(spam.json.status, 'spam');
    assert.equal((await admin.post(`/v1/admin/support/contact-messages/${row.id}/replies`, { body: 'Hello' })).json.error.code, 'contact_spam');
  });

  test('only support and operations read them', async () => {
    const finance = await adminClient(server, ['finance']);
    assert.equal((await finance.get('/v1/admin/support/contact-messages')).status, 403);
  });

  test('messages quiet for two years, and spam after 30 days, are deleted', async () => {
    const { ContactMessagesService } = await import('../dist/support/contact-messages.service.js');
    const service = server.app.get(ContactMessagesService);
    const base = { kind: 'other', name: 'Old Sender', body: 'An old message that should go.' };
    const old = await prisma.contactMessage.create({ data: { ...base, email: 'old@example.com', status: 'resolved' } });
    const spam = await prisma.contactMessage.create({ data: { ...base, email: 'spam@example.com', status: 'spam' } });
    const kept = await prisma.contactMessage.create({ data: { ...base, email: 'kept@example.com', status: 'resolved' } });
    await prisma.$executeRaw`UPDATE contact_messages SET updated_at = now() - interval '731 days' WHERE id = ${old.id}::uuid`;
    await prisma.$executeRaw`UPDATE contact_messages SET updated_at = now() - interval '31 days' WHERE id = ${spam.id}::uuid OR id = ${kept.id}::uuid`;
    assert.ok((await service.purgeOld()) >= 2);
    assert.deepEqual((await prisma.contactMessage.findMany({ where: { id: { in: [old.id, spam.id, kept.id] } } })).map(row => row.id), [kept.id]);
  });
});
