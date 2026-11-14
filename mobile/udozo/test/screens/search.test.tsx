// Search opened from a brand's page: the listings filtered to the brand, said by name, and cleared to every brand.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import SearchScreen from '@/app/(tabs)/search';

import { answers, mockedApi, renderScreen } from './helpers';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('@/lib/market', () => ({ useMarket: () => ({ country: 'NG', markets: [], fixed: false, choose: jest.fn() }) }));
jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: null, pending: false }) }));

test('a brand from the link filters the listings, named, and can be cleared', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ country: 'NG', brand: 'samsung', brand_name: 'Samsung' });
  answers({ 'GET /v1/classifieds/listings': { object: 'list', data: [], total: 0, offset: 0 }, 'GET /v1/app/config': { features: null } });
  await renderScreen(<SearchScreen />);
  expect(await screen.findByText('Brand: Samsung')).toBeTruthy();
  await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(expect.stringMatching(/^\/v1\/classifieds\/listings\?.*brand=samsung/)));
  await fireEvent.press(screen.getByLabelText('Every brand'));
  expect(router.setParams).toHaveBeenCalledWith({ brand: '', brand_name: '' });
});
