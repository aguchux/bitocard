// Engineering escalations: a draft issue from the ticket with no personal data (template without AI), the issue opened on
// GitHub and linked to the ticket (once), the requester told, GitHub's signed notifications closing and reopening it and
// sending the ticket back to BitoCard to confirm, and Test connection.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, fakeService, resellerClient, startApp } from './helpers.mjs';

let server;
let github;
let admin;
let prisma;
const issues = [];

before(async () => {
  github = await fakeService(({ method, url, headers, body }) => {
    if (headers.authorization !== 'Bearer ghp_good') return { status: 401, body: { message: 'Bad credentials' } };
    if (method === 'GET' && url === '/repos/golojan/bitocard') return { body: { full_name: 'golojan/bitocard', has_issues: true } };
    if (method === 'POST' && url === '/repos/golojan/bitocard/issues') {
      issues.push(body);
      return { status: 201, body: { number: 41 + issues.length, html_url: `https://github.com/golojan/bitocard/issues/${41 + issues.length}`, state: 'open' } };
    }
    return { status: 404, body: { message: 'Not Found' } };
  });
  server = await startApp({ env: { GITHUB_REPO: 'golojan/bitocard', GITHUB_TOKEN: 'ghp_good', GITHUB_WEBHOOK_SECRET: 'gh-secret', GITHUB_API_URL: github.url, AI_BITOCARD_MODELS: '' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(async () => {
  await server?.close();
  await github?.close();
});

const hook = (event, payload, secret = 'gh-secret') => {
  const raw = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return fetch(`${server.base}/v1/webhooks/github`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': signature }, body: raw }).then(async res => ({ status: res.status, json: await res.json() }));
};

describe('engineering escalations', () => {
  test('a draft without personal data; the issue opened once and linked; the requester told', async () => {
    const reseller = await resellerClient(server);
    const ticket = (await reseller.browser.post('/v1/support/tickets', { requester: 'reseller', subject: 'Webhook signatures fail', category: 'technical', message: 'Deliveries to ada@example.com fail; call me on +2348031234567. Card 4111 1111 1111 1111.' })).json;
    const draft = await admin.get(`/v1/admin/support/tickets/${ticket.id}/github-issue/draft`);
    assert.equal(draft.status, 200, JSON.stringify(draft.json));
    assert.equal(draft.json.drafted_by, 'template', 'no AI on BitoCard’s keys here');
    assert.ok(!/ada@example\.com|8031234567|4111/.test(JSON.stringify(draft.json)), 'no personal data in the draft');
    assert.match(draft.json.body, /\[email removed\]/);

    const opened = await admin.post(`/v1/admin/support/tickets/${ticket.id}/github-issue`, { title: draft.json.title, body: `${draft.json.body}\nReported by ada@example.com`, kind: 'bug' });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    assert.deepEqual(opened.json.github_issue, { number: 42, url: 'https://github.com/golojan/bitocard/issues/42', state: 'open' });
    const sent = issues.at(-1);
    assert.deepEqual(sent.labels, ['support', 'bug']);
    assert.ok(!sent.body.includes('ada@example.com'), 'redacted again on the way out');
    assert.match(sent.body, /From BitoCard support ticket T-\d{6}/);
    const seen = (await reseller.browser.get(`/v1/support/tickets/${ticket.id}`)).json;
    assert.equal(seen.messages.at(-1).body, 'We have passed this to our engineers. We will update you here.');
    assert.ok(!JSON.stringify(seen).includes('github.com'), 'the issue link is BitoCard’s, a staff note');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'support_ticket.github_issue', targetId: ticket.id } }));
    assert.equal((await admin.post(`/v1/admin/support/tickets/${ticket.id}/github-issue`, { title: 'Again please', body: 'Once more, the same thing.', kind: 'bug' })).json.error.code, 'ticket_has_issue');
  });

  test('GitHub’s signed notifications: closed sends the ticket back to BitoCard to confirm; reopened is noted; others ignored', async () => {
    const reseller = await resellerClient(server);
    const ticket = (await reseller.browser.post('/v1/support/tickets', { requester: 'reseller', subject: 'Export fails', category: 'technical', message: 'The orders export times out.' })).json;
    const opened = (await admin.post(`/v1/admin/support/tickets/${ticket.id}/github-issue`, { title: 'Orders export times out', body: 'Steps: export a month of orders.', kind: 'bug' })).json;
    await admin.post(`/v1/admin/support/tickets/${ticket.id}/messages`, { body: 'Our engineers are on it.' });
    const repository = { full_name: 'golojan/bitocard' };
    assert.equal((await hook('issues', { action: 'closed', issue: { number: opened.github_issue.number }, repository }, 'wrong')).status, 401);
    assert.deepEqual((await hook('push', { ref: 'main', repository })).json.outcome, 'ignored');
    assert.deepEqual((await hook('issues', { action: 'closed', issue: { number: 999 }, repository })).json.outcome, 'unknown');
    const closed = await hook('issues', { action: 'closed', issue: { number: opened.github_issue.number, state: 'closed', state_reason: 'completed' }, repository });
    assert.deepEqual([closed.status, closed.json.outcome], [200, 'closed']);
    const row = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id }, include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    assert.deepEqual([row.status, row.githubIssueState], ['open', 'closed'], 'BitoCard’s turn: confirm the fix');
    assert.match(row.messages[0].body, /closed issue #\d+ as done/);
    assert.equal(row.messages[0].visibility, 'staff');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.support.issue_closed' } }));
    assert.deepEqual((await hook('issues', { action: 'closed', issue: { number: opened.github_issue.number }, repository })).json.outcome, 'unchanged', 'a repeat changes nothing');
    assert.deepEqual((await hook('issues', { action: 'reopened', issue: { number: opened.github_issue.number }, repository })).json.outcome, 'reopened');
  });

  test('Test connection reads the repository with the token', async () => {
    const tested = await admin.post('/v1/admin/integrations/github/test');
    assert.equal(tested.status, 200, JSON.stringify(tested.json));
    assert.deepEqual([tested.json.ok, tested.json.message], [true, 'Issues go to golojan/bitocard.']);
  });
});
