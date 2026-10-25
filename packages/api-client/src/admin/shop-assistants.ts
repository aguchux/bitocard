import { bitocardApi } from '../base';
import type { ShopAssistantCard, ShopAssistantSurface } from '../classifieds';
import type { List } from './types';

/** BitoCard Shop's assistants for admins: countries and the default, who answers where, knowledge per country, review and evals. */

export type ShopCoverageRow = { country: string; country_name: string; open: boolean; language: string | null; language_name: string | null; assistant: { id: string; name: string; default: boolean } | null };

export type ShopKnowledgeSectionKey = 'shop' | 'categories' | 'posting' | 'safe_pay' | 'safe_trade' | 'prohibited' | 'badges' | 'contact';
export type ShopCountryKnowledge = {
  country: string;
  served: boolean;
  version: number | null;
  generated_at: string | null;
  stale: boolean;
  content: string | null;
  sections: Array<{ key: ShopKnowledgeSectionKey; title: string; state: 'unchanged' | 'changed' | 'added'; added: number; removed: number }>;
};

export type AssistantThreadRow = { id: string; country: string; language: string; surface: ShopAssistantSurface; signed_in: boolean; first_question: string | null; messages: number; up: number; down: number; reported: number; last_message_at: string };
export type AssistantThreadDetail = {
  object: 'assistant_thread';
  id: string;
  country: string;
  language: string;
  surface: ShopAssistantSurface;
  signed_in: boolean;
  listing_id: string | null;
  created_at: string;
  messages: Array<{ id: string; role: 'user' | 'assistant'; body: string; cards: ShopAssistantCard[]; tool_calls: Array<{ name: string; arguments: Record<string, unknown> }>; rating: 1 | -1 | null; reported_at: string | null; report_reason: string | null; cost_usd: number; created_at: string }>;
};

export type ShopEvalResult = { id: string; kind: 'buyer' | 'red_team'; ask: string; passed: boolean; reason: string | null; tools: string[]; answer: string };
export type ShopEvalRun = { id: string; provider: string; model: string; cases: number; passed: number; results: ShopEvalResult[]; created_at: string; country?: string };

const bot = (id: string) => [{ type: 'SupportBot' as const, id }, { type: 'SupportBot' as const, id: 'LIST' }, { type: 'SupportBot' as const, id: 'COVERAGE' }];

export const shopAssistantsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    shopCoverage: build.query<{ object: 'list'; data: ShopCoverageRow[] }, void>({ query: () => '/v1/admin/support/shop-coverage', providesTags: [{ type: 'SupportBot', id: 'COVERAGE' }] }),
    assignShopBot: build.mutation<{ assignments: Array<{ country: string; language: string | null; active: boolean }> }, { id: string; assignments: Array<{ country: string; language: string | null }> }>({
      query: ({ id, assignments }) => ({ url: `/v1/admin/support/bots/${id}/assignments`, method: 'PUT', body: { assignments } }),
      invalidatesTags: (_result, _error, { id }) => [...bot(id), { type: 'SupportBot', id: `SK-${id}` }],
    }),
    makeShopBotDefault: build.mutation<{ id: string }, string>({ query: id => ({ url: `/v1/admin/support/bots/${id}/make-default`, method: 'POST' }), invalidatesTags: (_result, _error, id) => bot(id) }),
    shopBotKnowledge: build.query<{ object: 'list'; data: ShopCountryKnowledge[] }, string>({ query: id => `/v1/admin/support/bots/${id}/shop-knowledge`, providesTags: (_result, _error, id) => [{ type: 'SupportBot', id: `SK-${id}` }] }),
    refreshShopBotKnowledge: build.mutation<{ refreshed: Array<{ country: string; version: number }> }, { id: string; countries?: string[] }>({
      query: ({ id, countries }) => ({ url: `/v1/admin/support/bots/${id}/shop-knowledge/refresh`, method: 'POST', body: countries ? { countries } : {} }),
      invalidatesTags: (_result, _error, { id }) => [...bot(id), { type: 'SupportBot', id: `SK-${id}` }],
    }),
    assistantThreads: build.query<List<AssistantThreadRow>, { id: string; rating?: 'up' | 'down'; reported?: boolean; starting_after?: string }>({
      query: ({ id, ...filter }) => {
        const params = new URLSearchParams(Object.entries(filter).flatMap(([key, value]) => (value === undefined || value === false ? [] : [[key, String(value)]])));
        return `/v1/admin/support/bots/${id}/threads${params.size ? `?${params}` : ''}`;
      },
      providesTags: (_result, _error, { id }) => [{ type: 'SupportBot', id: `T-${id}` }],
    }),
    assistantThread: build.query<AssistantThreadDetail, { id: string; thread: string }>({ query: ({ id, thread }) => `/v1/admin/support/bots/${id}/threads/${thread}` }),
    shopBotEvals: build.query<{ object: 'list'; data: ShopEvalRun[] }, string>({ query: id => `/v1/admin/support/bots/${id}/evals`, providesTags: (_result, _error, id) => [{ type: 'SupportBot', id: `E-${id}` }] }),
    runShopBotEvals: build.mutation<ShopEvalRun, { id: string; country?: string }>({
      query: ({ id, country }) => ({ url: `/v1/admin/support/bots/${id}/evals/run`, method: 'POST', body: country ? { country } : {}, timeout: 300_000 }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'SupportBot', id: `E-${id}` }, { type: 'SupportBot', id }],
    }),
  }),
});

export const {
  useShopCoverageQuery,
  useAssignShopBotMutation,
  useMakeShopBotDefaultMutation,
  useShopBotKnowledgeQuery,
  useRefreshShopBotKnowledgeMutation,
  useAssistantThreadsQuery,
  useAssistantThreadQuery,
  useShopBotEvalsQuery,
  useRunShopBotEvalsMutation,
} = shopAssistantsApi;
