// AI for support: the Anthropic, OpenAI and DeepSeek adapters (cached knowledge, tool calls, usage), prices and costs;
// resellers' own keys (checked with the provider, encrypted, never returned); BitoCard's keys only on Premium, within
// the monthly allowance of replies per store; usage recorded; a refused own key stops being used; Test connection.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, resellerClient, startApp } from './helpers.mjs';
import { fakeAi } from './fakes.mjs';

const { AnthropicProvider, OpenAiCompatibleProvider, parseAiPrices, aiCostMicros, parseModelList } = await import('../dist/support/ai/providers.js');

let server;
let ai;
let admin;
let prisma;
let service;

before(async () => {
  ai = await fakeAi();
  server = await startApp({
    env: {
      ...ai.env,
      ANTHROPIC_API_KEY: 'good-anthropic-bitocard',
      OPENAI_API_KEY: 'good-openai-bitocard',
      ANTHROPIC_PRICES: 'claude-haiku-5-5 1 5 0.1',
      AI_BITOCARD_MODELS: 'anthropic:claude-haiku-5-5, openai:gpt-5-mini, deepseek:deepseek-chat',
      AI_MONTHLY_REPLIES: '2',
    },
  });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  service = server.app.get((await import('../dist/support/ai/ai.service.js')).AiService);
});

after(async () => {
  await server?.close();
  await ai?.close();
});

const request = { system: 'You are a support assistant.', context: '# About the store\nWe sell gift cards.', messages: [{ role: 'user', content: 'Hi' }], tools: [{ name: 'search_products', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } } } }], maxTokens: 300 };

describe('the adapters', () => {
  test('Anthropic: knowledge as a cached system block, tools as input_schema, tool calls and cached usage read back', async () => {
    const claude = new AnthropicProvider({ apiKey: 'good-key', baseUrl: ai.url });
    ai.state.tool = { name: 'search_products', arguments: { query: 'amazon' } };
    const first = await claude.reply({ ...request, model: 'claude-haiku-5-5' });
    assert.deepEqual(first.toolCalls, [{ id: 'toolu_1', name: 'search_products', arguments: { query: 'amazon' } }]);
    assert.deepEqual(first.usage, { input: 1000, cached: 900, output: 20 }, 'the whole prompt, as OpenAI counts it');
    const sent = ai.state.calls.at(-1);
    assert.equal(sent.headers['anthropic-version'], '2023-06-01');
    assert.deepEqual(sent.body.system[1], { type: 'text', text: request.context, cache_control: { type: 'ephemeral' } });
    assert.deepEqual(sent.body.tools[0].input_schema, request.tools[0].parameters);
    const second = await claude.reply({
      ...request,
      model: 'claude-haiku-5-5',
      messages: [...request.messages, { role: 'assistant', content: 'Let me check.', toolCalls: first.toolCalls }, { role: 'tool', toolCallId: 'toolu_1', name: 'search_products', content: '[]' }],
    });
    assert.equal(second.text, 'Hello from the assistant.');
    assert.deepEqual(ai.state.calls.at(-1).body.messages.at(-1), { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '[]' }] });
  });

  test('OpenAI and DeepSeek: chat completions with function tools; their own token names and caching read', async () => {
    const openai = new OpenAiCompatibleProvider('openai', { apiKey: 'good-key', baseUrl: ai.url });
    ai.state.tool = { name: 'search_products', arguments: { query: 'steam' } };
    const called = await openai.reply({ ...request, model: 'gpt-5-mini' });
    assert.deepEqual([called.text, called.toolCalls[0].arguments, called.usage], [null, { query: 'steam' }, { input: 1000, cached: 700, output: 30 }]);
    const sent = ai.state.calls.at(-1);
    assert.deepEqual([sent.path, sent.body.max_completion_tokens, sent.body.messages[0].content.startsWith('# About the store')], ['/v1/chat/completions', 300, true]);
    const deepseek = new OpenAiCompatibleProvider('deepseek', { apiKey: 'good-key', baseUrl: ai.url });
    const replied = await deepseek.reply({ ...request, model: 'deepseek-chat' });
    assert.deepEqual([replied.text, replied.usage.cached, ai.state.calls.at(-1).path, ai.state.calls.at(-1).body.max_tokens], ['Hello from the assistant.', 800, '/chat/completions', 300]);
    await assert.rejects(new OpenAiCompatibleProvider('openai', { apiKey: 'bad-key', baseUrl: ai.url }).check(), error => error.definite === true);
  });

  test('prices, costs and model lists', () => {
    const prices = parseAiPrices('claude-haiku-5-5 1 5 0.1; gpt-5-mini 0.25 2; nonsense');
    assert.deepEqual([...prices.keys()], ['claude-haiku-5-5', 'gpt-5-mini']);
    assert.equal(prices.get('gpt-5-mini').cached, 0.25, 'cached input at the input price unless given');
    assert.equal(aiCostMicros({ input: 1000, cached: 900, output: 20 }, prices.get('claude-haiku-5-5')), 290n, '100×1 + 900×0.1 + 20×5');
    assert.equal(aiCostMicros({ input: 10, cached: 0, output: 10 }, undefined), 0n);
    assert.deepEqual(parseModelList('anthropic:claude-haiku-5-5, bogus:x, openai:'), [{ provider: 'anthropic', model: 'claude-haiku-5-5' }]);
  });
});

