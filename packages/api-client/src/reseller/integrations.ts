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
  created_at: string;
  updated_at: string;
};

export type ResellerIntegration = {
  object: 'integration';
  id: string;
  kind: IntegrationKind;
  name: string;
  description: string;
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
    disconnectIntegration: build.mutation<void, string>({
      query: id => ({ url: `/v1/integrations/${id}/connection`, method: 'DELETE' }),
      invalidatesTags: ['ResellerIntegration'],
    }),
  }),
});

export const {
  useResellerIntegrationsQuery,
  useConnectIntegrationMutation,
  useCheckIntegrationMutation,
  useDisconnectIntegrationMutation,
  useSyncIntegrationMutation,
  useSetIntegrationRoutingMutation,
} = resellerIntegrationsApi;
