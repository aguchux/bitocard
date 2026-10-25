import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { shopAssistantsApi, supportBotsApi } from '../src/admin';
import { parseAssistantEvents } from '../src/classifieds';
import { makeStore } from '../src';

type Call = { url: string; method: string; body: string | null };
let calls: Call[];

beforeEach(() => {
  calls = [];
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/';
  vi.stubGlobal('fetch', async (input: Request) => {
    calls.push({ url: input.url, method: input.method, body: input.method === 'GET' ? null : await input.text() });
    return Response.json(input.method === 'GET' ? { object: 'list', data: [] } : { object: 'ok', assignments: [], refreshed: [] });
  });
});

afterEach(() => vi.unstubAllGlobals());

const sent = () => calls.filter(call => call.method !== 'GET').map(call => [call.method, call.url.replace('http://api.test', ''), call.body ? JSON.parse(call.body) : null]);

describe('shop assistants for admins', () => {
  test('countries, the default, knowledge per country, evals and Try it send what the API takes', async () => {
    const store = makeStore();
    await store.dispatch(shopAssistantsApi.endpoints.assignShopBot.initiate({ id: 'b1', assignments: [{ country: 'NG', language: 'yo' }, { country: 'GH', language: null }] }));
    await store.dispatch(shopAssistantsApi.endpoints.makeShopBotDefault.initiate('b1'));
    await store.dispatch(shopAssistantsApi.endpoints.refreshShopBotKnowledge.initiate({ id: 'b1' }));
    await store.dispatch(shopAssistantsApi.endpoints.refreshShopBotKnowledge.initiate({ id: 'b1', countries: ['NG'] }));
    await store.dispatch(shopAssistantsApi.endpoints.runShopBotEvals.initiate({ id: 'b1', country: 'NG' }));
    await store.dispatch(supportBotsApi.endpoints.testSupportBot.initiate({ base: '/v1/admin/support/bots', id: 'b1', messages: [{ role: 'user', content: 'Hi' }], country: 'NG', surface: 'browse' }));
    expect(sent()).toEqual([
      ['PUT', '/v1/admin/support/bots/b1/assignments', { assignments: [{ country: 'NG', language: 'yo' }, { country: 'GH', language: null }] }],
      ['POST', '/v1/admin/support/bots/b1/make-default', null],
      ['POST', '/v1/admin/support/bots/b1/shop-knowledge/refresh', {}],
      ['POST', '/v1/admin/support/bots/b1/shop-knowledge/refresh', { countries: ['NG'] }],
      ['POST', '/v1/admin/support/bots/b1/evals/run', { country: 'NG' }],
      ['POST', '/v1/admin/support/bots/b1/test', { messages: [{ role: 'user', content: 'Hi' }], country: 'NG', surface: 'browse' }],
    ]);
  });

  test('conversations are filtered for review', async () => {
    const store = makeStore();
    await store.dispatch(shopAssistantsApi.endpoints.assistantThreads.initiate({ id: 'b1', reported: true }));
    await store.dispatch(shopAssistantsApi.endpoints.assistantThreads.initiate({ id: 'b1', rating: 'down' }));
    await store.dispatch(shopAssistantsApi.endpoints.assistantThreads.initiate({ id: 'b1', reported: false }));
    expect(calls.map(call => call.url.replace('http://api.test', ''))).toEqual(['/v1/admin/support/bots/b1/threads?reported=true', '/v1/admin/support/bots/b1/threads?rating=down', '/v1/admin/support/bots/b1/threads']);
  });
});

describe('streamed answers', () => {
  test('events are read as they arrive, a split one waiting for the rest', () => {
    const first = parseAssistantEvents('event: status\ndata: {"tool":"search_listings"}\n\nevent: cards\ndata: {"cards":[{"type":"person","reason":"x"}]}\n\nevent: mess');
    expect(first.events).toEqual([
      { event: 'status', data: { tool: 'search_listings' } },
      { event: 'cards', data: { cards: [{ type: 'person', reason: 'x' }] } },
    ]);
    const second = parseAssistantEvents(`${first.rest}age\r\ndata: {"id":"m1","body":"Hi"}\r\n\r\n`);
    expect(second.events).toEqual([{ event: 'message', data: { id: 'm1', body: 'Hi' } }]);
    expect(second.rest).toBe('');
    expect(parseAssistantEvents('event: cards\ndata: {broken\n\n').events).toEqual([]);
  });
});
