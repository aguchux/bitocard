import { bitocardApi } from '../base';
import { apiKeyScopes, webhookEventTypes } from './api-lists.generated';
import { cursorPages, type List, type Mode, type Page, params } from './common';

// Generated from the API, so a new scope or event type reaches SHQ without editing this package.
export { apiKeyScopes, webhookEventTypes };

export type ApiKeyScope = (typeof apiKeyScopes)[number];

export type ApiKey = {
  object: 'api_key';
  id: string;
  name: string;
  mode: Mode;
  /** The first 14 characters of the secret, such as `bc_test_AbCdEf`. */
  prefix: string;
  scopes: ApiKeyScope[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};
/** A new or rolled key: the secret is in this response only. */
export type CreatedApiKey = ApiKey & { secret: string };

export type WebhookEventType = (typeof webhookEventTypes)[number];

export type WebhookEndpoint = {
  object: 'webhook_endpoint';
  id: string;
  mode: Mode;
  url: string;
  description: string | null;
  /** `['*']` means every event type, including types added later. */
  events: Array<WebhookEventType | '*'>;
  status: 'enabled' | 'disabled';
  /** `failing` (3 days of failed deliveries) or `by_reseller`. */
  disabled_reason: string | null;
  disabled_at: string | null;
  /** While set, deliveries are signed with both the old and the new secret. */
  previous_secret_expires_at: string | null;
  created_at: string;
};
export type CreatedWebhookEndpoint = WebhookEndpoint & { secret: string };

export type WebhookDeliveryStatus = 'pending' | 'succeeded' | 'failed';
export type WebhookDeliveryAttempt = {
  success: boolean;
  /** Sent from the resend or test button. */
  manual: boolean;
  response_status: number | null;
  response_body: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
};
export type WebhookDelivery = {
  object: 'webhook_delivery';
  id: string;
  endpoint_id: string;
  event: { id: string; type: string; created_at: string };
  status: WebhookDeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  last_response_status: number | null;
  last_error: string | null;
  created_at: string;
  /** Only on a single delivery: the latest attempts, newest first. */
  log?: WebhookDeliveryAttempt[];
};

/** The event body, exactly as sent to endpoints. */
export type WebhookEvent = {
  id: string;
  object: 'event';
  type: WebhookEventType;
  api_version: string;
  mode: Mode;
  created_at: string;
  data: { object: Record<string, unknown> & { id?: string; object?: string } };
};

/**
 * API keys (dashboard sessions only; each key has its own mode), webhook endpoints and events (in the dashboard's
 * live or sandbox mode, sent by the base query).
 */
export const resellerDevelopersApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    apiKeys: build.query<List<ApiKey>, void>({ query: () => '/v1/api-keys', providesTags: ['ApiKey'] }),
    createApiKey: build.mutation<CreatedApiKey, { name: string; mode: Mode; scopes?: ApiKeyScope[] }>({
      query: body => ({ url: '/v1/api-keys', method: 'POST', body }),
      invalidatesTags: ['ApiKey'],
    }),
    /** A new secret with the same name, mode and scopes; the old key keeps working for `overlap_hours` (0 to 72, default 24). */
    rollApiKey: build.mutation<CreatedApiKey, { id: string; overlap_hours?: number }>({
      query: ({ id, ...body }) => ({ url: `/v1/api-keys/${id}/roll`, method: 'POST', body }),
      invalidatesTags: ['ApiKey'],
    }),
    revokeApiKey: build.mutation<ApiKey, string>({ query: id => ({ url: `/v1/api-keys/${id}`, method: 'DELETE' }), invalidatesTags: ['ApiKey'] }),

    webhookEndpoints: build.query<List<WebhookEndpoint>, void>({
      query: () => '/v1/webhook-endpoints',
      providesTags: result => [{ type: 'WebhookEndpoint', id: 'LIST' }, ...(result?.data.map(item => ({ type: 'WebhookEndpoint' as const, id: item.id })) ?? [])],
    }),
    webhookEndpoint: build.query<WebhookEndpoint, string>({ query: id => `/v1/webhook-endpoints/${id}`, providesTags: (_result, _error, id) => [{ type: 'WebhookEndpoint', id }] }),
    createWebhookEndpoint: build.mutation<CreatedWebhookEndpoint, { url: string; description?: string; events?: Array<WebhookEventType | '*'> }>({
      query: body => ({ url: '/v1/webhook-endpoints', method: 'POST', body }),
      invalidatesTags: [{ type: 'WebhookEndpoint', id: 'LIST' }],
    }),
    updateWebhookEndpoint: build.mutation<WebhookEndpoint, { id: string; url?: string; description?: string; events?: Array<WebhookEventType | '*'>; status?: 'enabled' | 'disabled' }>({
      query: ({ id, ...body }) => ({ url: `/v1/webhook-endpoints/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'WebhookEndpoint', id: 'LIST' }, { type: 'WebhookEndpoint', id }],
    }),
    deleteWebhookEndpoint: build.mutation<{ object: 'webhook_endpoint'; id: string; deleted: true }, string>({
      query: id => ({ url: `/v1/webhook-endpoints/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, id) => [{ type: 'WebhookEndpoint', id: 'LIST' }, { type: 'WebhookEndpoint', id }],
    }),
    /** The old secret keeps signing alongside the new one for `expire_previous_in_hours` (0 to 168, default 24). */
    rotateWebhookSecret: build.mutation<CreatedWebhookEndpoint, { id: string; expire_previous_in_hours?: number }>({
      query: ({ id, ...body }) => ({ url: `/v1/webhook-endpoints/${id}/rotate-secret`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'WebhookEndpoint', id: 'LIST' }, { type: 'WebhookEndpoint', id }],
    }),
    /** Sends a `ping` now and returns the delivery with its result (never retried). */
    sendWebhookTest: build.mutation<WebhookDelivery, string>({
      query: id => ({ url: `/v1/webhook-endpoints/${id}/test`, method: 'POST' }),
      invalidatesTags: (_result, _error, id) => [{ type: 'WebhookEndpoint', id: `deliveries:${id}` }],
    }),
    webhookDeliveries: build.infiniteQuery<List<WebhookDelivery>, { endpoint: string; status?: WebhookDeliveryStatus } & Pick<Page, 'limit'>, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ queryArg: { endpoint, ...filter }, pageParam }) => ({
        url: `/v1/webhook-endpoints/${endpoint}/deliveries`,
        params: params({ ...filter, limit: filter.limit ?? 25, starting_after: pageParam }),
      }),
      providesTags: (_result, _error, { endpoint }) => [{ type: 'WebhookEndpoint', id: `deliveries:${endpoint}` }],
    }),
    webhookDelivery: build.query<WebhookDelivery, { endpoint: string; delivery: string }>({
      query: ({ endpoint, delivery }) => `/v1/webhook-endpoints/${endpoint}/deliveries/${delivery}`,
      providesTags: (_result, _error, { delivery }) => [{ type: 'WebhookEndpoint', id: `delivery:${delivery}` }],
    }),
    /** Sends the same event again now, whatever its status, and returns the delivery with the new attempt. */
    resendWebhookDelivery: build.mutation<WebhookDelivery, { endpoint: string; delivery: string }>({
      query: ({ endpoint, delivery }) => ({ url: `/v1/webhook-endpoints/${endpoint}/deliveries/${delivery}/resend`, method: 'POST' }),
      invalidatesTags: (_result, _error, { endpoint, delivery }) => [
        { type: 'WebhookEndpoint', id: `deliveries:${endpoint}` },
        { type: 'WebhookEndpoint', id: `delivery:${delivery}` },
      ],
    }),

    /**
     * Events from the last 30 days, oldest first. `since` is an event ID or an ISO 8601 time; each next page starts
     * after the last event of the previous one.
     */
    events: build.infiniteQuery<List<WebhookEvent>, { since?: string; type?: WebhookEventType; limit?: number }, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ queryArg, pageParam }) => ({ url: '/v1/events', params: params({ ...queryArg, limit: queryArg.limit ?? 50, since: pageParam || queryArg.since }) }),
      providesTags: ['Event'],
    }),
    event: build.query<WebhookEvent, string>({ query: id => `/v1/events/${id}`, providesTags: (_result, _error, id) => [{ type: 'Event', id }] }),
  }),
});

export const {
  useApiKeysQuery,
  useCreateApiKeyMutation,
  useRollApiKeyMutation,
  useRevokeApiKeyMutation,
  useWebhookEndpointsQuery,
  useWebhookEndpointQuery,
  useCreateWebhookEndpointMutation,
  useUpdateWebhookEndpointMutation,
  useDeleteWebhookEndpointMutation,
  useRotateWebhookSecretMutation,
  useSendWebhookTestMutation,
  useWebhookDeliveriesInfiniteQuery,
  useWebhookDeliveryQuery,
  useResendWebhookDeliveryMutation,
  useEventsInfiniteQuery,
  useEventQuery,
} = resellerDevelopersApi;
