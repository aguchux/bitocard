// Deleting the account in the app: what stands in the way is shown; otherwise DELETE (and the password) deletes it
// and the phone forgets the session.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import DeleteAccountScreen from '@/app/delete-account';

import { answers, renderScreen } from './helpers';

const mockForget = jest.fn(async () => undefined);
jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1' }, pending: false, forget: mockForget }) }));

beforeEach(() => jest.clearAllMocks());

test('money in the wallet stands in the way', async () => {
  answers({ 'GET /v1/store/account/delete': { can_delete: false, password_required: true, blockers: [{ code: 'account_has_money', message: 'Your wallet or payouts still hold money.' }] } });
  await renderScreen(<DeleteAccountScreen />);
  expect(await screen.findByText('• Your wallet or payouts still hold money.')).toBeTruthy();
  expect(screen.queryByText('Delete my account')).toBeNull();
});

test('DELETE and the password delete it; then signed out and home', async () => {
  const sent: unknown[] = [];
  answers({
    'GET /v1/store/account/delete': { can_delete: true, password_required: true, blockers: [] },
    'POST /v1/store/account/delete': (body: unknown) => (sent.push(body), { deleted: true }),
  });
  await renderScreen(<DeleteAccountScreen />);
  await fireEvent.changeText(await screen.findByLabelText('Your password'), 'a long password');
  await fireEvent.press(screen.getByText('Delete my account'));
  expect(sent).toHaveLength(0);
  await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
  await fireEvent.press(screen.getByText('Delete my account'));
  await waitFor(() => expect(sent).toEqual([{ confirm: 'DELETE', password: 'a long password' }]));
  await waitFor(() => expect(mockForget).toHaveBeenCalled());
  expect(router.replace).toHaveBeenCalledWith('/');
});
