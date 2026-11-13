// Ask Anjio: the greeting and suggestions, an answer streamed in (tool status, cards, then the message) and drawn as
// text, thumbs and Report this answer, a drafted message used in the chat it came from, and a visitor's token kept.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { fetch as streamingFetch } from 'expo/fetch';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

import AssistantScreen from '@/app/assistant';
import { useAssistantDraft } from '@/lib/assistant-draft';

import { answers, renderScreen } from './helpers';

const mockAccount: { customer: unknown; pending: boolean } = { customer: null, pending: false };
jest.mock('@/lib/account', () => ({ useAccount: () => mockAccount }));
jest.mock('@/lib/market', () => ({ useMarket: () => ({ country: 'NG', markets: [{ country: 'NG' }], fixed: false, choose: jest.fn() }) }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

const listingId = '11111111-1111-4111-8111-111111111111';
const threadId = '22222222-2222-4222-8222-222222222222';
const profile = {
  object: 'shop_assistant',
  assistant: { id: 'b1', name: 'Anjio', avatar_url: null, label: 'AI assistant', language: 'en', greeting: 'Hi, I am Anjio. What are you looking for?', roles: ['browse'], suggestions: ['Phones under ₦200,000'] },
  languages: [{ code: 'en', name: 'English' }],
};
const thread = (overrides: Record<string, unknown> = {}) => ({ object: 'assistant_thread', id: threadId, country: 'NG', language: 'en', surface: 'browse', listing_id: null, conversation_id: null, chat_id: null, assistant: null, messages: [], created_at: '2026-11-13T10:00:00Z', ...overrides });
const card = { id: listingId, ref: 77, country: 'NG', title: 'iPhone 13 Pro', url: 'https://udozo.com/ng/l/77-iphone-13-pro', cover: null, area: { name: 'Ikeja' }, highlights: ['256 GB'], price: { kind: 'fixed', amount: 18_000_000, currency: 'NGN' } };
const message = (overrides: Record<string, unknown> = {}) => ({
  object: 'assistant_message',
  id: '33333333-3333-4333-8333-333333333333',
  role: 'assistant',
  body: '<p>Here is <strong>one</strong> I found.</p><ul><li>Check the <a href="/safe-trade">guide</a></li></ul>',
  cards: [],
  rating: null,
  reported: false,
  created_at: '2026-11-13T10:00:01Z',
  ...overrides,
});

/** A streamed answer in two chunks, split inside an event, as the network may split it. */
function stream(events: { event: string; data: unknown }[]) {
  const text = events.map(item => `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  const half = Math.floor(bytes.length / 2);
  const parts = [bytes.slice(0, half), bytes.slice(half)];
  return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (parts.length ? { done: false, value: parts.shift() } : { done: true, value: undefined }) }) } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount.customer = null;
  (useLocalSearchParams as jest.Mock).mockReturnValue({ country: 'NG' });
});

test('a visitor asks: the token is kept, the answer streams in with its cards, and is rated and reported', async () => {
  const started: unknown[] = [];
  const rated: unknown[] = [];
  const reported: unknown[] = [];
  answers({
    'GET /v1/classifieds/assistant': profile,
    'POST /v1/classifieds/assistant/threads': (body: unknown) => (started.push(body), thread({ visitor_token: `bav_${'a'.repeat(43)}` })),
    'POST /v1/classifieds/assistant/messages/33333333-3333-4333-8333-333333333333/rating': (body: unknown) => (rated.push(body), message({ rating: 1 })),
    'POST /v1/classifieds/assistant/messages/33333333-3333-4333-8333-333333333333/report': (body: unknown) => (reported.push(body), message({ reported: true })),
  });
  (streamingFetch as jest.Mock).mockResolvedValue(
    stream([
      { event: 'status', data: { tool: 'search_listings' } },
      { event: 'cards', data: { cards: [{ type: 'listings', items: [card] }] } },
      { event: 'message', data: message({ cards: [{ type: 'listings', items: [card] }, { type: 'safe_pay', currency: 'NGN', price: 18_000_000, fee: 270_000, total: 18_270_000, listing_id: listingId }] }) },
    ]),
  );
  await renderScreen(<AssistantScreen />);
  expect(await screen.findByText('Hi, I am Anjio. What are you looking for?')).toBeTruthy();

  await fireEvent.press(screen.getByText('Phones under ₦200,000'));
  await waitFor(() => expect(started).toEqual([{ country: 'NG', surface: 'browse', language: 'en' }]));
  await waitFor(() => expect(SecureStore.setItemAsync).toHaveBeenCalledWith('udozo.assistant-visitor', `bav_${'a'.repeat(43)}`));
  const [url, init] = (streamingFetch as jest.Mock).mock.calls[0];
  expect(url).toMatch(/\/v1\/classifieds\/assistant\/threads\/22222222-2222-4222-8222-222222222222\/messages$/);
  expect(init.headers).toMatchObject({ Accept: 'text/event-stream', 'BitoCard-Assistant-Visitor': `bav_${'a'.repeat(43)}` });
  expect(JSON.parse(init.body)).toEqual({ body: 'Phones under ₦200,000' });

  expect(await screen.findByText('one')).toBeTruthy();
  expect(screen.getByText('guide')).toBeTruthy();
  expect(screen.getByText('₦182,700')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('iPhone 13 Pro, ₦180,000, Ikeja'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/listing/[ref]', params: { ref: '77', country: 'NG' } });

  await fireEvent.press(screen.getByLabelText('Helpful'));
  await waitFor(() => expect(rated).toEqual([{ rating: 'up' }]));
  await fireEvent.press(screen.getByText('Report this answer'));
  await fireEvent.changeText(screen.getByLabelText('What was wrong?'), 'Wrong price');
  await fireEvent.press(screen.getByText('Send report'));
  await waitFor(() => expect(reported).toEqual([{ reason: 'Wrong price' }]));
  expect(await screen.findByText('Reported. Thank you.')).toBeTruthy();
});

test('from a listing, a drafted first message goes back into its chat; a failure says search still works', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ country: 'NG', listing: listingId, title: 'iPhone 13 Pro' });
  mockAccount.customer = { id: 'c1', country: 'NG' };
  const started: unknown[] = [];
  answers({
    'GET /v1/classifieds/assistant': profile,
    'POST /v1/classifieds/assistant/threads': (body: unknown) => (started.push(body), thread({ listing_id: listingId })),
  });
  const draft = { type: 'message_draft', listing_id: listingId, title: 'iPhone 13 Pro', url: card.url, text: 'Hello, is it still available?' };
  (streamingFetch as jest.Mock).mockResolvedValue(stream([{ event: 'message', data: message({ body: 'Try this:', cards: [draft] }) }]));
  const taken: string[] = [];
  function Listing() {
    useAssistantDraft('listing', listingId, text => taken.push(text));
    return null;
  }
  await renderScreen(
    <>
      <Listing />
      <AssistantScreen />
    </>,
  );
  expect(await screen.findByText('Asking about iPhone 13 Pro.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Ask Anjio'), 'Write to the seller for me');
  await fireEvent.press(screen.getByLabelText('Send'));
  await waitFor(() => expect(started).toEqual([{ country: 'NG', surface: 'browse', language: 'en', listing_id: listingId }]));
  await fireEvent.press(await screen.findByText('Use in the chat'));
  expect(taken).toEqual(['Hello, is it still available?']);
  expect(router.back).toHaveBeenCalled();
  expect(screen.getByText('Talk to a person')).toBeTruthy();

  (streamingFetch as jest.Mock).mockResolvedValue(stream([{ event: 'error', data: { code: 'assistant_unavailable', message: 'Anjio can’t answer right now.' } }]));
  await fireEvent.changeText(screen.getByLabelText('Ask Anjio'), 'And another?');
  await act(async () => {
    await fireEvent.press(screen.getByLabelText('Send'));
  });
  expect(await screen.findByText('Anjio can’t answer right now.')).toBeTruthy();
  expect(screen.getByText('Search instead')).toBeTruthy();
});
