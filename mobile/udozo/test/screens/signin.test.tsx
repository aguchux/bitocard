// Sign in: the email first, then the password; an email with no account goes on to sign up with it; an unfinished
// account goes to Finish your account. Sign up: email, code, then the details, the mobile kept to confirm later.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import SignInScreen from '@/app/signin';
import SignUpScreen from '@/app/signup';

import { answers, refused, renderScreen } from './helpers';

const mockSignedIn = jest.fn(async (reply: { customer: unknown }) => reply.customer);
jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: null, pending: false, signedIn: mockSignedIn }) }));
jest.mock('@/lib/market', () => ({ useMarket: () => ({ country: 'NG', markets: [], fixed: false, choose: jest.fn() }) }));

const ready = { id: 'c1', email: 'ada@example.com', email_verified: true, phone_verified: false, phone_verification_available: true, phone_deferred: true, country: 'NG' };

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
});

test('email, then password, then back where the shopper was', async () => {
  answers({
    'POST /v1/store/account/signin/lookup': { exists: true, password: true },
    'POST /v1/store/account/signin': (body: unknown) => (expect(body).toEqual({ email: 'ada@example.com', password: 'correct horse' }), { customer: ready, session: { token: 'bcc_1' } }),
  });
  await renderScreen(<SignInScreen />);
  await fireEvent.changeText(screen.getByLabelText('Email'), ' ada@example.com ');
  await fireEvent.press(screen.getByText('Continue'));
  await fireEvent.changeText(await screen.findByLabelText('Password'), 'correct horse');
  await fireEvent.press(screen.getByText('Sign in'));
  await waitFor(() => expect(mockSignedIn).toHaveBeenCalled());
  await waitFor(() => expect(router.back).toHaveBeenCalled());
});

test('a wrong password says so; an email with no account goes to sign up with it', async () => {
  answers({
    'POST /v1/store/account/signin/lookup': (body: unknown) => ((body as { email: string }).email === 'new@example.com' ? { exists: false } : { exists: true, password: true }),
    'POST /v1/store/account/signin': refused(400, 'invalid_credentials', 'The email or password is wrong.'),
  });
  await renderScreen(<SignInScreen />);
  await fireEvent.changeText(screen.getByLabelText('Email'), 'ada@example.com');
  await fireEvent.press(screen.getByText('Continue'));
  await fireEvent.changeText(await screen.findByLabelText('Password'), 'nope nope nope');
  await fireEvent.press(screen.getByText('Sign in'));
  expect(await screen.findByText('The email or password is wrong.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Use another email'));
  await fireEvent.changeText(screen.getByLabelText('Email'), 'new@example.com');
  await fireEvent.press(screen.getByText('Continue'));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/signup', params: { email: 'new@example.com', ref: undefined } }));
});

test('an unfinished account goes to Finish your account', async () => {
  answers({
    'POST /v1/store/account/signin/lookup': { exists: true, password: true },
    'POST /v1/store/account/signin': { customer: { ...ready, email_verified: false }, session: { token: 'bcc_2' } },
  });
  await renderScreen(<SignInScreen />);
  await fireEvent.changeText(screen.getByLabelText('Email'), 'ada@example.com');
  await fireEvent.press(screen.getByText('Continue'));
  await fireEvent.changeText(await screen.findByLabelText('Password'), 'correct horse');
  await fireEvent.press(screen.getByText('Sign in'));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/verify'));
});

test('sign up: the emailed code, then the details with the mobile kept to confirm later', async () => {
  const created: unknown[] = [];
  answers({
    'POST /v1/store/account/signup/email': { object: 'notice' },
    'POST /v1/store/account/signup/email/verify': { signup_token: 'tok_0123456789abcdefghij' },
    'GET /v1/countries': { data: [{ code: 'NG', name: 'Nigeria', currency: 'NGN' }, { code: 'GH', name: 'Ghana', currency: 'GHS' }] },
    'POST /v1/store/account/signup': (body: unknown) => (created.push(body), { customer: ready, session: { token: 'bcc_3' } }),
  });
  await renderScreen(<SignUpScreen />);
  await fireEvent.changeText(screen.getByLabelText('Email'), 'ada@example.com');
  await fireEvent.press(screen.getByText('Email me a code'));
  await fireEvent.changeText(await screen.findByLabelText('Code'), '123456');
  await fireEvent.press(screen.getByText('Continue'));
  await fireEvent.changeText(await screen.findByLabelText('First name'), 'Ada');
  await fireEvent.changeText(screen.getByLabelText('Last name'), 'Obi');
  await fireEvent.changeText(screen.getByLabelText('Mobile number'), '0803 123 4567');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'a long password');
  await fireEvent.press(screen.getByText('Create my account'));
  await waitFor(() => expect(created).toHaveLength(1));
  expect(created[0]).toEqual({ first_name: 'Ada', last_name: 'Obi', email: 'ada@example.com', country: 'NG', phone: '0803 123 4567', phone_later: true, password: 'a long password', signup_token: 'tok_0123456789abcdefghij', ref: undefined });
  await waitFor(() => expect(router.back).toHaveBeenCalled());
});
