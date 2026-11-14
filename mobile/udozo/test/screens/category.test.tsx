// A category's page opens like a seller's: the banner (its top category's) with the spotlight image, else the icon, on a
// white circle and the name once with how many are for sale, the subcategories below to narrow to, and Post an ad,
// Search and Request an ad over it, each with the category; Request an ad only where wanted requests are open; signed
// out, posting and asking sign in first.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import CategoryScreen from '@/app/category/[slug]';

import { answers, mockedApi, renderScreen } from './helpers';

jest.mock('react-native-svg', () => {
  const draw = ({ children }: { children?: unknown }) => children ?? null;
  return { __esModule: true, default: draw, Defs: draw, LinearGradient: draw, Rect: () => null, Stop: () => null, Path: () => null };
});
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('@/lib/market', () => ({ useMarket: () => ({ country: 'NG', markets: [{ country: 'NG', name: 'Nigeria', currency: 'NGN' }], fixed: false, choose: jest.fn() }) }));
const mockAccount = { customer: null as unknown, pending: false };
jest.mock('@/lib/account', () => ({ useAccount: () => mockAccount }));

const categories = {
  data: [
    {
      id: 't1',
      slug: 'phones-tablets',
      name: 'Phones and tablets',
      icon: 'smartphone',
      banner_url: 'https://cdn.udozo.com/phones-banner.jpg',
      spotlight_url: 'https://cdn.udozo.com/phones-spotlight.png',
      features: [],
      children: [
        { id: 'c-phones', slug: 'mobile-phones', name: 'Mobile phones', icon: 'smartphone', features: [] },
        { id: 'c-tablets', slug: 'tablets', name: 'Tablets', icon: 'tablet', features: [] },
      ],
    },
  ],
};
const search = { object: 'list', data: [], total: 1234, offset: 0 };
const channels = (wanted: boolean) => ({ object: 'classified_channels', country: 'NG', whatsapp: { available: false, number: null }, wanted });

function serve(wanted = true) {
  answers({ 'GET /v1/classifieds/categories': categories, 'GET /v1/classifieds/listings': search, 'GET /v1/classifieds/channels': channels(wanted) });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount.customer = { id: 'c1', country: 'NG' };
  (useLocalSearchParams as jest.Mock).mockReturnValue({ slug: 'mobile-phones', country: 'NG' });
});

test('the banner names the subcategory once with how many are for sale, the subcategories below it', async () => {
  serve();
  await renderScreen(<CategoryScreen />);
  expect(await screen.findByTestId('category-banner')).toBeTruthy();
  expect(await screen.findByText('1,234 for sale')).toBeTruthy();
  // Once in the banner, once as its own pill below.
  expect(screen.getAllByText('Mobile phones')).toHaveLength(2);
  expect(screen.getByRole('header')).toHaveTextContent('Mobile phones');
  expect(screen.getByText('All Phones and tablets')).toBeTruthy();
  // A subcategory shows its icon on the circle, never its top category's spotlight.
  expect(screen.queryByTestId('category-spotlight')).toBeNull();
  await fireEvent.press(screen.getByText('Tablets'));
  expect(router.setParams).toHaveBeenCalledWith({ slug: 'tablets' });
});

test('a top category is named once, with its spotlight image on the circle', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ slug: 'phones-tablets', country: 'NG' });
  serve();
  await renderScreen(<CategoryScreen />);
  expect(await screen.findByTestId('category-banner')).toBeTruthy();
  expect(screen.getAllByText('Phones and tablets')).toHaveLength(1);
  expect(screen.getByTestId('category-spotlight').props.source).toEqual([{ uri: 'https://cdn.udozo.com/phones-spotlight.png' }]);
});

test('Post an ad, Search and Request an ad open their places with the category', async () => {
  serve();
  await renderScreen(<CategoryScreen />);
  await screen.findByTestId('category-banner');
  await fireEvent.press(screen.getByLabelText('Post an ad'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/post/[id]', params: { id: 'new', category: 'mobile-phones' } });
  await fireEvent.press(screen.getByLabelText('Search'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/search', params: { country: 'NG', category: 'mobile-phones' } });
  await fireEvent.press(await screen.findByLabelText('Request an ad'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/wanted/new', params: { category: 'mobile-phones' } });
});

test('Request an ad is not offered where wanted requests are off', async () => {
  serve(false);
  await renderScreen(<CategoryScreen />);
  await screen.findByTestId('category-banner');
  await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/v1/classifieds/channels?country=NG'));
  await act(async () => {});
  expect(screen.getByLabelText('Post an ad')).toBeTruthy();
  expect(screen.queryByLabelText('Request an ad')).toBeNull();
});

test('signed out, Post an ad and Request an ad sign in first; Search needs no account', async () => {
  mockAccount.customer = null;
  serve();
  await renderScreen(<CategoryScreen />);
  await screen.findByTestId('category-banner');
  await fireEvent.press(screen.getByLabelText('Post an ad'));
  expect(router.push).toHaveBeenLastCalledWith('/signin');
  await fireEvent.press(await screen.findByLabelText('Request an ad'));
  expect(router.push).toHaveBeenLastCalledWith('/signin');
  await fireEvent.press(screen.getByLabelText('Search'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/search', params: { country: 'NG', category: 'mobile-phones' } });
});
