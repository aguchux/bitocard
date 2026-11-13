// Money screens: a checkout sends what the chosen way needs (accepting the terms first when asked), paying an order
// asks Face ID and keeps its key, the release code shows only after Face ID, a payout names the amount, and a shop's
// till is paid exactly what it showed.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useLocalSearchParams } from 'expo-router';

import CheckoutScreen from '@/app/checkout/[id]';
import OrderScreen from '@/app/order/[id]';
import PayShopScreen from '@/app/pay/[token]';
import PayoutsScreen from '@/app/payouts';

import { answers, mockedApi, refused, renderScreen } from './helpers';

jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1', name: 'Ada Obi', first_name: 'Ada', last_name: 'Obi', country: 'NG', currency: 'NGN' }, pending: false, error: null, retry: jest.fn() }) }));

const wallet = (balance: number) => ({ object: 'customer_wallet', mode: 'live', country: 'NG', currency: 'NGN', enabled: true, balance, top_up_methods: [], reserved_accounts: [], reserved_accounts_available: false, reserved_account_needs_bvn: false, wallets: [] });

const quote = {
  object: 'classified_safe_pay_quote',
  listing_id: 'l1',
  offer_id: null,
  currency: 'NGN',
  price: 45_000_00,
  buyer_fee: 1_000_00,
  total: 46_000_00,
  fulfilment: ['meet_up', 'connect'],
  connect: {
    fee: { kind: 'percent', bps: 500 },
    free_hours: 72,
    states: [{ id: 's-lagos', name: 'Lagos', slug: 'lagos', shipping: 3_000_00, connect_fee: 150_00, centres: [{ id: 'cc1', number: 'CC-1', name: 'Ikeja Connect Centre', area: { id: 'a', name: 'Ikeja', latitude: 0, longitude: 0 }, address: '1 Allen Avenue', landmark: null, hours: 'Mon to Sat, 9 to 6', phone: '' }] }],
  },
  delivery: null,
  reserved: false,
  accept_hours: 48,
  pay_hours: 24,
  covers: [],
};

const order = (overrides: Record<string, unknown> = {}) => ({
  object: 'classified_order',
  id: 'o1',
  number: 'SP-000101',
  role: 'buyer',
  kind: 'direct',
  quantity: 1,
  status: 'awaiting_payment',
  listing: { id: 'l1', ref: 101, title: 'iPhone 13 128GB', slug: 'iphone-13', cover_url: null },
  with: { name: 'Chidi E.' },
  store: null,
  supplier: null,
  fulfilment: 'meet_up',
  connect: null,
  currency: 'NGN',
  price: 45_000_00,
  delivery_fee: 0,
  buyer_fee: 1_000_00,
  total: 46_000_00,
  refund: null,
  delivery_address: null,
  tracking_note: null,
  shipment: null,
  deadlines: { accept_by: '2026-11-14T10:00:00Z', pay_by: '2026-11-15T10:00:00Z', handover_by: null, confirm_by: null },
  ended_by: null,
  end_reason: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: true });
});

test('a Connect checkout adds shipping and the fee, and asks for the terms before sending the request', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'l1', title: 'iPhone 13 128GB' });
  const sent: unknown[] = [];
  let accepted = false;
  answers({
    'GET /v1/classifieds/listings/l1/safe-pay': quote,
    'GET /v1/store/wallet': wallet(60_000_00),
    'GET /v1/classifieds/terms': { version: '2026-11-10', path: '/legal/terms', accepted: false, previous_version: null },
    'POST /v1/classifieds/terms/accept': () => ((accepted = true), { accepted: true }),
    'POST /v1/classifieds/orders': (body: unknown) => (sent.push(body), accepted ? { id: 'o1' } : refused(409, 'terms_not_accepted', 'Accept the terms first.', 'terms')),
  });
  await renderScreen(<CheckoutScreen />);
  await fireEvent.press(await screen.findByText('Collect at a Connect Centre'));
  expect(screen.getByText('Ikeja Connect Centre')).toBeTruthy();
  expect(screen.getByLabelText(/Total ₦49,150/)).toBeTruthy();

  await fireEvent.press(screen.getByText('Send request to seller'));
  await fireEvent.press(await screen.findByText('I accept Udozo’s terms'));
  await waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[1]).toEqual({ listing_id: 'l1', fulfilment: 'connect', connect_centre_id: 'cc1' });
});

