// An order's extras in the app: a Connect return accepted and its code shown, sent on to a centre near the seller (paid
// with its shipping confirmed), a Udozo auction's left-over claimed, and a resale order's money, buyer, threads and
// Report this store. Nothing opens udozo.com.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import OrderScreen from '@/app/order/[id]';

import { answers, renderScreen } from './helpers';

jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1', country: 'NG', currency: 'NGN' }, pending: false, error: null, retry: jest.fn() }) }));

const centre = { id: 'cc1', number: 'CC-1', name: 'Ikeja Connect Centre', address: '1 Allen Avenue', landmark: null, area: 'Ikeja', state: 'Lagos', hours: 'Mon to Sat, 9 to 6', phone: '' };
const order = (overrides: Record<string, unknown> = {}) => ({
  object: 'classified_order',
  id: 'o1',
  number: 'SP-000101',
  role: 'seller',
  kind: 'direct',
  quantity: 1,
  status: 'refunded',
  listing: { id: 'l1', ref: 101, title: 'iPhone 13 128GB', slug: 'iphone-13', cover_url: null },
  with: { name: 'Ada O.' },
  store: null,
  supplier: null,
  fulfilment: 'connect',
  connect: null,
  currency: 'NGN',
  price: 45_000_00,
  delivery_fee: 0,
  seller_fee: 1_000_00,
  payout: 44_000_00,
  refund: null,
  delivery_address: null,
  tracking_note: null,
  shipment: null,
  deadlines: { accept_by: '2026-11-14T10:00:00Z', pay_by: null, handover_by: null, confirm_by: null },
  ended_by: null,
  end_reason: null,
  ...overrides,
});
const returned = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  number: 'RT-000007',
  reason: 'not_collected',
  status: 'requested',
  answer_by: '2026-11-15T10:00:00Z',
  decided_by: null,
  collect_by: '2099-11-20T10:00:00Z',
  collected_at: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'o1' });
});

test('the seller accepts a return, sees the return code, and has it sent to a centre near them', async () => {
  const calls: string[] = [];
  let item = returned();
  answers({
    'GET /v1/classifieds/orders/o1': () => order({ connect: { centre, received_at: null, ready_at: null, collect_by: null, return: item } }),
    'POST /v1/classifieds/orders/o1/return/accept': () => (calls.push('accept'), (item = returned({ status: 'accepted' })), { status: 'accepted' }),
    'GET /v1/classifieds/orders/o1/return-code': { code: '482913', tries_left: 5 },
    'GET /v1/classifieds/orders/o1/return/ship-options': { currency: 'NGN', collect_by: '2099-11-20T10:00:00Z', data: [{ centre: { ...centre, id: 'cc2', name: 'Yaba Connect Centre', area: 'Yaba' }, shipping: 2_500_00 }] },
    'POST /v1/classifieds/orders/o1/return/ship': (body: unknown) => (calls.push(`ship ${JSON.stringify(body)}`), { number: 'TF-000001', status: 'paid' }),
  });
  await renderScreen(<OrderScreen />);
  expect(await screen.findByText('Return RT-000007: asked for')).toBeTruthy();
  expect(screen.queryByText('More about this order on udozo.com')).toBeNull();
  await fireEvent.press(screen.getByText('Accept the return'));
  await waitFor(() => expect(screen.getAllByText('Accept the return')).toHaveLength(2));
  await fireEvent.press(screen.getAllByText('Accept the return').at(-1)!);
  await waitFor(() => expect(calls).toEqual(['accept']));
  expect(await screen.findByText('Return RT-000007: accepted')).toBeTruthy();

  await fireEvent.press(screen.getByText('Show my return code'));
  expect(await screen.findByText('482913')).toBeTruthy();

  await fireEvent.press(screen.getByText('Send it to a centre near me'));
  await fireEvent.press(await screen.findByText('Lagos: Yaba Connect Centre, Yaba (₦2,500)'));
  await fireEvent.press(screen.getByText('Pay ₦2,500 and send it'));
  await fireEvent.press(await screen.findByText('Pay and send it'));
  await waitFor(() => expect(calls).toEqual(['accept', 'ship {"centre_id":"cc2","expected_shipping":250000}']));
});

