import { bitocardApi } from './base';

/** Where the bots live: SHQ (`/v1/support/bots`, the reseller's) or admin (`/v1/admin/support/bots`, BitoCard's, and every one to suspend). */
export type BotsBase = '/v1/support/bots' | '/v1/admin/support/bots';
export type BotRole = 'chat' | 'tickets';
export type BotTone = 'friendly' | 'formal' | 'brief';
export type BotProvider = 'anthropic' | 'openai' | 'deepseek';
export type ManagedSectionKey = 'store' | 'catalogue' | 'buying' | 'delivery' | 'refunds' | 'accounts';

export type SupportBot = {
  object: 'support_bot';
  id: string;
  scope: 'store' | 'platform';
  store_id: string | null;
  store_name: string | null;
  roles: BotRole[];
  ticket_reply_mode: 'auto' | 'draft';
  provider: BotProvider;
  model: string;
  funding: 'bitocard' | 'own';
  name: string;
  avatar_url: string | null;
  greeting: string | null;
  tone: BotTone;
  instructions: string | null;
  status: 'draft' | 'active' | 'paused' | 'suspended';
  suspended_reason: string | null;
  auto_refresh: boolean;
  knowledge: { id: string; version: number; source: string; chars: number; created_at: string } | null;
  knowledge_stale_at: string | null;
  created_at: string;
  updated_at: string;
  reseller_id?: string;
};

export type BotInput = Partial<Pick<SupportBot, 'name' | 'roles' | 'provider' | 'model' | 'funding' | 'store_id' | 'greeting' | 'tone' | 'instructions' | 'ticket_reply_mode' | 'avatar_url' | 'auto_refresh'>> & { scope?: 'store' | 'platform' };

export type BotKnowledge = {
  object: 'support_bot_knowledge';
  current: { version: number; source: string; format: string; chars: number; content: string; created_at: string } | null;
  versions: Array<{ version: number; source: string; chars: number; created_at: string; current: boolean }>;
  stale_since: string | null;
  max_chars: number;
};

export type SectionChange = { key: ManagedSectionKey; title: string; state: 'unchanged' | 'changed' | 'added' | 'edited'; current: string | null; fresh: string; added: number; removed: number };

const one = (id: string) => [{ type: 'SupportBot' as const, id }, { type: 'SupportBot' as const, id: 'LIST' }];
const knowledgeTag = (id: string) => ({ type: 'SupportBot' as const, id: `K-${id}` });

