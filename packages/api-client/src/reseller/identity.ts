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
};

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
    /** Owner only, and only with consent (the face check is biometric). Send the browser to the returned `url`. */
    startAccountVerification: build.mutation<Verification, { consent: true }>({
      query: body => ({ url: '/v1/account/verification', method: 'POST', body }),
      invalidatesTags: ['IdentityCheck'],
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

export const { useAccountVerificationQuery, useStartAccountVerificationMutation, useBvnCheckQuery, useStartBvnCheckMutation } = resellerIdentityApi;