test('the seller claims what a Udozo auction left over', async () => {
  const claims: unknown[] = [];
  answers({
    'GET /v1/classifieds/orders/o1': order({ connect: { centre, received_at: null, ready_at: null, collect_by: null, auction: { number: 'AU-000003', sale: 60_000_00, left_over: 12_000_00, claim_by: '2099-01-01T00:00:00Z', unclaimed_at: null, claim: null } } }),
    'POST /v1/classifieds/orders/o1/auction-claim': (body: unknown) => (claims.push(body), { status: 'requested', amount: 12_000_00, number: 'CL-000001' }),
  });
  await renderScreen(<OrderScreen />);
  expect(await screen.findByText('Sold at Udozo auction AU-000003 for ₦60,000')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Anything Udozo should know (optional)'), 'Please pay to my bank.');
  await fireEvent.press(screen.getByText('Claim what is left over'));
  await fireEvent.press(await screen.findByText('Claim it'));
  await waitFor(() => expect(claims).toEqual([{ note: 'Please pay to my bank.' }]));
});

test('a resale order shows the supplier their price less the discount, the buyer, and both threads', async () => {
  const sent: unknown[] = [];
  answers({
    'GET /v1/classifieds/orders/o1': order({
      kind: 'resale',
      status: 'paid',
      fulfilment: 'meet_up',
      store: { id: 's1', name: 'Gadget Hub', subdomain: 'gadgethub', logo_url: null },
      resale: { supplier_price: 45_000_00, discount_bps: 1000, supplier_net: 40_500_00, deal_id: null },
      buyer_details: { name: 'Bola A.', email: 'bola@example.com', phone: '+2348030000000', address: null },
    }),
    'GET /v1/classifieds/orders/o1/messages': { data: [{ object: 'resale_order_message', id: 'm1', thread: 'order', from: 'buyer', name: 'Bola A.', body: 'When can I collect it?', created_at: '2026-11-13T10:00:00Z' }] },
    'POST /v1/classifieds/orders/o1/messages': (body: unknown) => (sent.push(body), { object: 'resale_order_message', id: 'm2', thread: 'trade', from: 'me', name: 'You', body: 'Ready', created_at: '2026-11-13T11:00:00Z' }),
  });
  await renderScreen(<OrderScreen />);
  expect(await screen.findByText('Resale through Gadget Hub')).toBeTruthy();
  expect(screen.getByText('Reseller’s discount')).toBeTruthy();
  expect(screen.getByText('Bola A.')).toBeTruthy();
  expect(await screen.findByText('When can I collect it?')).toBeTruthy();
  await fireEvent.press(screen.getByText('With Gadget Hub'));
  await fireEvent.changeText(screen.getByLabelText('Write a message'), 'Ready');
  await fireEvent.press(screen.getByText('Send'));
  await waitFor(() => expect(sent).toEqual([{ thread: 'trade', body: 'Ready' }]));
});

test('a resale buyer writes to the store and reports it', async () => {
  const reports: unknown[] = [];
  answers({
    'GET /v1/classifieds/orders/o1': order({ role: 'buyer', kind: 'resale', status: 'paid', fulfilment: 'meet_up', buyer_fee: 0, total: 45_000_00, with: { name: 'Gadget Hub' }, supplier: { name: 'Chidi E.' }, store: { id: 's1', name: 'Gadget Hub', subdomain: 'gadgethub', logo_url: null } }),
    'GET /v1/store/resale/orders/o1/messages': { data: [] },
    'POST /v1/store/resale/reports': (body: unknown) => (reports.push(body), { number: 'RR-000004' }),
  });
  await renderScreen(<OrderScreen />);
  expect(await screen.findByText('Messages with Gadget Hub')).toBeTruthy();
  expect(screen.getByText('Sold by Gadget Hub; supplied by Chidi E., who hands it over or ships it.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Report Gadget Hub'));
  await fireEvent.changeText(await screen.findByLabelText('What happened'), 'They said they make these phones.');
  await fireEvent.press(screen.getByText('Send report'));
  await waitFor(() => expect(reports).toEqual([{ reason: 'claims_ownership', details: 'They said they make these phones.', order_id: 'o1' }]));
  expect(await screen.findByText('Thank you. Your report RR-000004 is with Udozo, and we will tell you what we decide.')).toBeTruthy();
});
