// Phase 4: a notice opens its screen and is marked read, and push is turned on only when asked; push choices save
// (security notices stay locked); the chat starts with the first message and can ask for a person; a question about
// an order names it; the wheel stops on what the server decided and rewards move to a wallet at the amount shown;
// search opens gift cards, pay-TV and everything else in the app.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { AccessibilityInfo } from 'react-native';

import ChatScreen from '@/app/help/chat';
import NewTicket from '@/app/help/new';
import NotificationsScreen from '@/app/notifications';
import SearchScreen from '@/app/search';
import SettingsScreen from '@/app/settings';
import SpinScreen from '@/app/spin';

import { answers, mockedApi, renderScreen } from './helpers';

jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1', name: 'Ada Obi', email: 'ada@example.com', country: 'NG', currency: 'NGN', email_verified: true } }) }));

beforeEach(() => jest.clearAllMocks());

const calls = (method: string, path: string) => mockedApi.mock.calls.filter(([url, options = {}]) => url === path && (options.method ?? (options.body === undefined ? 'GET' : 'POST')) === method);

test('a notice opens its screen in the app and is marked read; push is turned on only when asked', async () => {
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
  const notice = { object: 'notification', id: '11111111-1111-1111-1111-111111111111', type: 'customer.order.completed', severity: 'success', title: 'Your Amazon US card is ready', body: 'Open the order to see the code.', link: '/account/orders/chk_9', mode: 'live', read: false, read_at: null, created_at: new Date().toISOString() };
  answers({
    'GET /v1/store/account/notifications': { object: 'list', data: [notice], has_more: false, unread_count: 1 },
    [`POST /v1/store/account/notifications/${notice.id}/read`]: { ...notice, read: true },
    'POST /v1/store/account/devices/phone': { object: 'device' },
  });
  await renderScreen(<NotificationsScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Unread. Your Amazon US card is ready' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/order/[id]', params: { id: 'chk_9' } });
  await waitFor(() => expect(calls('POST', `/v1/store/account/notifications/${notice.id}/read`)).toHaveLength(1));
  expect(screen.getByRole('button', { name: 'Mark all 1 read' })).toBeTruthy();
  expect(calls('POST', '/v1/store/account/devices/phone')).toHaveLength(0);
  await fireEvent.press(screen.getByRole('button', { name: 'Turn on notifications' }));
  await waitFor(() => expect(calls('POST', '/v1/store/account/devices/phone')).toHaveLength(1));
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
  expect(calls('POST', '/v1/store/account/devices/phone')[0]![1].body).toMatchObject({ kind: 'apns', token: 'fcm-token-0123456789abcdef' });
});

test('push choices save; security notices stay on', async () => {
  answers({
    'GET /v1/store/account/notification-preferences': {
      object: 'list',
      data: [
        { object: 'notification_preference', type: 'customer.order.completed', label: 'Order delivered', severity: 'success', push: true, default: true, locked: false },
        { object: 'notification_preference', type: 'customer.security.signed_in', label: 'New sign-in', severity: 'critical', push: true, default: true, locked: true },
      ],
    },
    'GET /v1/app/config': { object: 'app_config', platform: 'ios', version: '0.1.0', update: 'none', min_version: null, latest_version: null, store_url: null, site_url: 'https://bitocard.com', legal: { terms: 'https://legals.bitocard.com/documents/terms', privacy: 'https://legals.bitocard.com/documents/privacy' } },
    'PUT /v1/store/account/notification-preferences/customer.order.completed': (body: unknown) => (expect(body).toEqual({ push: false }), { object: 'notification_preference', type: 'customer.order.completed', label: 'Order delivered', severity: 'success', push: false, default: true, locked: false }),
  });
  await renderScreen(<SettingsScreen />);
  const order = await screen.findByRole('switch', { name: 'Order delivered' });
  expect(screen.getByRole('switch', { name: 'New sign-in' }).props.accessibilityState?.disabled ?? screen.getByRole('switch', { name: 'New sign-in' }).props.disabled).toBeTruthy();
  await fireEvent(order, 'valueChange', false);
  await waitFor(() => expect(calls('PUT', '/v1/store/account/notification-preferences/customer.order.completed')).toHaveLength(1));
  await fireEvent.press(await screen.findByRole('button', { name: 'Privacy notice' }));
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://legals.bitocard.com/documents/privacy');
});

