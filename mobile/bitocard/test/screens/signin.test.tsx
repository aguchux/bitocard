// Signing in and creating an account against bitocard.com's own customer routes: the session is kept, an unconfirmed
// email goes to its code, and the API's refusals are shown in its own words beside the field they are about.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import SignIn from '@/app/signin';
import SignUp from '@/app/signup';

import { answers, refused, renderScreen } from './helpers';

const mockSignedIn = jest.fn(async (reply: { customer: unknown }) => reply.customer);
jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: null, signedIn: mockSignedIn }) }));

const customer = { object: 'customer', id: 'c1', email: 'ada@example.com', name: 'Ada Obi', email_verified: true, country: 'NG', currency: 'NGN' };

beforeEach(() => jest.clearAllMocks());

test('signs in with email and password, then goes home', async () => {
  answers({
    'POST /v1/store/account/signin': (body: unknown) => (expect(body).toEqual({ email: 'ada@example.com', password: 'correct horse' }), { customer, session: { token: 'bcc_1', expires_at: '' } }),
  });
  await renderScreen(<SignIn />);
  await fireEvent.changeText(screen.getByLabelText('Email'), ' ada@example.com ');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'correct horse');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  expect(mockSignedIn).toHaveBeenCalled();
});

test('a wrong password says so; an unconfirmed email goes to its code', async () => {
  answers({ 'POST /v1/store/account/signin': refused(400, 'invalid_credentials', 'The email or password is wrong.') });
  await renderScreen(<SignIn />);
  await fireEvent.changeText(screen.getByLabelText('Email'), 'ada@example.com');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('The email or password is wrong.')).toBeTruthy();

  answers({ 'POST /v1/store/account/signin': { customer: { ...customer, email_verified: false }, session: { token: 'bcc_2', expires_at: '' } } });
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/verify'));
});

test('creating an account sends the chosen country, then asks for the emailed code', async () => {
  const sent: unknown[] = [];
  answers({
    'GET /v1/countries': { data: [{ code: 'GH', name: 'Ghana', currency: 'GHS' }, { code: 'NG', name: 'Nigeria', currency: 'NGN' }] },
    'POST /v1/store/account/signup': (body: unknown) => (sent.push(body), { customer: { ...customer, email_verified: false }, session: { token: 'bcc_3', expires_at: '' } }),
  });
  await renderScreen(<SignUp />);
  await fireEvent.changeText(screen.getByLabelText('Full name'), 'Ada Obi');
  await fireEvent.changeText(screen.getByLabelText('Email'), 'ada@example.com');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'long enough pass');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByText('Choose your country.')).toBeTruthy();
  await fireEvent.press(await screen.findByRole('radio', { name: 'Nigeria, NGN' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/verify'));
  expect(sent).toEqual([{ name: 'Ada Obi', email: 'ada@example.com', country: 'NG', password: 'long enough pass' }]);
});
