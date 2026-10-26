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
export type TwoStepMethod = 'authenticator' | 'email' | 'sms';
/** Whether this session still has to finish two-step sign-in (`setup_required`: set a method up first). */
export type SessionTwoStep = { pending: boolean; setup_required: boolean; method: TwoStepMethod | null };
export type Session = { object: 'session'; user: User; memberships: Membership[]; two_step: SessionTwoStep };
/** The person's two-step sign-in settings (`/v1/auth/two-step`). */
export type TwoStepSettings = {
  object: 'two_step';
  method: TwoStepMethod | null;
  enabled_at: string | null;
  /** One of their reseller accounts requires it: it cannot be turned off. */
  required: boolean;
  pending: boolean;
  setup_required: boolean;
  /** Where emailed or texted codes go, masked. */
  sent_to: string | null;
  recovery_codes_left: number;
  methods: Array<{ method: TwoStepMethod; available: boolean; reason: 'not_allowed' | 'phone_required' | 'sms_unavailable' | null }>;
};
export type TwoStepSetup = { object: 'two_step_setup'; method: TwoStepMethod; secret: string | null; otpauth_uri: string | null; sent_to: string | null };
export type TwoStepChallenge = { object: 'two_step_challenge'; method: TwoStepMethod; sent: boolean; sent_to: string | null };
export type Plan = { object: 'plan'; code: string; name: string; price: { amount: number; currency: string; interval: 'month' }; features: string[] };
/** A plan as listed (`/v1/plans`) and on your subscription: its description, features in words and price in your currency. */
export type PlanDetail = Plan & {
  description: string | null;
  feature_details: Array<{ code: string; name: string; description: string }>;
  /** What it costs a month in your currency: fixed by BitoCard (`fixed`), or the US dollar price at today's rate. */
  local_price: { amount: number; currency: string; fixed: boolean } | null;
};
export type Account = {
  object: 'account';
  reseller: ResellerRef;
  plan: Plan;
  authenticated_as:
    | { type: 'session'; user_id: string; role: ResellerRole | null }
    | { type: 'api_key'; api_key_id: string; mode: 'test' | 'live'; scopes: string[] }
    /** A "Try it" token from the API docs. */
    | { type: 'docs_token'; mode: 'test' | 'live'; scopes: string[]; expires_at: string };
};
export type Notice = { object: 'notice'; message: string };

/** One of a person's email addresses. Exactly one is primary: it signs in and gets notices, and cannot be removed. */
export type UserEmail = { object: 'user_email'; email: string; primary: boolean; verified: boolean; added_at: string };
export type UserPhone = { object: 'user_phone'; phone: string; primary: boolean; verified: boolean; added_at: string };
/**
 * `country` and `business_name` open a reseller account (with the owner's `phone`, a mobile number of that country, kept
 * unconfirmed); `invitation_token` joins the inviting team instead.
 */
export type SignUpInput = { name: string; email: string; password: string } & (
  | { country: string; business_name?: string; phone?: string; signup_token?: string }
  | { invitation_token: string }
);
/** From confirming the sign-up code: pass `signup_token` to sign-up with the same email (one hour, once). */
export type SignupVerification = { object: 'signup_verification'; email: string; signup_token: string; expires_at: string };

