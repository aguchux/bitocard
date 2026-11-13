// Home: udozo.com's hero reel at the top in place of the page's own hero (and the page as before without it).
import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import HomeScreen from '@/app/(tabs)/index';

import { answers, renderScreen } from './helpers';

const mockAccount: { customer: unknown; pending: boolean } = { customer: null, pending: false };
jest.mock('@/lib/account', () => ({ useAccount: () => mockAccount }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('@/lib/market', () => ({ useMarket: () => ({ country: 'NG', markets: [{ country: 'NG', name: 'Nigeria', listings: 10 }], fixed: false, choose: jest.fn() }) }));

const home = {
  object: 'classified_home',
  page: 'NG',
  rows: [
    {
      id: 'r1',
      hidden: false,
      title: '',
      subtitle: '',
      viewAll: null,
      view_all_href: null,
      background: 'none',
      image: null,
      width: 'contained',
      spacing: 'normal',
      blocks: [{ id: 'h1', type: 'home_hero', hidden: false, style: 'carousel', title: 'Udozo', accent: '', subtitle: '', slides: [], data: { slides: [{ image: 'https://cdn.udozo.com/hero.jpg', title: 'The page’s own hero', subtitle: '', href: '/ng' }] } }],
    },
  ],
  sections: [],
};
const slide = (id: string, layout: string, tiles: Record<string, unknown>[]) => ({ object: 'hero_slide', id, layout, tiles });
const tile = (overrides: Record<string, unknown> = {}) => ({ id: 't1', image_url: 'https://cdn.udozo.com/banner.jpg', photos: [], alt: 'Phones for less', href: '/ng/c/phones', ad: false, ...overrides });

const routes = (heroSlides: unknown) => ({
  'GET /v1/classifieds/home': home,
  'GET /v1/classifieds/hero-slides': heroSlides,
  'GET /v1/app/config': { features: { assistant: false } },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount.customer = null;
});

test('the reel opens Home in place of the page’s own hero, its banners linked and Ad marked', async () => {
  answers(
    routes({
      object: 'list',
      data: [
        slide('a', 'full', [tile()]),
        slide('b', 'third_two_thirds', [tile({ id: 't2', alt: 'Generators', image_url: null, photos: ['https://cdn.udozo.com/1.jpg', 'https://cdn.udozo.com/2.jpg'], href: '/ng/c/generators-solar' }), tile({ id: 't3', alt: 'Solar deals', ad: true, href: 'https://example.com/solar' })]),
      ],
    }),
  );
  await renderScreen(<HomeScreen />);
  expect(await screen.findByTestId('hero-slide-a')).toBeTruthy();
  expect(screen.getByTestId('hero-slide-b')).toBeTruthy();
  expect(screen.getByTestId('home-band')).toBeTruthy();
  // The columns repeat to loop; only the first copy is read out.
  expect(screen.getAllByLabelText('Phones for less')).toHaveLength(1);
  expect(screen.getAllByLabelText('Phones for less', { includeHiddenElements: true }).length).toBeGreaterThan(1);
  expect(screen.getAllByText('Generators')).toHaveLength(1);
  expect(screen.getAllByText('Ad')).toHaveLength(1);
  expect(screen.getByLabelText('Solar deals, ad')).toBeTruthy();
  expect(screen.queryByLabelText('The page’s own hero')).toBeNull();

  await fireEvent.press(screen.getAllByLabelText('Phones for less')[0]!);
  expect(router.push).toHaveBeenCalledWith('/category/phones?country=NG');
});

test('without columns Home is as before, with the page’s own hero', async () => {
  answers(routes({ object: 'list', data: [] }));
  await renderScreen(<HomeScreen />);
  expect(await screen.findByLabelText('The page’s own hero')).toBeTruthy();
  expect(screen.queryByTestId('hero-reel')).toBeNull();
  expect(screen.queryByTestId('home-band')).toBeNull();
});

const profile = { object: 'shop_assistant', assistant: { id: 'b1', name: 'Anjio', avatar_url: null, label: 'AI assistant', language: 'en', greeting: 'Hi', roles: ['browse'], suggestions: [] }, languages: [] };

test('Ask sits on the right of the search box where the market has an assistant, and asks what is typed', async () => {
  answers({ ...routes({ object: 'list', data: [] }), 'GET /v1/app/config': { features: { assistant: true } }, 'GET /v1/classifieds/assistant': profile });
  await renderScreen(<HomeScreen />);
  const ask = await screen.findByRole('button', { name: 'Ask Anjio' });
  expect(screen.getByText('Anjio')).toBeTruthy();
  expect(screen.queryByText('Ask Anjio')).toBeNull();

  await fireEvent.changeText(screen.getByLabelText('Search Udozo'), 'solar inverter');
  await fireEvent.press(screen.getByRole('button', { name: 'Ask Anjio: solar inverter' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/assistant', params: { country: 'NG', question: 'solar inverter' } });
  expect(ask).toBeTruthy();

  await fireEvent(screen.getByLabelText('Search Udozo'), 'submitEditing');
  expect(router.push).toHaveBeenCalledWith({ pathname: '/search', params: { q: 'solar inverter' } });
});

test('no Ask where the market has no assistant', async () => {
  answers(routes({ object: 'list', data: [] }));
  await renderScreen(<HomeScreen />);
  expect(await screen.findByLabelText('Search Udozo')).toBeTruthy();
  await screen.findByLabelText('The page’s own hero');
  expect(screen.queryByRole('button', { name: /^Ask/ })).toBeNull();
});
