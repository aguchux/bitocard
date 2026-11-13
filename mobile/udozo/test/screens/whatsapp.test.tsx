// Connecting WhatsApp: Connect opens WhatsApp with LINK <code>, I sent it reads the connection again, the choices are
// switched (direct contact asked first), and Disconnect is asked first.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import WhatsappScreen from '@/app/whatsapp';

import { answers, refused, renderScreen } from './helpers';

jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1', country: 'NG' }, pending: false }) }));

const connection = (overrides: Record<string, unknown> = {}) => ({
  object: 'whatsapp_connection',
  available: true,
  number: '+2348000000000',
  chat_link: 'https://wa.me/2348000000000',
  connected: false,
  phone: null,
  connected_at: null,
  opted_out: false,
  chats: true,
  alerts: true,
  direct: false,
  window_open: false,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

test('Connect opens WhatsApp with the code, and I sent it reads the connection again', async () => {
  let now = connection();
  answers({
    'GET /v1/store/account/whatsapp': () => now,
    'POST /v1/store/account/whatsapp/link': { object: 'whatsapp_link', code: 'AB12CD', link: null, expires_at: '2026-11-13T10:10:00Z' },
  });
  await renderScreen(<WhatsappScreen />);
  await fireEvent.press(await screen.findByText('Connect WhatsApp'));
  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://wa.me/2348000000000?text=LINK%20AB12CD'));
  expect(screen.getByText(/Send LINK AB12CD to Udozo \(\+2348000000000\)/)).toBeTruthy();

  await fireEvent.press(screen.getByText('I sent it'));
  expect(await screen.findByText('Not connected yet. Send the message in WhatsApp, then try again.')).toBeTruthy();

  now = connection({ connected: true, phone: '+2348011112222' });
  await fireEvent.press(screen.getByText('I sent it'));
  expect(await screen.findByText('Connected to +2348011112222.')).toBeTruthy();
});

test('the choices are switched, direct contact is asked first, and Disconnect is asked first', async () => {
  let now = connection({ connected: true, phone: '+2348011112222' });
  const patched: unknown[] = [];
  const removed: string[] = [];
  answers({
    'GET /v1/store/account/whatsapp': () => now,
    'PATCH /v1/store/account/whatsapp': (body: unknown) => (patched.push(body), (now = { ...now, ...(body as object) })),
    'DELETE /v1/store/account/whatsapp': () => (removed.push('x'), (now = connection())),
  });
  await renderScreen(<WhatsappScreen />);
  await fireEvent(await screen.findByLabelText('Chats on WhatsApp'), 'valueChange', false);
  await waitFor(() => expect(patched).toEqual([{ chats: false }]));

  await fireEvent(screen.getByLabelText('Let buyers WhatsApp me directly'), 'valueChange', true);
  expect(await screen.findByText('Let buyers WhatsApp you directly?')).toBeTruthy();
  expect(patched).toHaveLength(1);
  await fireEvent.press(screen.getByText('Share my number'));
  await waitFor(() => expect(patched).toEqual([{ chats: false }, { direct: true }]));

  await fireEvent.press(screen.getByText('Disconnect'));
  expect(await screen.findByText('Disconnect WhatsApp?')).toBeTruthy();
  await fireEvent.press(screen.getAllByText('Disconnect').at(-1)!);
  await waitFor(() => expect(removed).toEqual(['x']));
  expect(await screen.findByText('Connect WhatsApp')).toBeTruthy();
});

test('closed where Udozo is not on WhatsApp', async () => {
  answers({ 'GET /v1/store/account/whatsapp': connection({ available: false }) });
  await renderScreen(<WhatsappScreen />);
  expect(await screen.findByText('Udozo is not on WhatsApp in your country yet. We will show it here once it is.')).toBeTruthy();
});

test('a refused code is put in words', async () => {
  answers({
    'GET /v1/store/account/whatsapp': connection(),
    'POST /v1/store/account/whatsapp/link': refused(429, 'link_code_limit', 'Too many codes.'),
  });
  await renderScreen(<WhatsappScreen />);
  await fireEvent.press(await screen.findByText('Connect WhatsApp'));
  expect(await screen.findByText('You asked for several codes in the last hour. Use the last one, or try again later.')).toBeTruthy();
});