/** Support assistants, for SHQ and the admin app alike (each passes its base path). */
export const supportBotsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    supportBots: build.query<{ object: 'list'; data: SupportBot[] }, BotsBase>({ query: base => base, providesTags: [{ type: 'SupportBot', id: 'LIST' }] }),
    supportBot: build.query<SupportBot, { base: BotsBase; id: string }>({ query: ({ base, id }) => `${base}/${id}`, providesTags: (_result, _error, { id }) => [{ type: 'SupportBot', id }] }),
    createSupportBot: build.mutation<SupportBot, { base: BotsBase; body: BotInput }>({
      query: ({ base, body }) => ({ url: base, method: 'POST', body }),
      invalidatesTags: [{ type: 'SupportBot', id: 'LIST' }],
    }),
    updateSupportBot: build.mutation<SupportBot, { base: BotsBase; id: string; body: BotInput }>({
      query: ({ base, id, body }) => ({ url: `${base}/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => one(id),
    }),
    deleteSupportBot: build.mutation<void, { base: BotsBase; id: string }>({ query: ({ base, id }) => ({ url: `${base}/${id}`, method: 'DELETE' }), invalidatesTags: [{ type: 'SupportBot', id: 'LIST' }] }),
    activateSupportBot: build.mutation<SupportBot, { base: BotsBase; id: string }>({ query: ({ base, id }) => ({ url: `${base}/${id}/activate`, method: 'POST' }), invalidatesTags: (_result, _error, { id }) => one(id) }),
    pauseSupportBot: build.mutation<SupportBot, { base: BotsBase; id: string }>({ query: ({ base, id }) => ({ url: `${base}/${id}/pause`, method: 'POST' }), invalidatesTags: (_result, _error, { id }) => one(id) }),
    suspendSupportBot: build.mutation<SupportBot, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/support/bots/${id}/suspend`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, _error, { id }) => one(id),
    }),
    unsuspendSupportBot: build.mutation<SupportBot, string>({ query: id => ({ url: `/v1/admin/support/bots/${id}/unsuspend`, method: 'POST' }), invalidatesTags: (_result, _error, id) => one(id) }),
    botKnowledge: build.query<BotKnowledge, { base: BotsBase; id: string }>({ query: ({ base, id }) => `${base}/${id}/knowledge`, providesTags: (_result, _error, { id }) => [knowledgeTag(id)] }),
    saveBotKnowledge: build.mutation<BotKnowledge, { base: BotsBase; id: string; content: string; format?: 'md' | 'csv'; source?: 'upload' | 'edited' | 'generated' }>({
      query: ({ base, id, ...body }) => ({ url: `${base}/${id}/knowledge`, method: 'PUT', body }),
      invalidatesTags: (_result, _error, { id }) => [...one(id), knowledgeTag(id)],
    }),
    generateBotKnowledge: build.mutation<{ content: string; data_hash: string }, { base: BotsBase; id: string }>({ query: ({ base, id }) => ({ url: `${base}/${id}/knowledge/generate`, method: 'POST' }) }),
    previewBotRefresh: build.mutation<{ data_hash: string; sections: SectionChange[] }, { base: BotsBase; id: string }>({ query: ({ base, id }) => ({ url: `${base}/${id}/knowledge/refresh`, method: 'POST', body: {} }) }),
    applyBotRefresh: build.mutation<{ applied: ManagedSectionKey[]; version: number; knowledge: BotKnowledge }, { base: BotsBase; id: string; apply: ManagedSectionKey[] }>({
      query: ({ base, id, apply }) => ({ url: `${base}/${id}/knowledge/refresh`, method: 'POST', body: { apply } }),
      invalidatesTags: (_result, _error, { id }) => [...one(id), knowledgeTag(id)],
    }),
    restoreBotKnowledge: build.mutation<BotKnowledge, { base: BotsBase; id: string; version: number }>({
      query: ({ base, id, version }) => ({ url: `${base}/${id}/knowledge/restore`, method: 'POST', body: { version } }),
      invalidatesTags: (_result, _error, { id }) => [...one(id), knowledgeTag(id)],
    }),
    testSupportBot: build.mutation<{ reply: string }, { base: BotsBase; id: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> }>({
      query: ({ base, id, messages }) => ({ url: `${base}/${id}/test`, method: 'POST', body: { messages } }),
    }),
    knowledgeTemplate: build.query<{ format: 'md' | 'csv'; filename: string; content: string }, { admin: boolean; format: 'md' | 'csv' }>({
      query: ({ admin, format }) => `${admin ? '/v1/admin/support' : '/v1/support'}/knowledge-template?format=${format}`,
    }),
  }),
});

export const {
  useSupportBotsQuery,
  useSupportBotQuery,
  useCreateSupportBotMutation,
  useUpdateSupportBotMutation,
  useDeleteSupportBotMutation,
  useActivateSupportBotMutation,
  usePauseSupportBotMutation,
  useSuspendSupportBotMutation,
  useUnsuspendSupportBotMutation,
  useBotKnowledgeQuery,
  useSaveBotKnowledgeMutation,
  useGenerateBotKnowledgeMutation,
  usePreviewBotRefreshMutation,
  useApplyBotRefreshMutation,
  useRestoreBotKnowledgeMutation,
  useTestSupportBotMutation,
  useLazyKnowledgeTemplateQuery,
} = supportBotsApi;
