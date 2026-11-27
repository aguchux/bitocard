import { fireEvent, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { UpdateGate } from '@/components/update-gate';
import { T } from '@/components/ui';

import { answers, renderScreen } from './helpers';

beforeEach(() => jest.clearAllMocks());

test.each(['required', 'available'] as const)('a %s update blocks the app and opens its store page', async update => {
  const store = 'https://play.google.com/store/apps/details?id=com.golojan.bitocard.android';
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  answers({
    'GET /v1/app/config': {
      object: 'app_config',
      platform: 'android',
      version: '0.1.0',
      update,
      min_version: null,
      latest_version: '0.1.1',
      store_url: store,
      site_url: 'https://bitocard.com',
      legal: { terms: 'https://legals.bitocard.com/documents/terms', privacy: 'https://legals.bitocard.com/documents/privacy' },
    },
  });

  await renderScreen(
    <UpdateGate>
      <T>Private app content</T>
    </UpdateGate>,
  );

  expect(await screen.findByRole('header', { name: 'Update BitoCard' })).toBeTruthy();
  expect(screen.queryByText('Private app content')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Update the app' }));
  expect(open).toHaveBeenCalledWith(store);
});
