// My Resellers in the app: the list with Accept resale orders automatically, and one reseller's notes, deals, chat
// and Stop them, each asked first.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import ResellerScreen from '@/app/reseller/[id]';
import ResellersScreen from '@/app/resellers';

import { answers, renderScreen } from './helpers';

const reseller = (overrides: Record<string, unknown> = {}) => ({
  object: 'resale_reseller',
  id: 'r1',
  reseller: { id: 'x1', name: 'Gadget Hub Ltd', verified: true, phone: null },
  stores: [{ id: 's1', name: 'Gadget Hub', url: 'https://gadgethub.udozo.com' }],
  stopped: false,
  closed_by_reseller: false,
  listings_carried: 3,
  sales: { open: 1, completed: 4, refunded: 0, paid_to_you: { currency: 'NGN', amount: 120_000_00 } },
  notes_pending: 1,
  unread: 2,
  deals: [{ object: 'resale_deal', id: 'd1', supplier_relationship_id: 'r1', listing: null, discount_bps: 1500, floor_bps: 0, status: 'active', ends_at: null, responded_at: null, ended_at: null, ended_by: null, created_at: '2026-11-10T00:00:00Z' }],
  listings: [{ id: 'sl1', store_id: 's1', listing: { id: 'l1', title: 'Leather sofa' }, status: 'active', note: { text: 'Fast delivery in Lagos', status: 'pending', reason: null, submitted_at: null } }],
  last_message_at: null,
  created_at: '2026-11-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

test('the list shows each reseller with what waits, and switches auto-accept', async () => {
  const set: unknown[] = [];
  answers({
    'GET /v1/classifieds/me/resellers': { data: [reseller()] },
    'GET /v1/classifieds/me/resale/auto-accept': { enabled: false },
    'PUT /v1/classifieds/me/resale/auto-accept': (body: unknown) => (set.push(body), { enabled: true }),
  });
  await renderScreen(<ResellersScreen />);
  expect(await screen.findByText('Gadget Hub Ltd')).toBeTruthy();
  expect(screen.getByText('3 of your listings · 4 sold · ₦120,000 paid to you · 1 note to approve · 2 unread')).toBeTruthy();
  await waitFor(() => expect(screen.getByLabelText('Accept resale orders automatically').props.disabled).toBeFalsy());
  await fireEvent(screen.getByLabelText('Accept resale orders automatically'), 'valueChange', true);
  await waitFor(() => expect(set).toEqual([{ enabled: true }]));
});

test('a reseller: approve a note as written, offer a deal, write, and stop them', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'r1' });
  const calls: string[] = [];
  answers({
    'GET /v1/classifieds/me/resellers/r1': reseller(),
    'GET /v1/classifieds/me/resellers/r1/messages': { data: [{ object: 'resale_message', id: 'm1', author: 'reseller', author_name: 'Gadget Hub Ltd', mine: false, body: 'Any more sofas?', deal: null, created_at: '2026-11-13T10:00:00Z' }], closed: false },
    'POST /v1/classifieds/me/resale-notes/sl1/approve': (body: unknown) => (calls.push(`approve ${JSON.stringify(body)}`), reseller()),
    'POST /v1/classifieds/me/resellers/r1/deals': (body: unknown) => (calls.push(`deal ${JSON.stringify(body)}`), {}),
    'POST /v1/classifieds/me/resellers/r1/messages': (body: unknown) => (calls.push(`message ${JSON.stringify(body)}`), {}),
    'POST /v1/classifieds/me/resellers/r1/stop': () => (calls.push('stop'), reseller({ stopped: true })),
  });
  await renderScreen(<ResellerScreen />);
  expect(await screen.findByText('“Fast delivery in Lagos”')).toBeTruthy();
  expect(screen.getByText('15% off every listing')).toBeTruthy();
  expect(await screen.findByText('Any more sofas?')).toBeTruthy();

  await fireEvent.press(screen.getByText('Approve'));
  await fireEvent.press(await screen.findByText('Approve note'));
  await waitFor(() => expect(calls).toEqual(['approve {"note":"Fast delivery in Lagos"}']));

  await fireEvent.press(screen.getByText('Offer a deal'));
  await fireEvent.changeText(await screen.findByLabelText('Their discount (%)'), '20');
  await fireEvent.changeText(screen.getByLabelText('Until, optional'), '31/12');
  await fireEvent.press(screen.getByText('Offer deal'));
  expect(screen.getByText('Give the end date as year, month and day, such as 2026-12-31.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Until, optional'), '2026-12-31');
  await fireEvent.press(screen.getByText('Offer deal'));
  await waitFor(() => expect(calls).toContain('deal {"listing_id":null,"discount_bps":2000,"floor_bps":0,"ends_at":"2026-12-31T23:59:59.000Z"}'));

  await fireEvent.changeText(screen.getByLabelText('Write to Gadget Hub Ltd'), 'Yes, two more.');
  await fireEvent.press(screen.getByText('Send'));
  await waitFor(() => expect(calls).toContain('message {"body":"Yes, two more."}'));

  await fireEvent.press(screen.getByText('Stop them reselling my listings'));
  await fireEvent.press(await screen.findByText('Stop them'));
  await waitFor(() => expect(calls).toContain('stop'));
});
