// The airtime exchange: selling quotes the payout first from a confirmed number and warns that airtime from any other
// number is lost; the sale's page dials the network's transfer code and asks before "I've sent it"; buying from the pool
// quotes the price, asks Face ID and pays exactly that price with a kept key; a short wallet offers Add funds; a new
// mobile number joins once its texted code is entered.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Linking } from 'react-native';

import BuyAirtime from '@/app/airtime/buy';
import AirtimeSaleScreen from '@/app/airtime/sale/[id]';
import SellAirtime from '@/app/airtime/sell';
import PhonesScreen from '@/app/phones';

import { answers, mockedApi, refused, renderScreen } from './helpers';

jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1', name: 'Ada Obi', email: 'ada@example.com', country: 'NG', currency: 'NGN', email_verified: true } }) }));

beforeEach(() => jest.clearAllMocks());

const mtn = { object: 'airtime_network', network: 'mtn', name: 'MTN', open: true, sell_rate_bps: 8000, buy_rate_bps: 8800, min_amount: 50000, max_amount: 5000000, available: 2000000, bought_total: 0, sold_total: 0, bought_24h: 0, sold_24h: 0 };
const glo = { ...mtn, network: 'glo', name: 'Glo', open: false };
const pool = { object: 'airtime_pool', country: 'NG', currency: 'NGN', mode: 'live', open: true, networks: [mtn, glo], totals: { available: 2000000, bought_total: 0, sold_total: 0, bought_24h: 0, sold_24h: 0 }, updated_at: null };
const phones = { object: 'list', data: [{ object: 'customer_phone', phone: '+2348061234567', default: true, verified_at: '2026-11-01T00:00:00Z' }], limit: 5, default: '+2348061234567', unconfirmed: null };
const seller = { object: 'airtime_seller', completed_sales: 0, strikes: 0, strike_limit: 3, paused: false, strikes_expire_at: null, sold_today: 0, networks: [{ network: 'mtn', new_seller: true, established_after: 3, daily_limit: 2000000, seller_daily: 10000000 }] };

test('selling: the payout from the default confirmed number first, with the warning, then the sale', async () => {
  const sent: unknown[] = [];
  answers({
    'GET /v1/store/airtime/pool': pool,
    'GET /v1/store/airtime/seller': seller,
    'GET /v1/store/account/phones': phones,
    'POST /v1/store/airtime/sales': (body: unknown) => (sent.push(body), (body as { preview?: boolean }).preview ? { object: 'airtime_sale_quote', network: 'mtn', amount: 100000, currency: 'NGN', rate_bps: 8000, payout: 80000, from_phone: '+2348061234567' } : { object: 'airtime_sale', id: 'sale-1' }),
  });
  await renderScreen(<SellAirtime />);
  await fireEvent.press(await screen.findByRole('radio', { name: 'MTN' }));
  expect(screen.queryByRole('radio', { name: 'Glo' })).toBeNull();
  expect(screen.getByText('You get 80% of what you send, up to ₦20,000 a day while you are new.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Amount (NGN)'), '1,000');
  await fireEvent.press(screen.getByRole('button', { name: 'See what you get' }));
  expect(await screen.findByText('₦800.00')).toBeTruthy();
  expect(screen.getByText(/Airtime sent from any other number cannot be matched to you/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Start the sale' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/airtime/sale/[id]', params: { id: 'sale-1' } }));
  expect(sent).toEqual([
    { network: 'mtn', amount: 100000, from_phone: '+2348061234567', preview: true },
    { network: 'mtn', amount: 100000, from_phone: '+2348061234567' },
  ]);
  expect(mockedApi.mock.calls.at(-1)![1]).toMatchObject({ idempotencyKey: 'key' });
});

