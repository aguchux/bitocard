// A brand's page: its logo (drawn in the brand's own colour) sits on white so it shows; initials sit on its colour.
import { screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import BrandScreen from '@/app/brand/[slug]';

import { answers, renderScreen } from './helpers';

jest.mock('@/lib/market', () => ({ useMarket: () => ({ country: 'NG', markets: [], fixed: false, choose: jest.fn() }) }));

const page = (logo: string | null) => ({ object: 'classified_brand_page', slug: 'samsung', name: 'Samsung', logo_url: logo, color: '#1428A0', country: 'NG', url: '', banner_url: null, listings: 2, sellers: 1, updated_at: null, categories: [], states: [], models: [] });
const search = { object: 'list', data: [], total: 0, offset: 0 };

beforeEach(() => (useLocalSearchParams as jest.Mock).mockReturnValue({ slug: 'samsung', country: 'NG' }));

test('the logo is drawn on white, never on the brand’s own colour', async () => {
  answers({ 'GET /v1/classifieds/brands/samsung': page('https://udozo.com/brand-logos/samsung.svg'), 'GET /v1/classifieds/listings': search });
  await renderScreen(<BrandScreen />);
  expect(await screen.findByLabelText('Samsung logo')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('brand-logo').props.style).backgroundColor).toBe('#fff');
});

test('without a logo, the initials sit on the brand’s colour', async () => {
  answers({ 'GET /v1/classifieds/brands/samsung': page(null), 'GET /v1/classifieds/listings': search });
  await renderScreen(<BrandScreen />);
  expect(await screen.findByText('S')).toBeTruthy();
});
