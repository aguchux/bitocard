// Afrippa's assistant (docs/CRYPTO_SPINOFF_PLAN.md, step 4): one assistant on Afrippa's own store, set up by Afrippa's
// admins only, on Afrippa's own AI (its key, prices and monthly budget, never BitoCard's), with knowledge generated
// from Afrippa's live settings, Afrippa's rules, and its own tools (ads, fees, safety, the trader's orders). It answers
// visitors' and traders' chats; BitoCard's admins never see it, nor Afrippa's BitoCard's assistants.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, afrippaAdminClient, startApp } from './helpers.mjs';
import { fakeAi } from './fakes.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');

const secret = 'afrippa-assistant-secret-afrippa-assistant-x';
let server;
let ai;
let prisma;
let afrippa;
let bitocard;
let botId;

before(async () => {
  ai = await fakeAi();
  // BitoCard's AI from the environment, as on the droplet: never Afrippa's.
  server = await startApp({ env: { ...ai.env, CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret, ANTHROPIC_API_KEY: 'good-anthropic-bitocard', AI_BITOCARD_MODELS: 'anthropic:claude-haiku-5-5' } });
  prisma = server.app.get(PrismaService);
  afrippa = await afrippaAdminClient(server, ['super_admin']);
  bitocard = await adminClient(server, ['super_admin']);
});

after(async () => {
  await server?.close();
  await ai?.close();
});

const until = async (probe, tries = 80) => {
  for (let n = 0; n < tries; n += 1) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return probe();
};

function visitor(token = null) {
  const request = async (method, path, body) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: { 'afrippa-signature': signAfrippaRequest(secret, { method, url: path, body: raw }), ...(raw !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { 'bitocard-chat-visitor': token } : {}) },
      body: raw,
    });
    const json = await res.json().catch(() => null);
    if (json?.token) token = json.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

const base = '/v1/afrippa/account/support/visitor-chat';