test('an amount below the network’s least is refused on the phone; no confirmed number asks for one', async () => {
  answers({ 'GET /v1/store/airtime/pool': pool, 'GET /v1/store/airtime/seller': seller, 'GET /v1/store/account/phones': { ...phones, data: [], default: null } });
  await renderScreen(<SellAirtime />);
  expect(await screen.findByText('Confirm a number first')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Add a number' }));
  expect(router.push).toHaveBeenCalledWith('/phones');
});

test('the sale’s page dials the transfer code and asks before saying it was sent', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'sale-1' });
  const sale = { object: 'airtime_sale', id: 'sale-1', number: 'AS-000012', mode: 'live', network: 'mtn', amount: 100000, currency: 'NGN', rate_bps: 8000, payout: 80000, from_phone: '+2348061234567', status: 'awaiting_transfer', collector_number: '+2348031112222', transfer_steps: '*600*08031112222*1000*PIN#', expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), sent_at: null, received_at: null, credit_at: null, credited_at: null, note: null, created_at: new Date().toISOString() };
  answers({ 'GET /v1/store/airtime/sales/sale-1': sale, 'POST /v1/store/airtime/sales/sale-1/sent': { ...sale, status: 'sent', transfer_steps: null } });
  const dial = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const ask = jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => buttons?.[1]?.onPress?.());
  await renderScreen(<AirtimeSaleScreen />);
  expect(await screen.findByText('0803 111 2222')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Dial it' }));
  expect(dial).toHaveBeenCalledWith('tel:*600*08031112222*1000*PIN%23');
  await fireEvent.press(screen.getByRole('button', { name: "I've sent it" }));
  expect(ask).toHaveBeenCalled();
  expect(await screen.findByText('Being checked')).toBeTruthy();
});

test('buying from the pool: the price, Face ID, then exactly that price paid with a kept key', async () => {
  const sent: unknown[] = [];
  answers({
    'GET /v1/store/airtime/pool': pool,
    'GET /v1/store/account/phones': phones,
    'POST /v1/store/airtime/purchases': (body: unknown) => (sent.push(body), (body as { preview?: boolean }).preview ? { object: 'airtime_purchase_quote', network: 'mtn', amount: 100000, currency: 'NGN', rate_bps: 8800, price: 88000, phone: '+2348061234567', available: 2000000 } : { object: 'airtime_purchase', id: 'buy-1' }),
  });
  await renderScreen(<BuyAirtime />);
  await fireEvent.press(await screen.findByRole('radio', { name: 'MTN' }));
  await fireEvent.changeText(screen.getByLabelText('Airtime (NGN)'), '1000');
  await fireEvent.press(screen.getByRole('button', { name: 'See the price' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Pay ₦880.00' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/airtime/purchase/[id]', params: { id: 'buy-1' } }));
  expect(LocalAuthentication.authenticateAsync).toHaveBeenCalled();
  expect(sent[1]).toEqual({ network: 'mtn', amount: 100000, phone: '+2348061234567', expected_price: 88000 });
  expect(mockedApi.mock.calls.at(-1)![1]).toMatchObject({ idempotencyKey: 'key' });
});

test('a wallet short of the price offers Add funds', async () => {
  answers({
    'GET /v1/store/airtime/pool': pool,
    'GET /v1/store/account/phones': phones,
    'POST /v1/store/airtime/purchases': (body: unknown) =>
      (body as { preview?: boolean }).preview ? { object: 'airtime_purchase_quote', network: 'mtn', amount: 100000, currency: 'NGN', rate_bps: 8800, price: 88000, phone: '+2348061234567', available: 2000000 } : refused(402, 'wallet_balance_low', 'Your NGN wallet does not have ₦880.00. Add money first.', 'amount'),
  });
  await renderScreen(<BuyAirtime />);
  await fireEvent.press(await screen.findByRole('radio', { name: 'MTN' }));
  await fireEvent.changeText(screen.getByLabelText('Airtime (NGN)'), '1000');
  await fireEvent.press(screen.getByRole('button', { name: 'See the price' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Pay ₦880.00' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Add funds' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/add-funds', params: { currency: 'NGN' } });
});

test('a new number joins once its texted code is entered', async () => {
  const two = { ...phones, data: [...phones.data, { object: 'customer_phone', phone: '+2349021112222', default: false, verified_at: '2026-11-19T00:00:00Z' }] };
  answers({
    'GET /v1/store/account/phones': phones,
    'POST /v1/store/account/phones': (body: unknown) => (expect(body).toEqual({ phone: '0902 111 2222' }), { object: 'notice', phone: '+2349021112222' }),
    'POST /v1/store/account/phones/verify': (body: unknown) => (expect(body).toEqual({ code: '123456' }), two),
  });
  await renderScreen(<PhonesScreen />);
  await fireEvent.changeText(await screen.findByLabelText('Mobile number'), '0902 111 2222');
  await fireEvent.press(screen.getByRole('button', { name: 'Text me a code' }));
  await fireEvent.changeText(await screen.findByLabelText('Code'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm number' }));
  expect(await screen.findByText('0902 111 2222')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Make default' })).toBeTruthy();
});
