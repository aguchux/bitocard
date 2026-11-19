// Buying airtime and data: the network from the number, the amount, then Confirm payment quotes first and pays exactly
// that quote from the wallet after Face ID, keeping its Idempotency-Key when the API does not answer; the order page
// shows how it stands.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { router, useLocalSearchParams } from 'expo-router';

import MobileTab from '@/app/(tabs)/mobile';
import OrderScreen from '@/app/order/[id]';
import Pay from '@/app/pay';
import { ApiError } from '@/lib/api-core';

import { answers, mockedApi, renderScreen } from './helpers';

jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1', name: 'Ada Obi', country: 'NG', currency: 'NGN', email_verified: true } }) }));

const product = (id: string, slug: string, name: string, extra: object = {}) => ({
  object: 'store_product',
  id,
  key: `airtime:NG:${slug}:topup`,
  name,
  category: 'airtime',
  country: 'NG',
  face_currency: 'NGN',
  denomination_type: 'range',
  from: 5000,
  to: 5000000,
  logo_url: null,
  brand: { slug, name: slug === 'mtn' ? 'MTN' : 'Airtel', logo_url: null, color: null, initials: 'M' },
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
});

test('the number picks its network, the amount is checked, then Continue goes to confirm the payment', async () => {
  answers({
    'GET /v1/store/products': { object: 'list', data: [product('p-mtn', 'mtn', 'MTN airtime'), product('p-airtel', 'airtel', 'Airtel airtime')], has_more: false },
    'GET /v1/store/network-detect': { object: 'network_detection', detected: true, brand: 'mtn', product: null },
    'GET /v1/store/products/airtime%3ANG%3Amtn%3Atopup': { ...product('p-mtn', 'mtn', 'MTN airtime'), denominations: null, range: { min: 5000, max: 5000000 }, recipient_type: 'phone' },
  });
  await renderScreen(<MobileTab />);
  await fireEvent.changeText(screen.getByLabelText('Mobile number'), '0806 857 3376');
  expect(await screen.findByText('Looks like a MTN number')).toBeTruthy();
  await fireEvent.press(await screen.findByRole('radio', { name: '₦1,000' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/pay', params: { product: 'p-mtn', face: '100000', phone: '0806 857 3376', name: 'MTN airtime' } });
});

test('an amount outside the network’s range is refused before anything is asked', async () => {
  answers({
    'GET /v1/store/products': { object: 'list', data: [product('p-mtn', 'mtn', 'MTN airtime')], has_more: false },
    'GET /v1/store/network-detect': { object: 'network_detection', detected: false, product: null },
    'GET /v1/store/products/airtime%3ANG%3Amtn%3Atopup': { ...product('p-mtn', 'mtn', 'MTN airtime'), denominations: null, range: { min: 5000, max: 5000000 }, recipient_type: 'phone' },
  });
  await renderScreen(<MobileTab />);
  await fireEvent.changeText(screen.getByLabelText('Mobile number'), '08068573376');
  await fireEvent.press(await screen.findByRole('radio', { name: 'MTN' }));
  await fireEvent.changeText(await screen.findByLabelText('Or type an amount (NGN)'), '10');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByText('Enter between ₦50 and ₦50,000.')).toBeTruthy();
  expect(router.push).not.toHaveBeenCalled();
});

const preview = { object: 'checkout_preview', quote_id: 'q1', amount: 100000, currency: 'NGN', tax: null, expires_at: new Date(Date.now() + 600_000).toISOString(), wallet_balance: 500000, wallet_options: [{ currency: 'NGN', amount: 100000, balance: 500000, enough: true }] };

test('Confirm payment shows the quote, asks Face ID, and pays exactly that quote from the wallet', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ product: 'p-mtn', face: '100000', phone: '0806 857 3376', name: 'MTN airtime' });
  const paid: Array<{ body: unknown; key?: string }> = [];
  mockedApi.mockImplementation(async (path: string, options: { body?: { preview?: boolean }; idempotencyKey?: string }) => {
    if (options.body?.preview) return preview;
    paid.push({ body: options.body, key: options.idempotencyKey });
    return { object: 'checkout', id: 'chk_1' };
  });
  await renderScreen(<Pay />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Pay ₦1,000.00' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/order/[id]', params: { id: 'chk_1' } }));
  expect(LocalAuthentication.authenticateAsync).toHaveBeenCalled();
  expect(paid).toEqual([
    {
      body: { product_id: 'p-mtn', face_value: 100000, recipient: { phone: '0806 857 3376' }, method: 'wallet', return_url: 'https://bitocard.com/checkout/return', quote_id: 'q1', wallet_currency: 'NGN' },
      key: 'key',
    },
  ]);
});

test('Face ID refused pays nothing; a wallet too low offers Add funds instead of Pay', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ product: 'p-mtn', face: '100000', phone: '0806', name: 'MTN airtime' });
  (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false });
  answers({ 'POST /v1/store/checkouts': (body: unknown) => ((body as { preview?: boolean }).preview ? preview : new ApiError(500, { type: 'api_error', code: 'api_error', message: 'Should not pay' })) });
  await renderScreen(<Pay />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Pay ₦1,000.00' }));
  await waitFor(() => expect(LocalAuthentication.authenticateAsync).toHaveBeenCalled());
  expect(mockedApi.mock.calls.filter(call => !(call[1] as { body?: { preview?: boolean } }).body?.preview)).toHaveLength(0);

  answers({ 'POST /v1/store/checkouts': { ...preview, wallet_balance: 20000, wallet_options: [{ currency: 'NGN', amount: 100000, balance: 20000, enough: false }] } });
  await renderScreen(<Pay />);
  expect(await screen.findByText('Not enough in your NGN wallet. Add ₦800.00 to continue.')).toBeTruthy();
  await fireEvent.press(screen.getAllByRole('button', { name: 'Add funds' }).at(-1)!);
  expect(router.push).toHaveBeenCalledWith({ pathname: '/add-funds', params: { currency: 'NGN' } });
});

test('the order page says how it stands and its timeline', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'chk_1' });
  answers({
    'GET /v1/store/checkouts/chk_1': {
      object: 'checkout', id: 'chk_1', mode: 'live', status: 'completed', product: { id: 'p', key: 'k', name: 'MTN airtime', category: 'airtime', brand: 'mtn' },
      face_value: 100000, face_currency: 'NGN', quantity: 1, amount: 100000, currency: 'NGN', charged: null, method: { id: 'wallet', label: 'Wallet' }, checkout_url: null,
      recipient: { phone: '+2348068573376' }, order: { id: 'o', status: 'completed', receipt_number: 'BC-000123', completed_at: null }, failure_reason: null, refunded_at: null, created_at: new Date().toISOString(),
    },
  });
  await renderScreen(<OrderScreen />);
  expect(await screen.findAllByText('Delivered')).toHaveLength(2); // the badge and the last step
  expect(screen.getByText('To +2348068573376')).toBeTruthy();
  expect(screen.getByText('Paid from your wallet')).toBeTruthy();
  expect(screen.getByText('BC-000123')).toBeTruthy();
});
