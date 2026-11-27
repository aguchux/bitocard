// The wallet: Move money quotes what arrives first and sends that amount, so a worse rate meanwhile is refused; Add
// funds opens the provider's page and then follows the top-up until it settles.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import AddFunds from '@/app/add-funds';
import MoveMoney from '@/app/move-money';

import { answers, renderScreen } from './helpers';

const wallet = {
  object: 'customer_wallet', mode: 'live', country: 'NG', currency: 'NGN', enabled: true, balance: 4825000,
  top_up_methods: [
    { object: 'payment_method', id: 'paystack', label: 'Card, bank or USSD', description: 'Pay on Paystack', networks: ['Visa', 'USSD'] },
    { object: 'payment_method', id: 'flutterwave', label: 'Card, bank or mobile money', description: 'Pay on Flutterwave', networks: ['Visa', 'Mobile money'] },
  ],
  reserved_accounts: [], reserved_accounts_available: true, reserved_account_needs_bvn: true,
  wallets: [{ currency: 'NGN', primary: true, balance: 4825000, removable: false }, { currency: 'USD', primary: false, balance: 1240, removable: false }],
};

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
});

test('Move money shows what arrives, then moves exactly that', async () => {
  const sent: unknown[] = [];
  answers({
    'GET /v1/store/wallet': wallet,
    'POST /v1/store/wallet/conversions': (body: unknown) => {
      sent.push(body);
      const preview = (body as { preview?: boolean }).preview;
      return { object: 'wallet_conversion', id: preview ? null : 'cv1', from: { amount: 1612400, currency: 'NGN' }, to: { amount: 1000, currency: 'USD' }, rate: '0.00062' };
    },
  });
  await renderScreen(<MoveMoney />);
  await fireEvent.changeText(await screen.findByLabelText('Amount (NGN)'), '16,124');
  await fireEvent.press(screen.getByRole('button', { name: 'See what arrives' }));
  expect(await screen.findByText('$10.00')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Move ₦16,124.00' }));
  await waitFor(() => expect(router.back).toHaveBeenCalled());
  expect(sent).toEqual([
    { from: 'NGN', to: 'USD', amount: 1612400, preview: true },
    { from: 'NGN', to: 'USD', amount: 1612400, expected_amount: 1000 },
  ]);
});

test('Add funds opens the provider’s page and follows the top-up until it is credited', async () => {
  let checks = 0;
  answers({
    'GET /v1/store/wallet': wallet,
    'POST /v1/store/wallet/top-ups': (body: unknown) => (
      expect(body).toEqual({ amount: 2000000, method: 'flutterwave', currency: 'NGN', return_url: 'https://bitocard.com/account/wallet' }),
      { object: 'customer_top_up', id: 't1', mode: 'live', status: 'pending', amount: 2000000, currency: 'NGN', method: { id: 'flutterwave', label: 'Card' }, checkout_url: 'https://checkout.example/t1', failure_reason: null }
    ),
    'GET /v1/store/wallet/top-ups/t1': () => ({ object: 'customer_top_up', id: 't1', mode: 'live', status: ++checks > 0 ? 'succeeded' : 'pending', amount: 2000000, currency: 'NGN', method: { id: 'paystack', label: 'Card' }, checkout_url: null, failure_reason: null }),
  });
  await renderScreen(<AddFunds />);
  expect(await screen.findByText('Paystack')).toBeTruthy();
  expect(screen.getByText('Flutterwave')).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: /Flutterwave/ }));
  await fireEvent.changeText(screen.getByLabelText('Amount (NGN)'), '20,000');
  await fireEvent.press(await screen.findByRole('button', { name: 'Continue to pay' }));
  await waitFor(() => expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://checkout.example/t1'));
  expect(await screen.findByText('Funds added')).toBeTruthy();
});
