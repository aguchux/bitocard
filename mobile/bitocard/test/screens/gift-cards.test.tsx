// Gift cards: buying one goes to Confirm payment with its value, how many and the email; a delivered order's codes stay
// hidden until Reveal and Face ID, with screen capture blocked while shown; selling quotes the exact payout first and
// sends the code (or photos) with it, so a lower rate meanwhile is refused; an unchecked identity leads to the check.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { router, useLocalSearchParams } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';

import GiftCardScreen from '@/app/gift-card/[key]';
import OrderScreen from '@/app/order/[id]';
import SellCard from '@/app/sell/[key]';
import { apiUpload } from '@/lib/api';

import { answers, refused, renderScreen } from './helpers';

jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1', name: 'Ada Obi', email: 'ada@example.com', country: 'NG', currency: 'NGN', email_verified: true } }) }));

const uploaded = apiUpload as unknown as jest.Mock;
const brand = { slug: 'amazon', name: 'Amazon', logo_url: null, color: '#111111', initials: 'A' };

beforeEach(() => jest.clearAllMocks());

test('buying a gift card: the day’s rate, a value and how many, then Confirm payment', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ key: 'gift_cards:US:amazon:usd' });
  answers({
    'GET /v1/store/products/gift_cards%3AUS%3Aamazon%3Ausd': { object: 'store_product', id: 'p-amz', key: 'gift_cards:US:amazon:usd', name: 'Amazon US', category: 'gift_cards', country: 'US', face_currency: 'USD', denomination_type: 'fixed', from: 1000, to: 10000, logo_url: null, brand, denominations: [1000, 2500, 5000], range: null, recipient_type: 'email' },
    'GET /v1/store/products/gift_cards%3AUS%3Aamazon%3Ausd/rate': { object: 'store_rate', currency: 'NGN', face_currency: 'USD', rate: 129000, values: [{ face_value: 1000, price: 1290000 }, { face_value: 2500, price: 3225000 }, { face_value: 5000, price: 6450000 }] },
  });
  await renderScreen(<GiftCardScreen />);
  expect(await screen.findByText('₦1,290.00 per $1')).toBeTruthy();
  await fireEvent.press(await screen.findByRole('radio', { name: '$25' }));
  await fireEvent.press(screen.getByRole('button', { name: 'One more' }));
  expect(screen.getByText('₦64,500.00')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/pay', params: { product: 'p-amz', face: '2500', quantity: '2', email: 'ada@example.com', name: 'Amazon US $25 × 2' } });
});

test('a delivered code stays hidden until Reveal and Face ID; screen capture is blocked while it shows', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'chk_9' });
  answers({
    'GET /v1/store/checkouts/chk_9': {
      object: 'checkout', id: 'chk_9', mode: 'live', status: 'completed', product: { id: 'p', key: 'k', name: 'Amazon US', category: 'gift_cards', brand: 'amazon' },
      face_value: 2500, face_currency: 'USD', quantity: 1, amount: 3225000, currency: 'NGN', charged: null, method: { id: 'wallet', label: 'Wallet' }, checkout_url: null, recipient: { email: 'ada@example.com' },
      order: { id: 'o', status: 'completed', receipt_number: 'BC-000200', completed_at: null, deliveries: [{ kind: 'gift_card', code: 'AQ7K-93HDX2-PL4M', pin: null, serial: null, details: {} }], redeem_instructions: 'Redeem at amazon.com/redeem.' },
      failure_reason: null, refunded_at: null, created_at: new Date().toISOString(),
    },
  });
  await renderScreen(<OrderScreen />);
  expect(await screen.findByText('••••••••••••PL4M')).toBeTruthy();
  expect(screen.queryByText('AQ7K-93HDX2-PL4M')).toBeNull();
  expect(usePreventScreenCapture).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Reveal' }));
  expect(await screen.findByText('AQ7K-93HDX2-PL4M')).toBeTruthy();
  expect(LocalAuthentication.authenticateAsync).toHaveBeenCalled();
  expect(usePreventScreenCapture).toHaveBeenCalled();
});

const offers = { object: 'gift_card_sell_options', available: true, reason: null, currency: 'NGN', offers: [{ id: 'off-1', name: 'Amazon US e-code', form: 'ecode', minimum: 10, maximum: 500, currency: 'NGN', rate: 124800, terms: null }] };

test('selling an e-code: the exact payout first, then the code sent with it', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ key: 'gift_cards:US:amazon:usd' });
  answers({
    'GET /v1/store/gift-card-sales/offers': offers,
    'POST /v1/store/gift-card-sales/quote': (body: unknown) => (expect(body).toEqual({ offer_id: 'off-1', amount: 100 }), { object: 'gift_card_sale_quote', offer_id: 'off-1', amount: 100, currency: 'NGN', payout: 12480000 }),
  });
  uploaded.mockResolvedValue({ object: 'gift_card_sale', id: 'sale-1' });
  await renderScreen(<SellCard />);
  expect(await screen.findByText('We pay ₦1,248.00 per 1 of its value')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Card value (as printed on it)'), '100');
  await fireEvent.press(screen.getByRole('button', { name: 'See what you get' }));
  expect(await screen.findByText('₦124,800.00')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Card code'), ' AQ7K-93HDX2-PL4M ');
  await fireEvent.press(screen.getByRole('button', { name: 'Sell for ₦124,800.00' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/sale/[id]', params: { id: 'sale-1' } }));
  const [path, form, key] = uploaded.mock.calls[0]!;
  expect([path, key]).toEqual(['/v1/store/gift-card-sales', 'key']);
  const body = form as FormData & { _parts?: [string, unknown][] };
  const parts = Object.fromEntries(body._parts ?? Array.from(body.entries()));
  expect(parts).toEqual({ offer_id: 'off-1', amount: '100', expected_payout: '12480000', code: 'AQ7K-93HDX2-PL4M' });
});

test('a value outside the card’s limits is refused here; an unchecked identity leads to the check', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ key: 'gift_cards:US:amazon:usd' });
  answers({
    'GET /v1/store/gift-card-sales/offers': offers,
    'POST /v1/store/gift-card-sales/quote': { object: 'gift_card_sale_quote', offer_id: 'off-1', amount: 100, currency: 'NGN', payout: 12480000 },
  });
  uploaded.mockRejectedValue(refused(403, 'customer_verification_required', 'Verify your identity before selling a gift card.'));
  await renderScreen(<SellCard />);
  await fireEvent.changeText(await screen.findByLabelText('Card value (as printed on it)'), '5');
  await fireEvent.press(screen.getByRole('button', { name: 'See what you get' }));
  expect(await screen.findByText('This card is bought from 10 to 500.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Card value (as printed on it)'), '100');
  await fireEvent.press(screen.getByRole('button', { name: 'See what you get' }));
  await fireEvent.changeText(await screen.findByLabelText('Card code'), 'AQ7K-93HDX2-PL4M');
  await fireEvent.press(await screen.findByRole('button', { name: 'Sell for ₦124,800.00' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Check my identity' }));
  expect(router.push).toHaveBeenCalledWith('/identity');
});
