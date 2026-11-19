// Deleting the account: what stands in the way is said first and nothing can be pressed; otherwise DELETE typed and
// the password, then the phone signs out and goes back to the welcome screen.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import DeleteAccountScreen from '@/app/delete-account';

import { answers, mockedApi, renderScreen } from './helpers';

const mockSignOut = jest.fn(async () => undefined);
jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1', name: 'Ada Obi', email: 'ada@example.com', country: 'NG', currency: 'NGN', email_verified: true }, signOut: mockSignOut }) }));

beforeEach(() => jest.clearAllMocks());

test('money still held stands in the way', async () => {
  answers({ 'GET /v1/store/account/delete': { object: 'account_deletion_check', can_delete: false, password_required: true, blockers: [{ code: 'account_has_money', message: 'Your wallets still hold money. Spend it first, or ask us to help.' }] } });
  await renderScreen(<DeleteAccountScreen />);
  expect(await screen.findByText(/Your wallets still hold money/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Delete my account' })).toBeNull();
});

test('DELETE and the password delete it, then the phone signs out', async () => {
  answers({
    'GET /v1/store/account/delete': { object: 'account_deletion_check', can_delete: true, password_required: true, blockers: [] },
    'POST /v1/store/account/delete': (body: unknown) => (expect(body).toEqual({ confirm: 'DELETE', password: 'correct horse' }), { object: 'account_deletion', deleted: true, deleted_at: '' }),
  });
  await renderScreen(<DeleteAccountScreen />);
  await fireEvent.changeText(await screen.findByLabelText('Your password'), 'correct horse');
  await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'delete');
  expect(screen.getByRole('button', { name: 'Delete my account' }).props.accessibilityState?.disabled).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
  await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/welcome'));
  expect(mockSignOut).toHaveBeenCalled();
  expect(mockedApi.mock.calls.filter(([path, options]) => path === '/v1/store/account/delete' && options?.body)).toHaveLength(1);
});
