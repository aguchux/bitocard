// Lists load the next page as they near the end: the next page asked with the API's own paging, a spinner meanwhile,
// and Try again when a page fails. A rail's last card opens the rest.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import BuyOrdersScreen from '@/app/buy-orders';
import NotificationsScreen from '@/app/notifications';
import { ListingRail } from '@/components/listing-rail';
import { ListingResults } from '@/components/listing-results';
import { ApiError } from '@/lib/api-core';

import { mockedApi, renderScreen } from './helpers';

beforeEach(() => jest.clearAllMocks());

/** The API answers each address it is asked with `answer`; undefined is a 404, an error is thrown. */
function pages(answer: (path: string) => unknown) {
  mockedApi.mockImplementation(async (path: string) => {
    const value = await answer(path);
    if (value instanceof Error) throw value;
    if (value === undefined) throw new ApiError(404, { type: 'not_found_error', code: 'resource_missing', message: `No answer for ${path}` });
    return value;
  });
}

/**
 * The list holding `text` reaches its end, as a finger scrolling would make it: its `onEndReached` is called (found on
 * the FlatList above the drawn row, since a test lays nothing out to scroll).
 */
async function endOfList(text: string | RegExp) {
  const row = typeof text === 'string' ? screen.getByText(text) : screen.getByLabelText(text);
  let fiber = (row as unknown as { unstable_fiber: { return: unknown; memoizedProps?: Record<string, unknown> } | null }).unstable_fiber;
  while (fiber && typeof fiber.memoizedProps?.onEndReached !== 'function') fiber = fiber.return as typeof fiber;
  await act(async () => {
    (fiber!.memoizedProps!.onEndReached as (info: { distanceFromEnd: number }) => void)({ distanceFromEnd: 0 });
  });
}
const asked = (part: string) => mockedApi.mock.calls.filter(([path]) => String(path).includes(part)).length;

const notice = (id: string, title: string) => ({ object: 'notification', id, type: 'customer.classifieds.message', title, body: 'Open it', link: null, read_at: '2026-11-13T10:00:00Z', created_at: '2026-11-13T10:00:00Z', severity: 'info' });

test('notifications page after the last one while there are more', async () => {
  pages(path =>
    path.includes('starting_after=n2')
      ? { object: 'list', data: [notice('n3', 'Third notice')], has_more: false, unread_count: 0 }
      : path.startsWith('/v1/store/account/notifications?')
        ? { object: 'list', data: [notice('n1', 'First notice'), notice('n2', 'Second notice')], has_more: true, unread_count: 0 }
        : undefined,
  );
  await renderScreen(<NotificationsScreen />);
  await screen.findByText('Second notice');
  await endOfList('Second notice');
  await screen.findByText('Third notice');
  expect(mockedApi).toHaveBeenCalledWith('/v1/store/account/notifications?limit=30&starting_after=n2');
  // Nothing more is asked for once the API says there is none.
  await endOfList('Third notice');
  expect(asked('starting_after')).toBe(1);
});

const buyOrder = (id: string, title: string) => ({
  object: 'classified_buy_order',
  id,
  number: `BO-${id}`,
  status: 'completed',
  role: 'buyer',
  price: 25_000_000,
  counter: null,
  currency: 'NGN',
  quantity: 1,
  actions: [],
  listing: { id: `l-${id}`, ref: 77, title, path: '/ng/l/77-item', status: 'sold', cover_url: null, price: null },
  with: { name: 'Ada O.' },
  note: null,
  meet_note: null,
  conversation_id: null,
  respond_by: null,
  meet_by: null,
  meet_extended: false,
  accepted_at: null,
  bought_at: null,
  completes_at: null,
  completed_at: '2026-11-13T10:00:00Z',
  completed_by: 'seller',
  void_until: null,
  ended_by: null,
  end_reason: null,
  created_at: '2026-11-13T10:00:00Z',
  updated_at: '2026-11-13T10:00:00Z',
});

test('buy orders, which have no total, page while pages come back full, and a failed page offers Try again', async () => {
  let failed = false;
  const full = Array.from({ length: 30 }, (_, index) => buyOrder(`b${index}`, `Item ${index}`));
  pages(path => {
    if (path === '/v1/classifieds/me/buy-orders?role=buying&limit=30&offset=0') return { object: 'list', data: full, waiting: 0 };
    if (path === '/v1/classifieds/me/buy-orders?role=buying&limit=30&offset=30') {
      if (!failed) {
        failed = true;
        return new ApiError(500, { type: 'api_error', code: 'api_error', message: 'Something went wrong.' });
      }
      return { object: 'list', data: [buyOrder('last', 'The last item')], waiting: 0 };
    }
    return undefined;
  });
  await renderScreen(<BuyOrdersScreen />);
  await screen.findByText('Item 0');
  await endOfList('Item 0');
  await screen.findByTestId('list-more-failed');
  // A failed page is asked for again only by Try again, never by scrolling on.
  await endOfList('Item 0');
  expect(asked('offset=30')).toBe(1);
  fireEvent.press(screen.getByText('Try again'));
  // The page comes this time (it lands past the rows drawn so far, so its row is not looked for).
  await waitFor(() => expect(screen.queryByTestId('list-more-failed')).toBeNull());
  expect(asked('offset=30')).toBe(2);
  // A short page: nothing more to ask for.
  await endOfList('Item 0');
  expect(asked('offset=31')).toBe(0);
});

const card = (id: string) => ({
  object: 'classified_listing_card' as const,
  id,
  ref: Number(id),
  title: `Listing ${id}`,
  slug: 'item',
  country: 'NG',
  url: `https://udozo.com/ng/l/${id}-item`,
  price: { kind: 'fixed' as const, amount: 1000000, currency: 'NGN' },
  condition: 'used' as const,
  category: null,
  area: { slug: 'ikeja', name: 'Ikeja', state: { slug: 'lagos', name: 'Lagos' } },
  cover: null,
  photo_count: 0,
  has_video: false,
  highlights: [],
  delivery: 'none' as const,
  seller: { name: 'Ada O.', badges: [] },
  published_at: null,
});

test('search results load the next offset, with a spinner while it loads', async () => {
  let release: (value: unknown) => void = () => undefined;
  pages(path => {
    if (path.includes('offset=0')) return { object: 'list', data: [card('1'), card('2')], total: 3, tiers: null, offset: 0, limit: 24, sort: 'relevance' };
    if (path.includes('offset=2')) return new Promise(resolve => (release = resolve));
    return undefined;
  });
  await renderScreen(<ListingResults params={{ country: 'NG', q: 'sofa' }} />);
  await screen.findByLabelText(/^Listing 2/);
  await endOfList(/^Listing 2/);
  await screen.findByLabelText('Loading more');
  release({ object: 'list', data: [card('3')], total: 3, tiers: null, offset: 2, limit: 24, sort: 'relevance' });
  await screen.findByLabelText(/^Listing 3/);
  await waitFor(() => expect(screen.queryByLabelText('Loading more')).toBeNull());
});

test('a rail ends with See all, which opens the rest', async () => {
  const open = jest.fn();
  await renderScreen(<ListingRail items={[card('1')] as never} testID="rail-x" seeAll={{ label: 'Trending', onPress: open }} />);
  expect(screen.getByLabelText('See all: Trending')).toBeTruthy();
  fireEvent.press(screen.getByTestId('rail-x-see-all'));
  expect(open).toHaveBeenCalled();
});
