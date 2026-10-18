import { bitocardApi } from '../base';
import type { List } from './common';

/** A store's own domain (`/v1/stores/:store/domains`), as the API presents it. */
export type DomainRecordHint = { type: string; name: string; value: string };
export type MailProvider = 'google' | 'microsoft' | 'zoho';
export type StoreDomain = {
  object: 'store_domain';
  id: string;
  name: string;
  url: string;
  source: 'purchased' | 'connected';
  status: 'purchasing' | 'pending' | 'active' | 'failed' | 'expired' | 'suspended' | 'removed';
  /** `vercel`: BitoCard's DNS (records editable here); `external`: the reseller's own DNS host. */
  dns_mode: 'vercel' | 'external';
  primary: boolean;
  verified: boolean;
  configured: boolean;
  /** What to set at the DNS host while it is not connected. */
  instructions: DomainRecordHint[];
  /** Nameservers to move to, for DNS managed here (connected domains). */
  nameservers: string[] | null;
  expires_at: string | null;
  auto_renew: boolean | null;
  price: { amount: number; currency: 'USD' } | null;
  renewal_error: string | null;
  mail_provider: MailProvider | null;
  email_sending: { status: string; from: string; records: Array<DomainRecordHint & { priority: number | null; status: string | null }> } | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
};
export type StoreDomains = List<StoreDomain> & { buying: { available: boolean; tlds: string[] }; max_domains: number };
export type DomainOffer = { object: 'domain_offer'; domain: string; available: boolean; price: { amount: number; currency: 'USD' } | null; renewal_price: { amount: number; currency: 'USD' } | null };
export type DomainContact = { first_name: string; last_name: string; email: string; phone: string; address1: string; address2?: string; city: string; state: string; zip: string; country: string; company_name?: string };
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'CAA';
export type DnsRecord = { object: 'dns_record'; id: string; name: string; type: string; value: string; ttl: number | null; priority: number | null; protected: boolean };
export type DnsRecordInput = { name: string; type: DnsRecordType; value: string; ttl?: number; priority?: number };
export type DnsImport = { object: 'dns_import'; domain: string; records: Array<{ name: string; type: DnsRecordType; value: string; ttl: number; priority: number | null }>; nameservers: string[] };
export type MailSetup = { object: 'mail_setup'; domain: string; provider: MailProvider | null; provider_name: string | null; written: boolean; records: Array<DomainRecordHint & { priority: number | null }> };

type Ref = { store: string; id: string };
const base = (store: string) => `/v1/stores/${store}/domains`;

export const resellerDomainsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    storeDomains: build.query<StoreDomains, string>({ query: store => base(store), providesTags: ['Domain'] }),
    searchDomains: build.query<List<DomainOffer>, { store: string; q: string }>({ query: ({ store, q }) => `${base(store)}/search?q=${encodeURIComponent(q)}`, keepUnusedDataFor: 30 }),
    buyDomain: build.mutation<StoreDomain, { store: string; domain: string; expected_price: number; contact: DomainContact }>({
      query: ({ store, ...body }) => ({ url: `${base(store)}/purchase`, method: 'POST', body }),
      invalidatesTags: ['Domain', 'Wallet', 'Store'],
    }),
    connectDomain: build.mutation<StoreDomain, { store: string; domain: string }>({ query: ({ store, domain }) => ({ url: base(store), method: 'POST', body: { domain } }), invalidatesTags: ['Domain'] }),
    checkDomain: build.mutation<StoreDomain, Ref>({ query: ({ store, id }) => ({ url: `${base(store)}/${id}/check`, method: 'POST' }), invalidatesTags: ['Domain', 'Store'] }),
    updateDomain: build.mutation<StoreDomain, Ref & { primary?: boolean; auto_renew?: boolean }>({
      query: ({ store, id, ...body }) => ({ url: `${base(store)}/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Domain', 'Store'],
    }),
    removeDomain: build.mutation<{ object: 'store_domain'; id: string; deleted: true }, Ref>({ query: ({ store, id }) => ({ url: `${base(store)}/${id}`, method: 'DELETE' }), invalidatesTags: ['Domain', 'Store'] }),
    renewDomain: build.mutation<StoreDomain, Ref>({ query: ({ store, id }) => ({ url: `${base(store)}/${id}/renew`, method: 'POST' }), invalidatesTags: ['Domain', 'Wallet'] }),
    domainTransferCode: build.mutation<{ object: 'domain_transfer_code'; domain: string; code: string }, Ref>({ query: ({ store, id }) => ({ url: `${base(store)}/${id}/transfer-code`, method: 'POST' }) }),
    domainRecords: build.query<List<DnsRecord>, Ref>({ query: ({ store, id }) => `${base(store)}/${id}/records`, providesTags: (_result, _error, { id }) => [{ type: 'Domain', id }] }),
    addDomainRecord: build.mutation<DnsRecord, Ref & DnsRecordInput>({
      query: ({ store, id, ...body }) => ({ url: `${base(store)}/${id}/records`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Domain', id }],
    }),
    deleteDomainRecord: build.mutation<{ object: 'dns_record'; id: string; deleted: true }, Ref & { record: string }>({
      query: ({ store, id, record }) => ({ url: `${base(store)}/${id}/records/${encodeURIComponent(record)}`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Domain', id }],
    }),
    domainImportPreview: build.query<DnsImport, Ref>({ query: ({ store, id }) => `${base(store)}/${id}/dns-import`, keepUnusedDataFor: 30 }),
    importDomainRecords: build.mutation<{ object: 'dns_import'; domain: string; created: number; nameservers: string[] }, Ref & { records: DnsRecordInput[] }>({
      query: ({ store, id, records }) => ({ url: `${base(store)}/${id}/dns-import`, method: 'POST', body: { records } }),
      invalidatesTags: ['Domain'],
    }),
    setMailProvider: build.mutation<MailSetup, Ref & { provider: MailProvider | null; verification?: string }>({
      query: ({ store, id, ...body }) => ({ url: `${base(store)}/${id}/mail-provider`, method: 'PUT', body }),
      invalidatesTags: (_result, _error, { id }) => ['Domain', { type: 'Domain', id }],
    }),
    enableEmailSending: build.mutation<StoreDomain, Ref>({
      query: ({ store, id }) => ({ url: `${base(store)}/${id}/email-sending`, method: 'POST' }),
      invalidatesTags: (_result, _error, { id }) => ['Domain', { type: 'Domain', id }],
    }),
  }),
});

export const {
  useStoreDomainsQuery,
  useLazySearchDomainsQuery,
  useBuyDomainMutation,
  useConnectDomainMutation,
  useCheckDomainMutation,
  useUpdateDomainMutation,
  useRemoveDomainMutation,
  useRenewDomainMutation,
  useDomainTransferCodeMutation,
  useDomainRecordsQuery,
  useAddDomainRecordMutation,
  useDeleteDomainRecordMutation,
  useLazyDomainImportPreviewQuery,
  useImportDomainRecordsMutation,
  useSetMailProviderMutation,
  useEnableEmailSendingMutation,
} = resellerDomainsApi;
