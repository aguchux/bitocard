// Support bots: create (role + AI agent + profile), knowledge (CSV FAQs turned into Markdown, the template, versions),
// Generate from BitoCard from the store's own data, Update knowledge base (only BitoCard's sections; asking before
// replacing one the owner edited), the daily stale check and automatic updates, activation checks, one bot per store,
// the playground with BitoCard's rules, and BitoCard's own assistants and suspensions.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, listForTest, resellerClient, startApp } from './helpers.mjs';
import { fakeAi } from './fakes.mjs';

let server;
let ai;
let admin;
let prisma;
let bots;
let counter = 0;

before(async () => {
  ai = await fakeAi();
  server = await startApp({ env: { ...ai.env, ANTHROPIC_API_KEY: 'good-anthropic-bitocard', AI_BITOCARD_MODELS: 'anthropic:claude-haiku-5-5' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  bots = server.app.get((await import('../dist/support/bots.service.js')).BotsService);
});

after(async () => {
  await server?.close();
  await ai?.close();
});

async function giftCard(title) {
  const created = await admin.post('/v1/admin/stock', {
    category: 'gift_cards',
    country: 'NG',
    brand: 'amazon',
    title,
    description: 'An Amazon gift card.',
    redeem_instructions: 'Redeem at amazon.com/redeem.',
    currency: 'USD',
    face_value: 2500,
    cost: 2000,
    listed: true,
    codes: [{ code: `${title.replace(/\W/g, '')}-${Date.now()}-${Math.random()}`.slice(0, 60) }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.product;
}

/** A verified reseller with a store (listing `products`) and their own Anthropic key. */
async function resellerWithStore(products = []) {
  const reseller = await resellerClient(server);
  await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
  const subdomain = `bot${(counter += 1)}${Date.now().toString(36)}`.slice(0, 30);
  const store = (await reseller.browser.post('/v1/stores', { name: 'Ada Digital', subdomain })).json;
  if (products.length) await listForTest(server, { resellerId: reseller.resellerId, productIds: products.map(item => item.id) });
  assert.equal((await reseller.browser.put('/v1/support/ai/keys/anthropic', { api_key: 'good-reseller-anthropic-key' })).status, 200);
  return { ...reseller, storeId: store.id };
}

const create = (reseller, extra = {}) =>
  reseller.browser.post('/v1/support/bots', { name: 'Kemi', roles: ['chat', 'tickets'], provider: 'anthropic', model: 'claude-haiku-5-5', funding: 'own', store_id: reseller.storeId, tone: 'friendly', greeting: 'Hi! How can I help?', ...extra });

describe('creating an assistant', () => {
  test('role, AI agent and profile; activation waits for knowledge; CSV FAQs become Markdown; then it is active', async () => {
    const reseller = await resellerWithStore();
    const made = await create(reseller);
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.deepEqual([made.json.status, made.json.roles, made.json.store_name, made.json.knowledge], ['draft', ['chat', 'tickets'], 'Ada Digital', null]);
    const early = await reseller.browser.post(`/v1/support/bots/${made.json.id}/activate`);
    assert.deepEqual([early.status, early.json.error.code], [409, 'assistant_incomplete']);
    assert.match(early.json.error.message, /knowledge/);

    const template = (await reseller.browser.get('/v1/support/knowledge-template?format=csv')).json;
    assert.match(template.content, /^question,answer,category/);
    const bad = await reseller.browser.put(`/v1/support/bots/${made.json.id}/knowledge`, { content: 'just,some,columns\n1,2,3', format: 'csv' });
    assert.equal(bad.json.error.code, 'knowledge_invalid');
    const saved = await reseller.browser.put(`/v1/support/bots/${made.json.id}/knowledge`, { content: template.content, format: 'csv' });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.match(saved.json.current.content, /# FAQs[\s\S]*### How long does airtime take\?\nUsually seconds\./);
    assert.equal(saved.json.current.version, 1);
    const tooLong = await reseller.browser.put(`/v1/support/bots/${made.json.id}/knowledge`, { content: 'x'.repeat(60_001) });
    assert.equal(tooLong.json.error.code, 'knowledge_too_long');

    const active = await reseller.browser.post(`/v1/support/bots/${made.json.id}/activate`);
    assert.deepEqual([active.status, active.json.status, active.json.knowledge.version], [200, 'active', 1]);
    assert.equal((await create(reseller, { name: 'Second' })).json.error.code, 'store_has_assistant', 'one per store');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'support_bot.activated', targetId: made.json.id } }));
  });

  test('BitoCard’s AI needs Premium and an offered model; own keys need a working key', async () => {
    const reseller = await resellerWithStore();
    assert.equal((await create(reseller, { funding: 'bitocard', model: 'claude-opus-5-5' })).json.error.code, 'ai_model_unavailable');
    const bot = (await create(reseller, { funding: 'bitocard' })).json;
    await reseller.browser.put(`/v1/support/bots/${bot.id}/knowledge`, { content: '# About\nWe sell gift cards.' });
    const refused = await reseller.browser.post(`/v1/support/bots/${bot.id}/activate`);
    assert.match(refused.json.error.message, /Premium/);
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { planCode: 'premium' } });
    assert.equal((await reseller.browser.post(`/v1/support/bots/${bot.id}/activate`)).json.status, 'active');
    await reseller.browser.delete('/v1/support/ai/keys/anthropic');
    const switched = await reseller.browser.patch(`/v1/support/bots/${bot.id}`, { funding: 'own' });
    assert.equal(switched.json.status, 'paused', 'a change that breaks an active assistant pauses it');
  });

  test('the playground answers with BitoCard’s rules first and the knowledge as a cached block', async () => {
    const reseller = await resellerWithStore();
    const bot = (await create(reseller)).json;
    await reseller.browser.put(`/v1/support/bots/${bot.id}/knowledge`, { content: '# About the store\nWe open 9 to 5.' });
    ai.state.next = 'We open from 9 to 5.';
    const tested = await reseller.browser.post(`/v1/support/bots/${bot.id}/test`, { messages: [{ role: 'user', content: 'When are you open?' }] });
    assert.equal(tested.status, 200, JSON.stringify(tested.json));
    assert.equal(tested.json.reply, 'We open from 9 to 5.');
    const sent = ai.state.calls.at(-1).body;
    assert.match(sent.system[0].text, /^You are Kemi, the AI support assistant for customers of Ada Digital/);
    assert.match(sent.system[0].text, /Never reveal, ask for or repeat codes/);
    assert.match(sent.system[1].text, /We open 9 to 5\./);
    assert.deepEqual(sent.system[1].cache_control, { type: 'ephemeral' });
    assert.equal((await prisma.aiUsage.findFirstOrThrow({ where: { botId: bot.id } })).kind, 'test');
  });
});

describe('Generate from BitoCard and Update knowledge base', () => {
  test('generated from the store’s data; an update replaces only changed BitoCard sections and asks about edited ones', async () => {
    const first = await giftCard('Amazon Knowledge One');
    const reseller = await resellerWithStore([first]);
    const bot = (await create(reseller)).json;
    const draft = (await reseller.browser.post(`/v1/support/bots/${bot.id}/knowledge/generate`)).json;
    assert.match(draft.content, /<!-- bitocard:catalogue -->[\s\S]*Amazon Knowledge One[\s\S]*<!-- \/bitocard:catalogue -->/);
    assert.match(draft.content, /# About the store\n\(Who you are/, 'the owner’s sections are placeholders outside the markers');
    assert.match(draft.content, /Gift cards: the code \(and PIN\) is on the order page/);
    const owned = draft.content.replace('(Who you are and who you serve, in two or three sentences. BitoCard never changes this section.)', 'We are Lagos’ friendliest gift card shop.');
    await reseller.browser.put(`/v1/support/bots/${bot.id}/knowledge`, { content: owned, source: 'generated' });

    const quiet = (await reseller.browser.post(`/v1/support/bots/${bot.id}/knowledge/refresh`, {})).json;
    assert.ok(quiet.sections.every(section => section.state === 'unchanged'), 'nothing changed yet');

    const second = await giftCard('Amazon Knowledge Two');
    await listForTest(server, { resellerId: reseller.resellerId, productIds: [second.id] });
    const knowledge = (await reseller.browser.get(`/v1/support/bots/${bot.id}/knowledge`)).json.current.content;
    const edited = knowledge.replace('- A failed order is refunded in full, the way it was paid.', '- A failed order is refunded in full within a day.');
    await reseller.browser.put(`/v1/support/bots/${bot.id}/knowledge`, { content: edited, source: 'edited' });

    const preview = (await reseller.browser.post(`/v1/support/bots/${bot.id}/knowledge/refresh`, {})).json;
    const states = Object.fromEntries(preview.sections.map(section => [section.key, section.state]));
    assert.equal(states.catalogue, 'changed');
    assert.equal(preview.sections.find(section => section.key === 'catalogue').added, 1);
    assert.equal(states.refunds, 'edited', 'the owner’s edit is told apart from a store change');
    const applied = (await reseller.browser.post(`/v1/support/bots/${bot.id}/knowledge/refresh`, { apply: ['catalogue'] })).json;
    assert.deepEqual(applied.applied, ['catalogue']);
    assert.match(applied.knowledge.current.content, /Amazon Knowledge Two/);
    assert.match(applied.knowledge.current.content, /refunded in full within a day/, 'the owner’s edit kept');
    assert.match(applied.knowledge.current.content, /Lagos’ friendliest gift card shop/, 'the owner’s own section never touched');
    assert.equal(applied.knowledge.current.source, 'refreshed');
    const restored = await reseller.browser.post(`/v1/support/bots/${bot.id}/knowledge/restore`, { version: 1 });
    assert.equal(restored.json.current.version, 1);
  });

  test('the daily check flags a store that changed (once, telling the owner); automatic updates apply it instead', async () => {
    const first = await giftCard('Amazon Stale One');
    const flagged = await resellerWithStore([first]);
    const auto = await resellerWithStore([first]);
    const flaggedBot = (await create(flagged)).json;
    const autoBot = (await create(auto, { auto_refresh: true })).json;
    for (const [owner, bot] of [[flagged, flaggedBot], [auto, autoBot]]) {
      const draft = (await owner.browser.post(`/v1/support/bots/${bot.id}/knowledge/generate`)).json;
      await owner.browser.put(`/v1/support/bots/${bot.id}/knowledge`, { content: draft.content, source: 'generated' });
    }
    const added = await giftCard('Amazon Stale Two');
    await listForTest(server, { resellerId: flagged.resellerId, productIds: [added.id] });
    await listForTest(server, { resellerId: auto.resellerId, productIds: [added.id] });
    await bots.checkStale(1000);
    await bots.checkStale(1000);
    const flaggedRow = await prisma.supportBot.findUniqueOrThrow({ where: { id: flaggedBot.id } });
    assert.ok(flaggedRow.knowledgeStaleAt);
    assert.equal(await prisma.notification.count({ where: { type: 'support.knowledge_stale', resellerId: flagged.resellerId } }), 1, 'told once');
    const autoKnowledge = (await auto.browser.get(`/v1/support/bots/${autoBot.id}/knowledge`)).json;
    assert.deepEqual([autoKnowledge.current.source, autoKnowledge.stale_since], ['refreshed', null]);
    assert.match(autoKnowledge.current.content, /Amazon Stale Two/);
    await flagged.browser.post(`/v1/support/bots/${flaggedBot.id}/knowledge/refresh`, { apply: ['catalogue'] });
    assert.equal((await prisma.supportBot.findUniqueOrThrow({ where: { id: flaggedBot.id } })).knowledgeStaleAt, null);
  });
});

describe('BitoCard’s assistants and suspensions', () => {
  test('admins run the assistant for resellers and bitocard.com’s; they cannot edit a reseller’s, only suspend it', async () => {
    const platform = await admin.post('/v1/admin/support/bots', { name: 'Bito', roles: ['chat'], provider: 'anthropic', model: 'claude-haiku-5-5', funding: 'bitocard', scope: 'platform' });
    assert.equal(platform.status, 201, JSON.stringify(platform.json));
    assert.deepEqual([platform.json.scope, platform.json.store_id], ['platform', null]);
    assert.equal((await admin.post('/v1/admin/support/bots', { name: 'Again', roles: ['chat'], provider: 'anthropic', model: 'claude-haiku-5-5', funding: 'bitocard', scope: 'platform' })).json.error.code, 'platform_assistant_exists');
    await admin.put(`/v1/admin/support/bots/${platform.json.id}/knowledge`, { content: '# SHQ\nHelp for resellers.' });
    assert.equal((await admin.post(`/v1/admin/support/bots/${platform.json.id}/activate`)).json.status, 'active', 'BitoCard’s own accounts have its AI');

    const reseller = await resellerWithStore();
    const theirs = (await create(reseller)).json;
    assert.equal((await reseller.browser.post('/v1/support/bots', { name: 'X', roles: ['chat'], provider: 'anthropic', model: 'claude-haiku-5-5', funding: 'own', scope: 'platform' })).status, 400);
    assert.equal((await admin.patch(`/v1/admin/support/bots/${theirs.id}`, { name: 'Hijack' })).json.error.code, 'not_bitocard_assistant');
    assert.ok((await admin.get('/v1/admin/support/bots')).json.data.some(item => item.id === theirs.id && item.reseller_id === reseller.resellerId));
    const other = await resellerClient(server);
    assert.equal((await other.browser.get(`/v1/support/bots/${theirs.id}`)).status, 404);

    await reseller.browser.put(`/v1/support/bots/${theirs.id}/knowledge`, { content: '# About\nGift cards.' });
    const suspended = await admin.post(`/v1/admin/support/bots/${theirs.id}/suspend`, { reason: 'It promised refunds.' });
    assert.deepEqual([suspended.status, suspended.json.status], [200, 'suspended']);
    assert.equal((await reseller.browser.post(`/v1/support/bots/${theirs.id}/activate`)).json.error.code, 'assistant_suspended');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'support.bot_paused', resellerId: reseller.resellerId } }));
    assert.equal((await admin.post(`/v1/admin/support/bots/${theirs.id}/unsuspend`)).json.status, 'paused');
  });
});
