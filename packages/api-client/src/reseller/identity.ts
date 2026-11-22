import { bitocardApi } from '../base';
import type { ResellerStatus } from './common';

export type IdentityCheckStatus = 'not_started' | 'in_progress' | 'in_review' | 'approved' | 'declined' | 'expired';
/** The business owner's identity check (`/v1/account/verification`). */
export type Verification = {
  object: 'reseller_verification';
  reseller_status: ResellerStatus;
  verified: boolean;
  verified_at: string | null;
  status: IdentityCheckStatus;
  /** The identity provider's page, while the check is in progress. */
  url: string | null;
  /** `not_verified`, `name_mismatch`, `bvn_consent_declined` or `expired`. */
  reason: string | null;
  started_at: string | null;
  /** Who runs the check: BitoCard Verify (verify.bitocard.com, in African countries) or Didit elsewhere. Missing on older API versions. */
  provider?: 'bitocard' | 'didit';
  /** `kyb` in BitoCard Verify countries: the business is checked too (registered businesses send their documents). */
  kind?: 'kyc' | 'kyb';
  /** Chosen in BitoCard Verify; null until then. */
  business_type?: 'unregistered' | 'registered' | null;
  /** A registered business whose documents BitoCard has approved: it can review its own customers' ID checks. */
  kyb_verified?: boolean;
  /** How the reseller sells: as an individual (the owner's identity) or a business (also KYB of the registered business). */
  account_type?: AccountType;
  /** A live account switched to business, paused until its business passes KYB. */
  paused_for_kyb?: boolean;
  /** A business account's own KYB after the owner's identity was approved (the business and its documents only). */
  business_check?: { status: IdentityCheckStatus; reason: string | null; started_at: string; decided_at: string | null } | null;
  /** Where to continue the business check, right after starting it. */
  business_url?: string | null;
};

export type AccountType = 'individual' | 'business';

/** The reseller's business profile (`/v1/reseller/profile`, SHQ sessions). Never checked; the KYB-verified details are `verified_business`. */
export type BusinessProfile = {
  object: 'business_profile';
  account_type: AccountType;
  name: string;
  country: string | null;
  status: ResellerStatus;
  legal_name: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  /** A contact number, never confirmed. */
  phone: string | null;
  description: string | null;
  owner_verified: boolean;
  business_verified: boolean;
  verified_business: { registered_name: string | null; registration_number: string | null; business_address: string | null; verified_at: string } | null;
  paused_for_kyb: boolean;
};
export type BusinessProfileInput = Partial<Pick<BusinessProfile, 'legal_name' | 'address_line' | 'city' | 'state' | 'postal_code' | 'phone' | 'description'>>;

/** Nigeria: the owner's BVN check, needed before live reserved bank accounts (`/v1/account/bvn`). The BVN is never returned. */
export type BvnCheck = {
  object: 'bvn_check';
  verified: boolean;
  verified_at: string | null;
  status: IdentityCheckStatus;
  /** Flutterwave's consent page, while the check is in progress. */
  url: string | null;
  /** `name_mismatch`, `bvn_consent_declined`, `not_verified` or `expired`. */
  reason: string | null;
  started_at: string | null;
};

export const resellerIdentityApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    accountVerification: build.query<Verification, void>({ query: () => '/v1/account/verification', providesTags: ['IdentityCheck'] }),
    /**
     * Owner only, and only with consent (the face check is biometric). Send the browser to the returned `url`.
     * `restart` closes an unfinished check and starts a new one from scratch.
     */
    startAccountVerification: build.mutation<Verification, { consent: true; restart?: boolean }>({
      query: body => ({ url: '/v1/account/verification', method: 'POST', body }),
      invalidatesTags: ['IdentityCheck'],
    }),
    /** Owner only: a business account's KYB once the owner's identity is approved. Send the browser to `business_url`. */
    startBusinessCheck: build.mutation<Verification, { consent: true; restart?: boolean }>({
      query: body => ({ url: '/v1/account/verification/business', method: 'POST', body }),
      invalidatesTags: ['IdentityCheck'],
    }),
    businessProfile: build.query<BusinessProfile, void>({ query: () => '/v1/reseller/profile', providesTags: ['IdentityCheck'] }),
    /** Owners and admins. An empty string clears a field. */
    updateBusinessProfile: build.mutation<BusinessProfile, { [K in keyof BusinessProfileInput]: string }>({
      query: body => ({ url: '/v1/reseller/profile', method: 'PATCH', body }),
      invalidatesTags: ['IdentityCheck'],
    }),
    /** Owner only. A live account switching to business is paused until its business passes KYB. */
    setAccountType: build.mutation<BusinessProfile, AccountType>({
      query: account_type => ({ url: '/v1/reseller/account-type', method: 'PUT', body: { account_type } }),
      invalidatesTags: ['IdentityCheck', 'Session', 'Account'],
    }),
    /** Re-reads an unfinished check from Flutterwave. */
    bvnCheck: build.query<BvnCheck, void>({ query: () => '/v1/account/bvn', providesTags: ['IdentityCheck'] }),
    /** Owner only, after the identity check. Send the browser to the returned `url`. */
    startBvnCheck: build.mutation<BvnCheck, { bvn: string; consent: true }>({
      query: body => ({ url: '/v1/account/bvn', method: 'POST', body }),
      invalidatesTags: ['IdentityCheck'],
    }),
  }),
});

export const {
  useAccountVerificationQuery,
  useStartAccountVerificationMutation,
  useBvnCheckQuery,
  useStartBvnCheckMutation,
  useStartBusinessCheckMutation,
  useBusinessProfileQuery,
  useUpdateBusinessProfileMutation,
  useSetAccountTypeMutation,
} = resellerIdentityApi;
