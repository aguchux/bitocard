import { bitocardApi } from '../base';

export type IntegrationKind = 'supplier' | 'payment_gateway';
export type ConnectionStatus = 'pending_review' | 'active' | 'rejected' | 'suspended' | 'disconnected';
/** Why the account cannot connect its own integrations yet. */
export type IntegrationAccessReason = 'switch_off' | 'plan' | 'not_verified' | 'no_country' | null;

export type IntegrationField = {
  key: string;
  label: string;
  /** Write-only: never returned; `hint` shows its last four characters once set. */
  secret: boolean;
  required: boolean;
  help: string | null;
  value: string | null;
  hint: string | null;
};

export type ResellerConnection = {
  object: 'connection';
  id: string;
  mode: 'live' | 'test';
  status: ConnectionStatus;
  /** Suppliers: used before BitoCard's (`preferred`), only when BitoCard has no offer (`fallback`), or never (`off`). */
  routing: 'preferred' | 'fallback' | 'off';
  catalogue: { synced_at: string | null; error: string | null };
  /** Why BitoCard rejected or suspended it. */
  decision_note: string | null;
  last_check: { checked_at: string; ok: boolean | null; message: string | null } | null;
  /**
   * Live suppliers that send order updates: this connection's own address. `manual`: enter it in the supplier's
   * dashboard and save the signature secret (`ready` once saved); `automatic`: BitoCard gives it on every order.
   */
  notifications: { url: string; setup: 'manual' | 'automatic'; ready: boolean } | null;
  created_at: string;
  updated_at: string;
};

/** An order update your own supplier account sent, and what became of it. */
export type SupplierNotification = {
  object: 'supplier_webhook';
  id: string;
  event_type: string | null;
  reference: string | null;
  supplier_transaction_id: string | null;
  order_id: string | null;
  status: 'received' | 'processed' | 'unmatched' | 'failed';
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  received_at: string;
  processed_at: string | null;
};

export type ResellerIntegration = {
  object: 'integration';
  id: string;
  kind: IntegrationKind;
  name: string;
  description: string;
  /** Where to sign up with the provider and find your credentials. */
  links: Array<{ label: string; url: string }>;
  /** Live connections are active at once, or reviewed by BitoCard first. */
  approval: 'automatic' | 'review';
  fields: IntegrationField[];
  /** In the current mode; null when not connected. */
  connection: ResellerConnection | null;
};

export type ResellerIntegrationList = { object: 'list'; access: { allowed: boolean; reason: IntegrationAccessReason }; data: ResellerIntegration[] };

/** Your own supplier and payment gateway accounts (`/v1/integrations`), per mode. */
export const resellerIntegrationsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    resellerIntegrations: build.query<ResellerIntegrationList, void>({ query: () => '/v1/integrations', providesTags: ['ResellerIntegration'] }),
    /** Saves credentials (blank secrets keep the saved ones); live ones are checked with the provider first. */
    connectIntegration: build.mutation<ResellerIntegration, { id: string; values: Record<string, string> }>({
      query: ({ id, values }) => ({ url: `/v1/integrations/${id}/connection`, method: 'PUT', body: { values } }),
      invalidatesTags: ['ResellerIntegration'],
    }),
    checkIntegration: build.mutation<ResellerIntegration, string>({
      query: id => ({ url: `/v1/integrations/${id}/connection/check`, method: 'POST' }),
      invalidatesTags: ['ResellerIntegration'],
    }),
    /** Fetches your supplier's catalogue and prices (simulated in the sandbox). */
    syncIntegration: build.mutation<{ object: 'own_catalogue_sync'; offers: number; withdrawn: number }, string>({
      query: id => ({ url: `/v1/integrations/${id}/connection/sync`, method: 'POST' }),
      invalidatesTags: ['ResellerIntegration', 'Catalogue'],
    }),
    setIntegrationRouting: build.mutation<void, { id: string; routing: 'preferred' | 'fallback' | 'off' }>({
      query: ({ id, routing }) => ({ url: `/v1/integrations/${id}/connection/routing`, method: 'PUT', body: { routing } }),
      invalidatesTags: ['ResellerIntegration', 'Catalogue'],
    }),
    /** What your own live supplier account notified (newest first). */
    integrationNotifications: build.infiniteQuery<{ object: 'list'; data: SupplierNotification[]; has_more: boolean }, string, string>({
      infiniteQueryOptions: { initialPageParam: '', getNextPageParam: last => (last.has_more ? last.data.at(-1)?.id : undefined) },
      query: ({ queryArg: id, pageParam }) => ({ url: `/v1/integrations/${id}/connection/notifications`, params: pageParam ? { starting_after: pageParam } : {} }),
      providesTags: ['SupplierNotification'],
    }),
    disconnectIntegration: build.mutation<void, string>({
      query: id => ({ url: `/v1/integrations/${id}/connection`, method: 'DELETE' }),
      invalidatesTags: ['ResellerIntegration'],
    }),
  }),
});

export const {
  useIntegrationNotificationsInfiniteQuery,
  useResellerIntegrationsQuery,
  useConnectIntegrationMutation,
  useCheckIntegrationMutation,
  useDisconnectIntegrationMutation,
  useSyncIntegrationMutation,
  useSetIntegrationRoutingMutation,
} = resellerIntegrationsApi;