test('the chat starts with the first message; a person can be asked for', async () => {
  const chat = { object: 'support_chat', id: '22222222-2222-2222-2222-222222222222', status: 'bot', ticket_reference: null, created_at: '', closed_at: null, messages: [{ id: 'm1', author: 'customer', author_name: null, author_avatar_url: null, body: 'Where is my code?', attachments: [], created_at: '' }] };
  answers({
    'GET /v1/store/support/chat': { object: 'support_chat_current', chat: null, assistant: { name: 'Bito', avatar_url: null, greeting: 'Hi, I am Bito. How can I help?' } },
    'POST /v1/store/support/chat/messages': (body: unknown) => (expect(body).toEqual({ body: 'Where is my code?' }), chat),
    [`GET /v1/store/support/chat/${chat.id}/messages`]: { object: 'list', status: 'bot', data: [] },
    [`POST /v1/store/support/chat/${chat.id}/human`]: { ...chat, status: 'waiting' },
  });
  await renderScreen(<ChatScreen />);
  expect(await screen.findByText('Hi, I am Bito. How can I help?')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Message'), 'Where is my code?');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('Where is my code?')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Talk to a person' }));
  expect(await screen.findByText('A person will reply here.')).toBeTruthy();
});

test('a question about an order names it', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ checkout: 'chk_9' });
  answers({ 'POST /v1/store/support/tickets': (body: unknown) => (expect(body).toEqual({ category: 'order', subject: 'Code not working', message: 'Amazon says it was used.', checkout_id: 'chk_9' }), { object: 'support_ticket', id: 't-1' }) });
  await renderScreen(<NewTicket />);
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Code not working');
  await fireEvent.changeText(screen.getByLabelText('Your question'), 'Amazon says it was used.');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/help/ticket/[id]', params: { id: 't-1' } }));
});

test('the wheel stops on what the server decided; rewards move to a wallet at the amount shown', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  const segments = Array.from({ length: 12 }, (_, index) => ({ index, usd: ['0.01', '0.02', '0.03', '0.04', '0.05', '0.06', '0.08', '0.10', '0.05', '0.03', '0.02', '0.01'][index]! }));
  const allowance = { won_usd: '0.05', spins_used: 1, today_left: 1, daily_limit: 2, next_spin_at: null, finished: false };
  answers({
    'GET /v1/store/spins': { object: 'spin_rewards', mode: 'live', enabled: true, reason: null, segments, daily_limit: 2, allowance: null, recent: [], rewards: { usd: '0.05', exchange_currencies: ['NGN', 'USD'] } },
    'POST /v1/store/spins': { object: 'spin', id: 's1', number: 1, segment: 4, usd: '0.05', allowance },
    'POST /v1/store/spins/exchange': (body: unknown) =>
      (body as { preview?: boolean }).preview
        ? (expect(body).toEqual({ currency: 'NGN', preview: true }), { object: 'spin_exchange_preview', usd: '0.05', currency: 'NGN', amount: 8000, rate: '1600' })
        : (expect(body).toEqual({ currency: 'NGN', expected_amount: 8000 }), { object: 'spin_exchange', id: 'x1', usd: '0.05', currency: 'NGN', amount: 8000, rate: '1600', created_at: '' }),
  });
  await renderScreen(<SpinScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Spin' }));
  expect(await screen.findByText('You won 5¢')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'See what you get' }));
  expect(await screen.findByText('₦80.00')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Move to my wallet' }));
  expect(await screen.findByText('₦80.00 is in your wallet.')).toBeTruthy();
});

test('search opens gift cards, pay-TV and everything else in the app', async () => {
  const brand = { slug: 'amazon', name: 'Amazon', logo_url: null, color: '#111111', initials: 'A' };
  answers({
    'GET /v1/store/search': {
      object: 'store_search',
      query: 'am',
      products: [
        { object: 'store_product', id: 'p1', key: 'gift_cards:US:amazon:usd', name: 'Amazon US', category: 'gift_cards', country: 'US', face_currency: 'USD', denomination_type: 'fixed', from: 1000, to: 10000, logo_url: null, brand },
        { object: 'store_product', id: 'p2', key: 'pay_tv:NG:dstv:padi', name: 'DStv Padi', category: 'pay_tv', country: 'NG', face_currency: 'NGN', denomination_type: 'fixed', from: 450000, to: 450000, logo_url: null, brand: { ...brand, slug: 'dstv', name: 'DStv' } },
      ],
    },
  });
  await renderScreen(<SearchScreen />);
  await fireEvent.changeText(screen.getByLabelText('Search'), 'am');
  await fireEvent.press(await screen.findByRole('button', { name: 'Amazon US' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/gift-card/[key]', params: { key: 'gift_cards:US:amazon:usd' } });
  await fireEvent.press(screen.getByRole('button', { name: 'DStv Padi' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/product/[key]', params: { key: 'pay_tv:NG:dstv:padi' } });
});
