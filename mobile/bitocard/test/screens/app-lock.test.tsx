import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { AppLock } from '@/components/app-lock';
import { api } from '@/lib/api';
import { renderScreen } from './helpers';

const mockRefresh = jest.fn(async () => undefined);
jest.mock('@/lib/account', () => ({
  useAccount: () => ({
    customer: { id: 'customer-1', email: 'ada@example.com', transaction_pin_set: false },
    refresh: mockRefresh,
  }),
}));

test('the next signed-in session cannot enter the app until an emailed OTP creates its PIN', async () => {
  const mockedApi = api as jest.Mock;
  mockedApi.mockImplementation(async (path: string, options: { body?: unknown }) => {
    if (path.endsWith('/code')) return { object: 'transaction_pin_code', sent: true, sent_to: 'a•••@example.com' };
    if (path.endsWith('/transaction-pin')) return { object: 'transaction_pin', set: true };
    throw new Error(`Unexpected API call ${path}`);
  });

  await renderScreen(<AppLock><></></AppLock>);
  expect(screen.getByRole('header', { name: 'Secure your BitoCard app' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Email me a code' }));
  expect(await screen.findByText(/Code sent to a•••@example.com/)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Email code'), '123456');
  await fireEvent.changeText(screen.getByLabelText('New transaction PIN'), '246802');
  await fireEvent.changeText(screen.getByLabelText('New transaction PIN again'), '246802');
  await fireEvent.press(screen.getByRole('button', { name: 'Set PIN and continue' }));

  await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  expect(mockedApi).toHaveBeenCalledWith('/v1/store/account/transaction-pin', { body: { code: '123456', pin: '246802' } });
});
