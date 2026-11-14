// A brand's page opens like a seller's: the banner with the logo on white (it is drawn in the brand's own colour) and the
// name once, Back on the left and Post an ad, Search and Request an ad on the right, each opening its place with the
// brand; Request an ad only where wanted requests are open; signed out, posting and asking sign in first.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import BrandScreen from '@/app/brand/[slug]';

import { answers, mockedApi, renderScreen } from './helpers';

jest.mock('react-native-svg', () => {
  const draw = ({ children }: { children?: unknown }) => children ?? null;
  return { __esModule: true, default: draw, Defs: draw, LinearGradient: draw, Rect: () => null, Stop: () => null, Path: () => null };
});
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('@/lib/market', () => ({ useMarket: () => ({ country: 'NG', markets: [{ country: 'NG', name: 'Nigeria', currency: 'NGN' }], fixed: false, choose: jest.fn() }) }));
const mockAccount = { customer: null as unknown, pending: false };
jest.mock('@/lib/account', () => ({ useAccount: () => mockAccount }));

const category = (slug: string, name: string) => ({ slug, name, icon: 'smartphone', parent: { slug: 'phones-tablets', name: 'Phones and tablets' }, listings: 1 });
const page = (logo: string | null, categories = [category('mobile-phones', 'Mobile phones')]) => ({
  object: 'classified_brand_page',
  slug: 'samsung',
  name: 'Samsung',
  logo_url: logo,
  color: '#1428A0',
  country: 'NG',
  url: '',
  banner_url: null,
  listings: 2,
  sellers: 1,
  updated_at: null,
  categories,
  states: [],
  models: [],
});
const search = { object: 'list', data: [], total: 0, offset: 0 };
const channels = (wanted: boolean) => ({ object: 'classified_channels', country: 'NG', whatsapp: { available: false, number: null }, wanted });

function serve(brand = page('https://udozo.com/brand-logos/samsung.svg'), wanted = true) {
  answers({ 'GET /v1/classifieds/brands/samsung': brand, 'GET /v1/classifieds/listings': search, 'GET /v1/classifieds/channels': channels(wanted) });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount.customer = { id: 'c1', country: 'NG' };
  (useLocalSearchParams as jest.Mock).mockReturnValue({ slug: 'samsung', country: 'NG' });
});

test('the banner names the brand once, with what is for sale and the market', async () => {
  serve();
  await renderScreen(<BrandScreen />);
  expect(await screen.findByText('Samsung')).toBeTruthy();
  expect(screen.getAllByText('Samsung')).toHaveLength(1);
  expect(screen.getByText('2 for sale from 1 sellers')).toBeTruthy();
  expect(screen.getByText('Nigeria')).toBeTruthy();
  expect(screen.getByTestId('brand-banner')).toBeTruthy();
  expect(screen.getByLabelText('Back')).toBeTruthy();
  expect(await screen.findByLabelText('Request an ad')).toBeTruthy();
});

test('the logo is drawn on white, never on the brand’s own colour', async () => {
  serve();
  await renderScreen(<BrandScreen />);
  expect(await screen.findByLabelText('Samsung logo')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('brand-logo').props.style).backgroundColor).toBe('#fff');
});

test('without a logo, the initials sit on the brand’s colour', async () => {
  serve(page(null));
  await renderScreen(<BrandScreen />);
  expect(await screen.findByText('S')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('brand-logo').props.style).backgroundColor).toBe('#1428A0');
});

test('Post an ad starts with the brand, and its category when it sells in only one', async () => {
  serve();
  await renderScreen(<BrandScreen />);
  await screen.findByText('Samsung');
  await fireEvent.press(screen.getByLabelText('Post an ad'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/post/[id]', params: { id: 'new', category: 'mobile-phones', brand: 'Samsung' } });
});

test('selling in several categories, Post an ad leaves the category to the seller', async () => {
  serve(page(null, [category('mobile-phones', 'Mobile phones'), category('tvs', 'TVs')]));
  await renderScreen(<BrandScreen />);
  await screen.findByText('Samsung');
  await fireEvent.press(screen.getByLabelText('Post an ad'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/post/[id]', params: { id: 'new', brand: 'Samsung' } });
});

test('Search opens the search filtered to the brand; Request an ad starts with its name', async () => {
  serve();
  await renderScreen(<BrandScreen />);
  await screen.findByText('Samsung');
  await fireEvent.press(screen.getByLabelText('Search'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/search', params: { country: 'NG', brand: 'samsung', brand_name: 'Samsung' } });
  await fireEvent.press(await screen.findByLabelText('Request an ad'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/wanted/new', params: { words: 'Samsung' } });
});

test('Request an ad is not offered where wanted requests are off', async () => {
  serve(undefined, false);
  await renderScreen(<BrandScreen />);
  expect(await screen.findByText('Samsung')).toBeTruthy();
  await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/v1/classifieds/channels?country=NG'));
  await act(async () => {});
  expect(screen.getByLabelText('Post an ad')).toBeTruthy();
  expect(screen.queryByLabelText('Request an ad')).toBeNull();
});

test('signed out, Post an ad and Request an ad sign in first; Search needs no account', async () => {
  mockAccount.customer = null;
  serve();
  await renderScreen(<BrandScreen />);
  await screen.findByText('Samsung');
  await fireEvent.press(screen.getByLabelText('Post an ad'));
  expect(router.push).toHaveBeenLastCalledWith('/signin');
  await fireEvent.press(await screen.findByLabelText('Request an ad'));
  expect(router.push).toHaveBeenLastCalledWith('/signin');
  await fireEvent.press(screen.getByLabelText('Search'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/search', params: { country: 'NG', brand: 'samsung', brand_name: 'Samsung' } });
});