test('paying an order asks Face ID and sends the same key again after no answer', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'o1' });
  let tries = 0;
  answers({
    'GET /v1/classifieds/orders/o1': order(),
    'GET /v1/store/wallet': wallet(50_000_00),
    'POST /v1/classifieds/orders/o1/pay': () => (++tries === 1 ? refused(0, 'network_error', 'Udozo cannot be reached.') : order({ status: 'paid' })),
  });
  await renderScreen(<OrderScreen />);
  await fireEvent.press(await screen.findByText('Pay ₦46,000'));
  const sheet = await screen.findAllByText('Pay ₦46,000');
  await fireEvent.press(sheet[sheet.length - 1]);
  expect(await screen.findByText('Udozo cannot be reached.')).toBeTruthy();
  expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(expect.objectContaining({ promptMessage: 'Pay ₦46,000 from your Udozo wallet' }));
  await fireEvent.press(screen.getAllByText('Pay ₦46,000').at(-1)!);
  await waitFor(() => expect(tries).toBe(2));
  const keys = mockedApi.mock.calls.filter(([path]) => path === '/v1/classifieds/orders/o1/pay').map(([, options]) => options.idempotencyKey);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test('the release code is fetched only after Face ID says yes', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'o1' });
  answers({
    'GET /v1/classifieds/orders/o1': order({ status: 'paid' }),
    'GET /v1/classifieds/orders/o1/release-code': { object: 'classified_release_code', order_id: 'o1', code: '482915', tries_left: 5 },
  });
  await renderScreen(<OrderScreen />);
  (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false });
  await fireEvent.press(await screen.findByText('Show my release code'));
  await waitFor(() => expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1));
  expect(mockedApi.mock.calls.some(([path]) => String(path).endsWith('/release-code'))).toBe(false);

  await fireEvent.press(screen.getByText('Show my release code'));
  expect(await screen.findByText('482915')).toBeTruthy();
});

test('a payout names the amount and the account, then pays it out', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
  const sent: unknown[] = [];
  answers({
    'GET /v1/store/cash': { object: 'p2p_cash', mode: 'live', currency: 'NGN', balance: 90_000_00, held: 20_000_00, available: 70_000_00, hold_days: 3, minimum: 1_000_00 },
    'GET /v1/store/cash/bank-accounts': { data: [{ object: 'customer_bank_account', id: 'b1', mode: 'live', currency: 'NGN', bank_name: 'GTBank', account_number_last4: '6789', account_name: 'ADA OBI', payouts_available_from: '2026-11-01T00:00:00Z', ready: true, created_at: '2026-11-01T00:00:00Z' }] },
    'GET /v1/store/cash/payouts': { data: [] },
    'POST /v1/store/cash/payouts': (body: unknown) => (sent.push(body), { object: 'customer_payout', id: 'p1', mode: 'live', status: 'processing', amount: 70_000_00, currency: 'NGN', bank_account: null, failure_reason: null, created_at: '', completed_at: null }),
  });
  await renderScreen(<PayoutsScreen />);
  expect(await screen.findByText('₦70,000')).toBeTruthy();
  await fireEvent.press(screen.getByText('Pay to my bank'));
  await fireEvent.press(await screen.findByText('Continue'));
  expect(await screen.findByText('Pay ₦70,000 to your bank?')).toBeTruthy();
  await fireEvent.press(screen.getByText('Pay out ₦70,000'));
  await waitFor(() => expect(sent).toEqual([{ amount: 70_000_00, bank_account_id: 'b1' }]));
});

test('a shop’s till is paid exactly what it showed, or declined', async () => {
  const token = `pw_${'c'.repeat(32)}`;
  (useLocalSearchParams as jest.Mock).mockReturnValue({ token });
  const paid: unknown[] = [];
  const request = { object: 'pos_wallet_payment', number: 'PW-000042', status: 'waiting', shop: { name: 'Ada Stores' }, currency: 'NGN', amount: 12_500_00, total: 12_500_00, items: [{ title: 'Rice 5kg', quantity: 2 }], own_shop: false, expires_at: new Date(Date.now() + 240_000).toISOString(), paid_at: null };
  answers({
    [`GET /v1/store/account/pos-payments/${token}`]: request,
    'GET /v1/store/wallet': wallet(20_000_00),
    [`POST /v1/store/account/pos-payments/${token}/pay`]: (body: unknown) => (paid.push(body), { ...request, status: 'paid', paid_at: new Date().toISOString() }),
  });
  await renderScreen(<PayShopScreen />);
  expect(await screen.findByText('2 × Rice 5kg')).toBeTruthy();
  await fireEvent.press(screen.getByText('Pay ₦12,500'));
  await fireEvent.press(screen.getAllByText('Pay ₦12,500').at(-1)!);
  expect(await screen.findByText('Paid. Show this to Ada Stores: the sale is done.')).toBeTruthy();
  expect(paid).toEqual([{ expected_amount: 12_500_00 }]);
});
