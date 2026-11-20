// What the app gained to match bitocard.com: paying bills and pay-TV (the provider's check shown before paying),
// reporting a problem with an order, resetting a password, adding a wallet, the account's places and VPN access.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import AccountScreen from '@/app/account';
import NewDispute from '@/app/disputes/new';
import ForgotPassword from '@/app/forgot-password';
import OrderScreen from '@/app/order/[id]';
import Pay from '@/app/pay';
import ProductScreen from '@/app/product/[key]';
import WalletsScreen from '@/app/wallets';

import { answers, mockedApi, renderScreen } from './helpers';

const mockSignedIn = jest.fn(async (reply: { customer: unknown }) => reply.customer);
jest.mock('@/lib/account', () => ({
  useAccount: () => ({ customer: { id: 'c1', name: 'Ada Obi', email: 'ada@example.com', country: 'NG', currency: 'NGN', email_verified: true }, signedIn: mockSignedIn, signOut: jest.fn() }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
});

const meter = {
  object: 'store_product',
  id: 'p-eko',
  key: 'bills:NG:eko-electric:prepaid',
  name: 'Eko Electric prepaid',
  category: 'bills',
  country: 'NG',
  face_currency: 'NGN',
  denomination_type: 'range',
  from: 50000,
  to: 50000000,
  logo_url: null,
  brand: { slug: 'eko-electric', name: 'Eko Electric', logo_url: null, color: null, initials: 'EE' },
  denominations: null,
  range: { min: 50000, max: 50000000 },
  recipient_type: 'meter',
};

test('electricity: the meter number and an amount, then Confirm payment', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ key: meter.key });
  answers({ 'GET /v1/store/products/bills%3ANG%3Aeko-electric%3Aprepaid': meter });
  await renderScreen(<ProductScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Continue' }));
  expect(await screen.findByText('Enter an amount.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Amount (NGN)'), '5000');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByText('Enter the meter number.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Meter number'), '4501 2345 678');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/pay', params: { product: 'p-eko', face: '500000', name: 'Eko Electric prepaid', account: '45012345678' } });
});

test('Confirm payment shows whose meter it is, and pays for that meter', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ product: 'p-eko', face: '500000', name: 'Eko Electric prepaid', account: '45012345678' });
  const bodies: unknown[] = [];
  mockedApi.mockImplementation(async (_path: string, options: { body?: { preview?: boolean } }) => {
    bodies.push(options.body);
    if (options.body?.preview) {
      return { object: 'checkout_preview', quote_id: 'q1', amount: 500000, currency: 'NGN', tax: null, recipient: { account_number: '45012345678', account_name: 'ADA OBI', address: '12 Allen Avenue' }, expires_at: new Date(Date.now() + 600_000).toISOString(), wallet_balance: 900000, wallet_options: [{ currency: 'NGN', amount: 500000, balance: 900000, enough: true }] };
    }
    return { object: 'checkout', id: 'chk_9' };
  });
  await renderScreen(<Pay />);
  expect(await screen.findByText('ADA OBI')).toBeTruthy();
  expect(screen.getByText('12 Allen Avenue')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Pay ₦5,000.00' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/order/[id]', params: { id: 'chk_9' } }));
  expect(bodies[0]).toMatchObject({ product_id: 'p-eko', face_value: 500000, recipient: { account_number: '45012345678' }, preview: true });
  expect(bodies[1]).toMatchObject({ quote_id: 'q1', recipient: { account_number: '45012345678' } });
});

test('pay-TV asks whether to renew the current package or change to this one', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ key: 'pay_tv:NG:dstv:padi' });
  answers({ 'GET /v1/store/products/pay_tv%3ANG%3Adstv%3Apadi': { ...meter, id: 'p-dstv', key: 'pay_tv:NG:dstv:padi', name: 'DStv Padi', category: 'pay_tv', denomination_type: 'fixed', denominations: [440000], range: null, recipient_type: 'smartcard' } });
  await renderScreen(<ProductScreen />);
  await fireEvent.press(await screen.findByRole('tab', { name: 'Renew current package' }));
  await fireEvent.changeText(screen.getByLabelText('Smartcard or IUC number'), '7027914329');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/pay', params: { product: 'p-dstv', face: '440000', name: 'DStv Padi', account: '7027914329', transaction: 'renew' } });
});

test('reporting a problem with an order opens the report', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ checkout: 'chk_9' });
  const sent: unknown[] = [];
  answers({
    'GET /v1/store/checkouts/chk_9': { object: 'checkout', id: 'chk_9', product: { name: 'Amazon $25' }, amount: 4500000, currency: 'NGN', created_at: '2026-11-19T10:00:00Z' },
    'POST /v1/store/account/disputes': (body: unknown) => {
      sent.push(body);
      return { object: 'dispute', id: 'd-1', reference: 'D-000001' };
    },
  });
  await renderScreen(<NewDispute />);
  expect(await screen.findByText('Amazon $25')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('What went wrong'), 'The code did not work');
  await fireEvent.changeText(screen.getByLabelText('Tell us more'), 'Amazon says it was already used.');
  await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/disputes/[id]', params: { id: 'd-1' } }));
  expect(sent[0]).toEqual({ checkout_id: 'chk_9', subject: 'The code did not work', message: 'Amazon says it was already used.' });
});

