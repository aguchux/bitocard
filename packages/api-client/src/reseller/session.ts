import { bitocardApi } from '../base';
import type { ResellerRole, ResellerStatus } from './common';

export type User = {
  object: 'user';
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  phone: string | null;
  phone_verified: boolean;
  has_password: boolean;
  created_at: string;
};
export type ResellerRef = { object: 'reseller'; id: string; name: string; country: string | null; status: ResellerStatus };
export type Membership = { object: 'membership'; role: ResellerRole; reseller: ResellerRef };
export type Session = { object: 'session'; user: User; memberships: Membership[] };
export type Plan = { object: 'plan'; code: string; name: string; price: { amount: number; currency: string; interval: 'month' }; features: string[] };
export type Account = {
  object: 'account';
  reseller: ResellerRef;
  plan: Plan;
  authenticated_as: { type: 'session'; user_id: string; role: ResellerRole | null } | { type: 'api_key'; api_key_id: string; mode: 'test' | 'live'; scopes: string[] };
};
export type Notice = { object: 'notice'; message: string };

/** Sign-in and the signed-in person (`/v1/auth`), and the account the dashboard acts for (`/v1/account`). */
export const resellerSessionApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    session: build.query<Session, void>({ query: () => '/v1/auth/session', providesTags: ['Session'] }),
    signIn: build.mutation<Session, { identifier: string; password: string }>({ query: body => ({ url: '/v1/auth/signin', method: 'POST', body }), invalidatesTags: ['Session'] }),
    signOut: build.mutation<void, void>({ query: () => ({ url: '/v1/auth/signout', method: 'POST' }) }),
    verifyEmail: build.mutation<Session, { code: string }>({ query: body => ({ url: '/v1/auth/email/verify', method: 'POST', body }), invalidatesTags: ['Session'] }),
    resendEmailCode: build.mutation<Notice, void>({ query: () => ({ url: '/v1/auth/email/resend', method: 'POST' }) }),
    addPhone: build.mutation<Notice, { phone: string }>({ query: body => ({ url: '/v1/auth/phone', method: 'POST', body }) }),
    verifyPhone: build.mutation<Session, { code: string }>({ query: body => ({ url: '/v1/auth/phone/verify', method: 'POST', body }), invalidatesTags: ['Session'] }),
    forgotPassword: build.mutation<Notice, { email: string }>({ query: body => ({ url: '/v1/auth/password/forgot', method: 'POST', body }) }),
    resetPassword: build.mutation<unknown, { email: string; code: string; password: string }>({ query: body => ({ url: '/v1/auth/password/reset', method: 'POST', body }) }),
    updateProfile: build.mutation<Session, { name: string }>({ query: body => ({ url: '/v1/auth/profile', method: 'PATCH', body }), invalidatesTags: ['Session'] }),
    /** Needs the current password; signs out the person's other sessions. */
    changePassword: build.mutation<Notice, { current_password: string; new_password: string }>({ query: body => ({ url: '/v1/auth/password/change', method: 'POST', body }) }),
    /** Step 1: the current password; a code goes to the new address. */
    requestEmailChange: build.mutation<Notice, { email: string; password: string }>({ query: body => ({ url: '/v1/auth/email/change', method: 'POST', body }) }),
    /** Step 2: the code from the new address. */
    confirmEmailChange: build.mutation<Session, { code: string }>({ query: body => ({ url: '/v1/auth/email/change/verify', method: 'POST', body }), invalidatesTags: ['Session'] }),
    account: build.query<Account, void>({ query: () => '/v1/account', providesTags: ['Account'] }),
  }),
});

export const {
  useSessionQuery,
  useSignInMutation,
  useSignOutMutation,
  useVerifyEmailMutation,
  useResendEmailCodeMutation,
  useAddPhoneMutation,
  useVerifyPhoneMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useAccountQuery,
  useUpdateProfileMutation,
  useChangePasswordMutation,
  useRequestEmailChangeMutation,
  useConfirmEmailChangeMutation,
} = resellerSessionApi;