/** Sign-in and the signed-in person (`/v1/auth`), and the account the dashboard acts for (`/v1/account`). */
export const resellerSessionApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    session: build.query<Session, void>({ query: () => '/v1/auth/session', providesTags: ['Session'] }),
    /** Step-by-step sign-up: emails a code to confirm the address before the account exists. */
    startSignupEmail: build.mutation<Notice, { email: string }>({ query: body => ({ url: '/v1/auth/signup/email', method: 'POST', body }) }),
    /** Confirms the code; the token finishes sign-up with the email already confirmed. */
    verifySignupEmail: build.mutation<SignupVerification, { email: string; code: string }>({ query: body => ({ url: '/v1/auth/signup/email/verify', method: 'POST', body }) }),
    /** Creates the person and, without an invitation, their reseller account (they own it); signs them in. A code is emailed to confirm the address. */
    signUp: build.mutation<Session, SignUpInput>({ query: body => ({ url: '/v1/auth/signup', method: 'POST', body }), invalidatesTags: ['Session'] }),
    /** A signed-in person with a confirmed email opens their own reseller account (one owned account each). */
    createResellerAccount: build.mutation<Session, { business_name: string; country: string; phone?: string }>({
      query: body => ({ url: '/v1/auth/reseller-account', method: 'POST', body }),
      invalidatesTags: ['Session'],
    }),
    signIn: build.mutation<Session, { identifier: string; password: string }>({ query: body => ({ url: '/v1/auth/signin', method: 'POST', body }), invalidatesTags: ['Session'] }),
    signOut: build.mutation<void, void>({ query: () => ({ url: '/v1/auth/signout', method: 'POST' }) }),
    verifyEmail: build.mutation<Session, { code: string }>({ query: body => ({ url: '/v1/auth/email/verify', method: 'POST', body }), invalidatesTags: ['Session'] }),
    resendEmailCode: build.mutation<Notice, void>({ query: () => ({ url: '/v1/auth/email/resend', method: 'POST' }) }),
    addPhone: build.mutation<Notice, { phone: string }>({ query: body => ({ url: '/v1/auth/phone', method: 'POST', body }) }),
    verifyPhone: build.mutation<Session, { code: string }>({ query: body => ({ url: '/v1/auth/phone/verify', method: 'POST', body }), invalidatesTags: ['Session'] }),
    phones: build.query<{ object: 'list'; data: UserPhone[] }, void>({ query: () => '/v1/auth/phones', providesTags: ['Session'] }),
    addAdditionalPhone: build.mutation<Notice & { phone: string }, { phone: string }>({ query: body => ({ url: '/v1/auth/phones', method: 'POST', body }) }),
    confirmAdditionalPhone: build.mutation<{ object: 'list'; data: UserPhone[] }, { code: string }>({ query: body => ({ url: '/v1/auth/phones/verify', method: 'POST', body }), invalidatesTags: ['Session'] }),
    makePrimaryPhone: build.mutation<{ object: 'list'; data: UserPhone[] }, { phone: string; password?: string }>({ query: body => ({ url: '/v1/auth/phones/primary', method: 'POST', body }), invalidatesTags: ['Session'] }),
    removeAdditionalPhone: build.mutation<{ object: 'list'; data: UserPhone[] }, string>({ query: phone => ({ url: `/v1/auth/phones/${encodeURIComponent(phone)}`, method: 'DELETE' }), invalidatesTags: ['Session'] }),
    forgotPassword: build.mutation<Notice, { email: string }>({ query: body => ({ url: '/v1/auth/password/forgot', method: 'POST', body }) }),
    resetPassword: build.mutation<unknown, { email: string; code: string; password: string }>({ query: body => ({ url: '/v1/auth/password/reset', method: 'POST', body }) }),
    updateProfile: build.mutation<Session, { name: string }>({ query: body => ({ url: '/v1/auth/profile', method: 'PATCH', body }), invalidatesTags: ['Session'] }),
    /** Needs the current password; signs out the person's other sessions. */
    changePassword: build.mutation<Notice, { current_password: string; new_password: string }>({ query: body => ({ url: '/v1/auth/password/change', method: 'POST', body }) }),
    /** Your addresses: the primary one (sign-in and notices) first. */
    emails: build.query<{ object: 'list'; data: UserEmail[] }, void>({ query: () => '/v1/auth/emails', providesTags: ['Email'] }),
    /** Step 1 of adding an address: a code is sent to it. */
    addEmail: build.mutation<Notice, { email: string }>({ query: body => ({ url: '/v1/auth/emails', method: 'POST', body }) }),
    /** Step 2: the code from that address adds it. */
    confirmEmail: build.mutation<{ object: 'list'; data: UserEmail[] }, { code: string }>({ query: body => ({ url: '/v1/auth/emails/verify', method: 'POST', body }), invalidatesTags: ['Email'] }),
    /** Sign in with another confirmed address from now on (the current password when the account has one). */
    makePrimaryEmail: build.mutation<{ object: 'list'; data: UserEmail[] }, { email: string; password?: string }>({
      query: body => ({ url: '/v1/auth/emails/primary', method: 'POST', body }),
      invalidatesTags: ['Email', 'Session'],
    }),
    /** Removes another address; the primary one cannot be removed. */
    removeEmail: build.mutation<{ object: 'list'; data: UserEmail[] }, string>({ query: email => ({ url: `/v1/auth/emails/${encodeURIComponent(email)}`, method: 'DELETE' }), invalidatesTags: ['Email'] }),
    account: build.query<Account, void>({ query: () => '/v1/account', providesTags: ['Account'] }),
    /** Two-step sign-in: settings, setting a method up, the code step when signing in, turning it off. */
    twoStep: build.query<TwoStepSettings, void>({ query: () => '/v1/auth/two-step', providesTags: ['Session'] }),
    startTwoStepSetup: build.mutation<TwoStepSetup, { method: TwoStepMethod; current_code?: string }>({ query: body => ({ url: '/v1/auth/two-step/setup', method: 'POST', body }) }),
    confirmTwoStepSetup: build.mutation<{ object: 'two_step_enabled'; method: TwoStepMethod; recovery_codes: string[] }, { code: string }>({
      query: body => ({ url: '/v1/auth/two-step/setup/confirm', method: 'POST', body }),
    }),
    sendTwoStepCode: build.mutation<TwoStepChallenge, void>({ query: () => ({ url: '/v1/auth/two-step/challenge', method: 'POST' }) }),
    verifyTwoStep: build.mutation<{ object: 'two_step_verified'; method: TwoStepMethod; used: 'code' | 'recovery' }, { code: string }>({
      query: body => ({ url: '/v1/auth/two-step/verify', method: 'POST', body }),
      invalidatesTags: ['Session'],
    }),
    disableTwoStep: build.mutation<{ object: 'two_step_disabled' }, { code: string }>({ query: body => ({ url: '/v1/auth/two-step/disable', method: 'POST', body }), invalidatesTags: ['Session'] }),
    newRecoveryCodes: build.mutation<{ object: 'two_step_recovery_codes'; recovery_codes: string[] }, { code: string }>({
      query: body => ({ url: '/v1/auth/two-step/recovery-codes', method: 'POST', body }),
      invalidatesTags: ['Session'],
    }),
  }),
});

export const {
  useSessionQuery,
  useSignInMutation,
  useSignUpMutation,
  useStartSignupEmailMutation,
  useVerifySignupEmailMutation,
  useCreateResellerAccountMutation,
  useSignOutMutation,
  useVerifyEmailMutation,
  useResendEmailCodeMutation,
  useAddPhoneMutation,
  useVerifyPhoneMutation,
  usePhonesQuery,
  useAddAdditionalPhoneMutation,
  useConfirmAdditionalPhoneMutation,
  useMakePrimaryPhoneMutation,
  useRemoveAdditionalPhoneMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useAccountQuery,
  useUpdateProfileMutation,
  useChangePasswordMutation,
  useEmailsQuery,
  useAddEmailMutation,
  useConfirmEmailMutation,
  useMakePrimaryEmailMutation,
  useRemoveEmailMutation,
  useTwoStepQuery,
  useStartTwoStepSetupMutation,
  useConfirmTwoStepSetupMutation,
  useSendTwoStepCodeMutation,
  useVerifyTwoStepMutation,
  useDisableTwoStepMutation,
  useNewRecoveryCodesMutation,
} = resellerSessionApi;
