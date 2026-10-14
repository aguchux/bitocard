import { bitocardApi } from '../base';
import { type KycDecision, type KycKind, type KycReviewCase, type KycReviewer, type KycStatus, type KycSubject, kycDecisionBody } from '../kyc';
import type { List } from './types';

export * from '../kyc';

/** `status` defaults to `submitted` on the API; `all` lists every status. */
export type AdminKycCaseFilter = { status?: KycStatus | 'all'; subject?: KycSubject; kind?: KycKind; reviewer?: KycReviewer; country?: string; reseller_id?: string };

/** Drops empty values so query strings stay clean. */
const params = (values: Record<string, string | number | undefined | null>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''));

/**
 * BitoCard Verify cases for admins: every case, including those a registered reseller decided (admins may override).
 * A decision changes the case, the identity check it settles and, for resellers, the reseller.
 */
export const adminKycApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    adminKycCases: build.infiniteQuery<List<KycReviewCase>, AdminKycCaseFilter, string>({
      infiniteQueryOptions: {
        initialPageParam: '',
        getNextPageParam: (last: { data: Array<{ id: string }>; has_more?: boolean }) => (last.has_more ? last.data.at(-1)?.id : undefined),
      },
      query: ({ queryArg, pageParam }) => ({ url: '/v1/admin/kyc/cases', params: params({ ...queryArg, limit: 50, starting_after: pageParam }) }),
      providesTags: [{ type: 'Verification', id: 'KYC' }],
    }),
    adminKycCase: build.query<KycReviewCase, string>({
      query: id => `/v1/admin/kyc/cases/${encodeURIComponent(id)}`,
      providesTags: (_result, _error, id) => [{ type: 'Verification', id: `KYC:${id}` }],
    }),
    decideAdminKycCase: build.mutation<KycReviewCase, { id: string; decision: KycDecision }>({
      query: ({ id, decision }) => ({ url: `/v1/admin/kyc/cases/${encodeURIComponent(id)}/${decision.action}`, method: 'POST', body: kycDecisionBody(decision) }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Verification', id: `KYC:${id}` },
        { type: 'Verification', id: 'KYC' },
        { type: 'Verification', id: 'LIST' },
        { type: 'Reseller', id: 'LIST' },
        'Reseller',
        'StoreCustomer',
        'Overview',
        'Activity',
      ],
    }),
  }),
});

export const { useAdminKycCasesInfiniteQuery, useAdminKycCaseQuery, useDecideAdminKycCaseMutation } = adminKycApi;