test('forgot password: a code by email, then a new password signs in', async () => {
  const customer = { id: 'c1', email_verified: true };
  answers({
    'POST /v1/store/account/password/forgot': { object: 'password_reset', sent: true },
    'POST /v1/store/account/password/reset': { customer, session: { token: 'bcc_new', expires_at: '2026-12-20T00:00:00Z' } },
  });
  await renderScreen(<ForgotPassword />);
  await fireEvent.changeText(screen.getByLabelText('Email'), 'ada@example.com');
  await fireEvent.press(screen.getByRole('button', { name: 'Email me a code' }));
  await fireEvent.changeText(await screen.findByLabelText('Code'), '123456');
  await fireEvent.changeText(screen.getByLabelText('New password'), 'a much longer password');
  await fireEvent.press(screen.getByRole('button', { name: 'Set password and sign in' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  expect(mockSignedIn).toHaveBeenCalledWith({ customer, session: { token: 'bcc_new', expires_at: '2026-12-20T00:00:00Z' } });
  expect(mockedApi).toHaveBeenCalledWith('/v1/store/account/password/reset', { body: { email: 'ada@example.com', code: '123456', password: 'a much longer password' } });
});

test('adding a wallet in another market’s currency', async () => {
  const added: unknown[] = [];
  answers({
    'GET /v1/store/wallet': { object: 'customer_wallet', currency: 'NGN', wallets: [{ currency: 'NGN', primary: true, balance: 0, removable: false }] },
    'GET /v1/store/wallet/currencies': { object: 'list', data: [{ object: 'wallet_currency_option', currency: 'GHS', country: 'GH', country_name: 'Ghana', available: true, reason: null }] },
    'POST /v1/store/wallet/wallets': (body: unknown) => {
      added.push(body);
      return { object: 'customer_wallet', currency: 'GHS', wallets: [] };
    },
  });
  await renderScreen(<WalletsScreen />);
  expect(await screen.findByText('Ghana')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByText('Wallet added.')).toBeTruthy();
  expect(added).toEqual([{ currency: 'GHS' }]);
});

test('the account lists its places as bitocard.com does', async () => {
  await renderScreen(<AccountScreen />);
  for (const name of ['Profile', 'Security', 'Identity check', 'Gift cards you sold', 'Bank deposits', 'Reported problems', 'Notifications', 'Help', 'Settings']) expect(screen.getByRole('button', { name })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Reported problems' }));
  expect(router.push).toHaveBeenCalledWith('/disputes');
});

test('a VPN order shows its sign-in, when access ends, and Report a problem', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'chk_v' });
  answers({
    'GET /v1/store/checkouts/chk_v': {
      object: 'checkout',
      id: 'chk_v',
      mode: 'live',
      status: 'completed',
      product: { id: 'p', key: 'vpn:WW:bitocard:vpn-access-30d', name: 'VPN access, 30 days', category: 'vpn', brand: 'bitocard' },
      face_value: 500,
      face_currency: 'USD',
      quantity: 1,
      amount: 900000,
      currency: 'NGN',
      charged: null,
      method: { id: 'wallet', label: 'Wallet' },
      checkout_url: null,
      recipient: null,
      order: { id: 'o', status: 'completed', receipt_number: 'BC-000300', completed_at: null, deliveries: [{ kind: 'vpn_account', code: 'S3cret-pass-1234', pin: null, serial: 'bcvpn_ada', details: {} }] },
      failure_reason: null,
      refunded_at: null,
      created_at: '2026-11-19T10:00:00Z',
    },
    'GET /v1/store/checkouts/chk_v/vpn': { object: 'vpn_access', vpn_subscription: { object: 'vpn_subscription', id: 'v', status: 'active', term_days: 30, devices: 10, renews_automatically: false, starts_at: null, expires_at: '2026-12-20T00:00:00Z', ended_at: null, password_changed_at: null } },
  });
  await renderScreen(<OrderScreen />);
  expect(await screen.findByText('Your VPN sign-in')).toBeTruthy();
  expect(await screen.findByText('VPN access')).toBeTruthy();
  expect(screen.getByText('Up to 10 at once')).toBeTruthy();
  expect(screen.queryByText('S3cret-pass-1234')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Reveal' }));
  expect(await screen.findByText('bcvpn_ada')).toBeTruthy();
  expect(screen.getByText('S3cret-pass-1234')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Report a problem' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/disputes/new', params: { checkout: 'chk_v' } });
});