describe("Afrippa's assistant", () => {
  test("runs only on Afrippa's own AI, set up by Afrippa's admins", async () => {
    // BitoCard's AI is set up, but Afrippa has none of its own yet.
    assert.deepEqual((await afrippa.get('/v1/afrippa/admin/support/ai')).json.bitocard_models, []);
    const refused = await afrippa.post('/v1/afrippa/admin/support/bots', { name: 'Ami', roles: ['chat'], provider: 'anthropic', model: 'claude-haiku-5-5', funding: 'bitocard' });
    assert.deepEqual([refused.status, refused.json.error.code], [400, 'ai_model_unavailable']);

    const saved = await afrippa.put('/v1/afrippa/admin/integrations/anthropic', {
      values: { ANTHROPIC_API_KEY: 'good-anthropic-afrippa', ANTHROPIC_API_URL: ai.url, ANTHROPIC_PRICES: 'claude-haiku-5-5 1 5 0.1' },
      code: await adminCode(server, afrippa),
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual((await afrippa.get('/v1/afrippa/admin/support/ai')).json.bitocard_models, [{ provider: 'anthropic', model: 'claude-haiku-5-5' }]);

    const created = await afrippa.post('/v1/afrippa/admin/support/bots', { name: 'Ami', roles: ['chat', 'tickets'], provider: 'anthropic', model: 'claude-haiku-5-5', funding: 'bitocard', limits: { monthly_budget_usd: 50 } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    botId = created.json.id;
    assert.equal(created.json.store_id, '00000000-0000-4000-8000-0000000000a2');
    assert.deepEqual(created.json.limits, { monthly_budget_usd: 50 });
    const again = await afrippa.post('/v1/afrippa/admin/support/bots', { name: 'Two', roles: ['chat'], provider: 'anthropic', model: 'claude-haiku-5-5', funding: 'bitocard' });
    assert.deepEqual([again.status, again.json.error.code], [409, 'store_has_assistant']);

    // Knowledge from Afrippa's live settings, then active.
    const missing = await afrippa.post(`/v1/afrippa/admin/support/bots/${botId}/activate`);
    assert.deepEqual([missing.status, missing.json.error.code], [409, 'assistant_incomplete']);
    const draft = (await afrippa.post(`/v1/afrippa/admin/support/bots/${botId}/knowledge/generate`)).json;
    assert.match(draft.content, /^# Afrippa/);
    assert.match(draft.content, /## How an order works/);
    assert.match(draft.content, /## Safety/);
    assert.doesNotMatch(draft.content, /BitoCard/);
    assert.equal((await afrippa.put(`/v1/afrippa/admin/support/bots/${botId}/knowledge`, { content: draft.content, source: 'generated' })).status, 200);
    const refresh = await afrippa.post(`/v1/afrippa/admin/support/bots/${botId}/knowledge/refresh`, {});
    assert.deepEqual([refresh.status, refresh.json.error.code], [409, 'refresh_unavailable']);
    const active = await afrippa.post(`/v1/afrippa/admin/support/bots/${botId}/activate`);
    assert.equal(active.status, 200, JSON.stringify(active.json));
    assert.equal(active.json.status, 'active');
  });

  test("BitoCard's admins never see it, nor Afrippa's admins BitoCard's", async () => {
    assert.ok(!(await bitocard.get('/v1/admin/support/bots')).json.data.some(bot => bot.id === botId));
    assert.equal((await bitocard.get(`/v1/admin/support/bots/${botId}`)).status, 404);
    assert.equal((await bitocard.post(`/v1/admin/support/bots/${botId}/suspend`, { reason: 'Testing reach' })).status, 404);
    const theirs = (await bitocard.post('/v1/admin/support/bots', { name: 'Bito', roles: ['chat'], provider: 'anthropic', model: 'claude-haiku-5-5', funding: 'bitocard', scope: 'platform' })).json;
    assert.deepEqual((await afrippa.get('/v1/afrippa/admin/support/bots')).json.data.map(bot => bot.id), [botId]);
    assert.equal((await afrippa.get(`/v1/afrippa/admin/support/bots/${theirs.id}`)).status, 404);
  });

  test("answers a visitor with Afrippa's rules and tools, on Afrippa's key, and hands over past its budget", async () => {
    ai.state.calls.length = 0;
    ai.state.script = [{ tool: { name: 'safety_checklist', arguments: {} } }, { text: 'Release only when the money is in your own account.' }];
    const kofi = visitor();
    const started = await kofi.post(base, { name: 'Kofi', email: 'kofi@example.com', body: 'When should I release coins?' });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    const chatId = started.json.chat.id;
    const answered = await until(async () => (await kofi.get(`${base}/${chatId}/messages`)).json.data.find(message => message.author === 'bot'));
    assert.ok(answered, 'the assistant answered');
    assert.equal(answered.author_name, 'Ami');
    assert.match(answered.body, /own account/);

    const first = ai.state.calls[0];
    assert.equal(first.headers['x-api-key'], 'good-anthropic-afrippa', "Afrippa's key, never BitoCard's");
    const system = JSON.stringify(first.body.system);
    assert.match(system, /Afrippa's AI assistant/);
    assert.match(system, /Never act on money/);
    assert.doesNotMatch(system, /BitoCard/);
    const tools = first.body.tools.map(item => item.name).sort();
    assert.deepEqual(tools, ['fees', 'handoff', 'safety_checklist', 'search_ads'], 'a visitor gets no orders tool and no ticket');
    assert.match(JSON.stringify(ai.state.calls[1].body.messages), /Release only when the money is in your own account/);

    // Its use is Afrippa's, in Afrippa's report and never BitoCard's.
    const usage = await prisma.aiUsage.findFirst({ where: { botId }, orderBy: { createdAt: 'desc' } });
    assert.equal(usage.resellerId, '00000000-0000-4000-8000-0000000000a1');
    assert.ok((await afrippa.get('/v1/afrippa/admin/support/ai/usage')).json.data.length >= 1);
    assert.ok(!(await bitocard.get('/v1/admin/support/ai/usage')).json.data.some(row => row.reseller_id === '00000000-0000-4000-8000-0000000000a1'));

    // Past its monthly budget a person answers: the AI is not asked.
    assert.equal((await afrippa.patch(`/v1/afrippa/admin/support/bots/${botId}`, { limits: { monthly_budget_usd: 1 } })).status, 200);
    await prisma.aiUsage.create({ data: { resellerId: '00000000-0000-4000-8000-0000000000a1', storeId: '00000000-0000-4000-8000-0000000000a2', botId, mode: 'live', funding: 'bitocard', provider: 'anthropic', model: 'claude-haiku-5-5', kind: 'chat', inputTokens: 0, cachedTokens: 0, outputTokens: 0, costMicros: 1_000_000n } });
    const asked = ai.state.calls.length;
    assert.equal((await kofi.post(`${base}/messages`, { body: 'And the fees?' })).status, 201);
    const waiting = await until(async () => (await afrippa.get(`/v1/afrippa/admin/support/chats/${chatId}`)).json.status === 'waiting');
    assert.ok(waiting, 'handed to a person');
    assert.equal(ai.state.calls.length, asked);
  });
});

describe("Afrippa's assistant's tools", () => {
  test("a signed-in trader also gets their own orders; tools read, never act; refusals come back in words", async () => {
    const { AfrippaAssistantService } = await import('../dist/afrippa/assistant.service.js');
    const tools = server.app.get(AfrippaAssistantService);
    assert.ok(tools.tools({ customerId: '00000000-0000-4000-8000-000000000123' }).some(item => item.name === 'my_orders'));
    assert.ok(!tools.tools({ customerId: null }).some(item => item.name === 'my_orders'));
    assert.deepEqual(JSON.parse(await tools.run({ customerId: '00000000-0000-4000-8000-000000000123' }, { id: 't', name: 'my_orders', arguments: {} })), []);
    assert.match(await tools.run({ customerId: null }, { id: 't', name: 'fees', arguments: { asset: 'USDT' } }), /not open there yet/);
    assert.equal(await tools.run({ customerId: null }, { id: 't', name: 'release_coins', arguments: {} }), null, 'no such tool');
  });
});
