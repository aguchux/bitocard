// A chat: messages newest at the bottom, sending one, answering an offer, and blocking from the menu.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import ChatScreen from '@/app/chat/[id]';

import { answers, mockedApi, renderScreen } from './helpers';

jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1', name: 'Ada Obi' }, pending: false }) }));

const offer = { object: 'classified_offer', id: 'off-1', price: { amount: 6000000, currency: 'NGN' }, status: 'open', made_by: 'them', expires_at: '2026-11-14T00:00:00Z', decided_at: null, created_at: '2026-11-12T09:00:00Z' };
const chat = {
  object: 'classified_conversation',
  id: 'chat-1',
  role: 'seller',
  listing: { id: 'l1', ref: 77, title: 'Office chair', slug: 'office-chair', status: 'active', country: 'NG', price: { kind: 'fixed', amount: 7000000, currency: 'NGN' }, cover_url: null },
  with: { name: 'Bola A.', online: true },
  last_message: null,
  unread: 0,
  open_offer: offer,
  blocked: { by_me: false, by_them: false },
  last_message_at: '2026-11-12T09:00:00Z',
  created_at: '2026-11-12T08:00:00Z',
  has_more: false,
  messages: [
    { object: 'classified_message', id: 'm1', kind: 'text', from: 'them', body: 'Is it still available?', photo: null, offer: null, created_at: '2026-11-12T08:00:00Z' },
    { object: 'classified_message', id: 'm2', kind: 'offer', from: 'them', body: '', photo: null, offer, created_at: '2026-11-12T09:00:00Z' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'chat-1' });
});

test('reads the chat, sends a message and accepts their offer', async () => {
  const posted: Array<[string, unknown]> = [];
  answers({
    'GET /v1/classifieds/conversations/chat-1': chat,
    'POST /v1/classifieds/conversations/chat-1/messages': (body: unknown) => (posted.push(['message', body]), { id: 'm3' }),
    'POST /v1/classifieds/offers/off-1/accept': () => (posted.push(['accept', null]), { id: 'off-1' }),
  });
  await renderScreen(<ChatScreen />);
  expect(await screen.findByText('Is it still available?')).toBeTruthy();
  expect(screen.getByText('Their offer')).toBeTruthy();
  expect(screen.getByText('₦60,000')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Message'), 'Yes, it is.');
  await fireEvent.press(screen.getByLabelText('Send'));
  await waitFor(() => expect(posted).toContainEqual(['message', { body: 'Yes, it is.' }]));
  await fireEvent.press(screen.getByText('Accept'));
  await waitFor(() => expect(posted).toContainEqual(['accept', null]));
});

test('a blocked chat says so and takes no messages', async () => {
  answers({ 'GET /v1/classifieds/conversations/chat-1': { ...chat, blocked: { by_me: false, by_them: true } } });
  await renderScreen(<ChatScreen />);
  expect(await screen.findByText('You can no longer write in this chat.')).toBeTruthy();
  expect(screen.queryByLabelText('Message')).toBeNull();
  expect(mockedApi.mock.calls.filter(([, options]) => (options as { body?: unknown } | undefined)?.body)).toHaveLength(0);
});
