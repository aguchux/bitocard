import { bitocardApi } from '../base';
import type { List } from './types';

export type ConnectableKind = 'supplier' | 'payment_gateway';
export type IntegrationApproval = 'automatic' | 'review';
export type ConnectionStatus = 'pending_review' | 'active' | 'rejected' | 'suspended' | 'disconnected';
export type ConnectionDecision = 'approve' | 'reject' | 'suspend' | 'reinstate';

/** Where resellers may connect their own account to an integration, and how many do. */
export type IntegrationOffer = {
  object: 'integration_offer';
  integration_id: string;
  kind: ConnectableKind;
  name: string;
  offered: boolean;
  global: boolean;
  countries: string[];
  approval: IntegrationApproval;
  connections: { active: number; pending_review: number; suspended: number };
  updated_at: string | null;
};

/** A reseller's own connection, as admins see it: never a secret, only non-secret values such as a contract code. */
export type AdminConnection = {
  object: 'connection';
  id: string;
  mode: 'live' | 'test';
  status: ConnectionStatus;
  decision_note: string | null;
  last_check: { checked_at: string; ok: boolean | null; message: string | null } | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  integration: { id: string; name: string; kind: ConnectableKind | null };
  public_values: Record<string, string>;
  reseller: { id: string; name: string; country: string | null };
};

/** Resellers' own integrations: availability per integration and country, and the connections to review. */
export const adminResellerIntegrationsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    integrationOffers: build.query<List<IntegrationOffer>, void>({ query: () => '/v1/admin/integrations/reseller-availability', providesTags: ['IntegrationOffer'] }),
    /** Super admins: offered globally or in these countries, with automatic approval or review. */
    setIntegrationOffer: build.mutation<IntegrationOffer, { id: string; global: boolean; countries: string[]; approval: IntegrationApproval }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/integrations/${id}/reseller-availability`, method: 'PUT', body }),
      invalidatesTags: ['IntegrationOffer', 'Activity'],
    }),
    connections: build.query<List<AdminConnection>, { status?: ConnectionStatus; mode?: 'live' | 'test' }>({
      query: params => ({ url: '/v1/admin/connections', params }),
      providesTags: ['Connection'],
    }),
    /** Operations: reject and suspend need a reason (the reseller sees it). */
    decideConnection: build.mutation<AdminConnection, { id: string; decision: ConnectionDecision; reason?: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/connections/${id}/decide`, method: 'POST', body }),
      invalidatesTags: ['Connection', 'IntegrationOffer', 'Activity'],
    }),
  }),
});

export const { useIntegrationOffersQuery, useSetIntegrationOfferMutation, useConnectionsQuery, useDecideConnectionMutation } = adminResellerIntegrationsApi;