describe('keys, plans, allowance and usage', () => {
  test('a reseller’s own key is checked with the provider, kept encrypted and shown only by its last four', async () => {
    const reseller = await resellerClient(server);
    const refused = await reseller.browser.put('/v1/support/ai/keys/openai', { api_key: 'bad-key-0000000000000000' });
    assert.deepEqual([refused.status, refused.json.error.code], [400, 'ai_key_refused']);
    const saved = await reseller.browser.put('/v1/support/ai/keys/openai', { api_key: 'good-reseller-openai-1234' });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([saved.json.last4, saved.json.models], ['1234', ['gpt-5-mini']]);
    const row = await prisma.aiKey.findFirstOrThrow({ where: { resellerId: reseller.resellerId } });
    assert.ok(!row.keyEncrypted.includes('good-reseller'), 'encrypted at rest');
    const overview = (await reseller.browser.get('/v1/support/ai')).json;
    assert.equal(overview.premium, false);
    assert.equal(overview.providers.find(item => item.provider === 'openai').own_key.last4, '1234');
    assert.deepEqual(overview.providers.find(item => item.provider === 'anthropic').bitocard_models, ['claude-haiku-5-5']);
    assert.deepEqual(overview.providers.find(item => item.provider === 'deepseek').bitocard_models, [], 'only providers BitoCard has a key for');
    assert.ok(!JSON.stringify(overview).includes('good-reseller'));
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'ai_key.saved', targetId: reseller.resellerId } }));
    assert.equal((await reseller.browser.delete('/v1/support/ai/keys/openai')).status, 204);
    assert.equal(await prisma.aiKey.count({ where: { resellerId: reseller.resellerId } }), 0);
  });

  test('BitoCard’s AI needs Premium, counts replies against the store’s allowance, and records cost', async () => {
    const reseller = await resellerClient(server);
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { country: 'NG' } });
    const store = (await reseller.browser.post('/v1/stores', { name: 'AI Store', subdomain: `aistore${Date.now().toString(36)}` })).json;
    const call = { funding: 'bitocard', provider: 'anthropic', model: 'claude-haiku-5-5', resellerId: reseller.resellerId, storeId: store.id, botId: null, mode: 'live', kind: 'chat' };
    const asks = { system: 'Be helpful.', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 100 };
    await assert.rejects(service.reply(call, asks), error => error.code === 'ai_plan_required');
    // The assistant is per store: the store's own plan includes it.
    await prisma.storeSubscription.create({ data: { storeId: store.id, resellerId: reseller.resellerId, planCode: 'premium' } });
    await assert.rejects(service.reply({ ...call, model: 'claude-opus-5-5' }, asks), error => error.code === 'ai_model_unavailable');
    await service.reply(call, asks);
    await service.reply({ ...call, kind: 'test' }, asks);
    await service.reply(call, asks);
    await assert.rejects(service.reply(call, asks), error => error.code === 'ai_allowance_reached', 'two replies a month in this test');
    const rows = await prisma.aiUsage.findMany({ where: { resellerId: reseller.resellerId } });
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(row => Number(row.costMicros)), [290, 290, 290]);
    const usage = (await reseller.browser.get('/v1/support/ai/usage')).json;
    assert.equal(usage.data.reduce((sum, row) => sum + row.calls, 0), 3);
    const adminUsage = (await admin.get('/v1/admin/support/ai/usage')).json;
    assert.ok(adminUsage.data.some(row => row.reseller_id === reseller.resellerId && row.cost_usd > 0));
  });

  test('a store that pays as it goes keeps answering past its allowance, each reply a usage line at cost plus margin', async () => {
    for (const source of ['open_exchange_rates', 'flutterwave']) {
      await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
    }
    const reseller = await resellerClient(server);
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { country: 'NG' } });
    const store = (await reseller.browser.post('/v1/stores', { name: 'Paying Store', subdomain: `paying${Date.now().toString(36)}` })).json;
    await prisma.storeSubscription.create({ data: { storeId: store.id, resellerId: reseller.resellerId, planCode: 'premium' } });
    const call = { funding: 'bitocard', provider: 'anthropic', model: 'claude-haiku-5-5', resellerId: reseller.resellerId, storeId: store.id, botId: null, mode: 'live', kind: 'chat' };
    const asks = { system: 'Be helpful.', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 100 };
    await service.reply(call, asks);
    await service.reply(call, asks);
    await assert.rejects(service.reply(call, asks), error => error.code === 'ai_allowance_reached');
    assert.equal(await prisma.invoiceLine.count({ where: { invoice: { resellerId: reseller.resellerId } } }), 0, 'replies inside the allowance are not billed');

    const chosen = await reseller.browser.patch(`/v1/stores/${store.id}`, { ai_overage: 'pay' });
    assert.deepEqual([chosen.status, chosen.json.ai_overage], [200, 'pay']);
    await service.reply(call, asks);
    const [line] = await prisma.invoiceLine.findMany({ where: { invoice: { resellerId: reseller.resellerId, storeId: store.id } } });
    assert.equal(line.kind, 'usage');
    // 290 millionths of a dollar plus Premium's 20% is 348; in naira at BitoCard's rate, rounded up, owed (the wallet is empty).
    assert.ok(line.amountMinor > 0n && line.paidMinor === 0n, `${line.amountMinor} ${line.paidMinor}`);
    assert.equal((await reseller.browser.get('/v1/billing/credit')).json.owed[0].amount, Number(line.amountMinor));
  });

  test('an own key the provider later refuses stops being used until replaced', async () => {
    const reseller = await resellerClient(server);
    await reseller.browser.put('/v1/support/ai/keys/anthropic', { api_key: 'good-reseller-anthropic-99' });
    const call = { funding: 'own', provider: 'anthropic', model: 'claude-haiku-5-5', resellerId: reseller.resellerId, storeId: null, botId: null, mode: 'live', kind: 'chat' };
    const asks = { system: 'Be helpful.', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 100 };
    const replied = await service.reply(call, asks);
    assert.equal(replied.text, 'Hello from the assistant.');
    assert.equal((await prisma.aiUsage.findFirstOrThrow({ where: { resellerId: reseller.resellerId } })).costMicros, 0n, 'the store pays its own provider');
    const { Encryption } = await import('../dist/common/encryption.js');
    const encryption = new Encryption(process.env.ENCRYPTION_KEY ?? server.app.get((await import('../dist/config/config.js')).APP_CONFIG).ENCRYPTION_KEY);
    await prisma.aiKey.updateMany({ where: { resellerId: reseller.resellerId }, data: { keyEncrypted: encryption.encrypt('revoked-key-000000') } });
    await assert.rejects(service.reply(call, asks), error => error.status === 401);
    assert.ok((await prisma.aiKey.findFirstOrThrow({ where: { resellerId: reseller.resellerId } })).failedAt);
    await assert.rejects(service.reply(call, asks), error => error.code === 'ai_unavailable');
  });

  test('Test connection reads the models with BitoCard’s key', async () => {
    const tested = await admin.post('/v1/admin/integrations/anthropic/test');
    assert.equal(tested.status, 200, JSON.stringify(tested.json));
    assert.deepEqual([tested.json.ok, tested.json.message], [true, 'The key can use 2 models.']);
    const deepseek = (await admin.post('/v1/admin/integrations/deepseek/test')).json;
    assert.deepEqual([deepseek.ok, deepseek.message], [false, 'Set the API key first.']);
    const saved = await admin.put('/v1/admin/integrations/deepseek', { values: { DEEPSEEK_API_KEY: 'bad-deepseek-key' }, code: await adminCode(server, admin) });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const refused = (await admin.post('/v1/admin/integrations/deepseek/test')).json;
    assert.equal(refused.ok, false);
    assert.match(refused.message, /refused this key/);
  });
});
