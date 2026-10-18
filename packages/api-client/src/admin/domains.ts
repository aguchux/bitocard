import { bitocardApi } from '../base';
import type { StoreDomain } from '../reseller/domains';

/** Admin view of every store domain: who owns it, which store, and BitoCard's cost. */
export type AdminStoreDomain = StoreDomain & { reseller: { id: string; name: string }; store: { id: string; name: string; subdomain: string }; cost: { amount: number; currency: 'USD' } | null };

export const adminDomainsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    adminDomains: build.query<{ object: 'list'; data: AdminStoreDomain[] }, { status?: string; q?: string }>({
      query: ({ status, q }) => {
        const params = new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}) }).toString();
        return `/v1/admin/domains${params ? `?${params}` : ''}`;
      },
      providesTags: ['Domain'],
    }),
    /** Operations: the store stops being served on the domain (abuse, disputes). Audited with the reason. */
    suspendDomain: build.mutation<StoreDomain, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/domains/${id}/suspend`, method: 'POST', body: { reason } }),
      invalidatesTags: ['Domain', 'Activity'],
    }),
    reinstateDomain: build.mutation<StoreDomain, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/domains/${id}/reinstate`, method: 'POST', body: { reason } }),
      invalidatesTags: ['Domain', 'Activity'],
    }),
  }),
});

export const { useAdminDomainsQuery, useSuspendDomainMutation, useReinstateDomainMutation } = adminDomainsApi;
