import { bitocardApi } from '../base';
import { type List, type Mode, params } from './common';

export type TicketStatus = 'open' | 'pending' | 'resolved';
export type TicketQueue = 'reseller' | 'bitocard';
export type TicketCategory = 'order' | 'payment' | 'account' | 'product' | 'technical' | 'other';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketRequester = 'customer' | 'reseller';

export const ticketCategories: TicketCategory[] = ['order', 'payment', 'account', 'product', 'technical', 'other'];
export const ticketPriorities: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

export type TicketMessage = {
  id: string;
  author: 'customer' | 'reseller' | 'bitocard' | 'bot' | 'system';
  author_name: string | null;
  /** `all`: the requester sees it too; `staff`: those answering only. */
  visibility: 'all' | 'staff';
  body: string;
  created_at: string;
};

/** A support ticket in a list (no messages). */
export type TicketSummary = {
  object: 'support_ticket';
  id: string;
  reference: string;
  mode: Mode;
  requester: TicketRequester;
  queue: TicketQueue;
  status: TicketStatus;
  category: TicketCategory;
  priority: TicketPriority;
  subject: string;
  source: 'form' | 'api' | 'chat' | 'bot';
  store_id: string | null;
  customer_id: string | null;
  customer_reference: string | null;
  order_id: string | null;
  checkout_id: string | null;
  assignee_id: string | null;
  escalated_at: string | null;
  resolved_at: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
};

export type Ticket = TicketSummary & { messages: TicketMessage[] };

export type OpenTicketInput = {
  requester: TicketRequester;
  subject: string;
  category: TicketCategory;
  message: string;
  order_id?: string;
  customer_reference?: string;
};

const tags = (id: string) => [{ type: 'SupportTicket' as const, id }, { type: 'SupportTicket' as const, id: 'LIST' }];

/**
 * Support tickets (`/v1/support/tickets`): customers' tickets the reseller answers (passing to BitoCard when needed) and
 * the reseller's own tickets to BitoCard.
 */
export const resellerSupportApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    tickets: build.query<List<TicketSummary>, { status?: TicketStatus; queue?: TicketQueue; requester?: TicketRequester } | void>({
      query: filter => ({ url: '/v1/support/tickets', params: params({ limit: 100, ...(filter ?? {}) }) }),
      providesTags: [{ type: 'SupportTicket', id: 'LIST' }],
    }),
    ticket: build.query<Ticket, string>({ query: id => `/v1/support/tickets/${id}`, providesTags: (_result, _error, id) => [{ type: 'SupportTicket', id }] }),
    openTicket: build.mutation<Ticket, OpenTicketInput>({
      query: body => ({ url: '/v1/support/tickets', method: 'POST', body }),
      invalidatesTags: [{ type: 'SupportTicket', id: 'LIST' }],
    }),
    replyTicket: build.mutation<Ticket, { id: string; body: string; visibility: 'all' | 'staff' }>({
      query: ({ id, ...body }) => ({ url: `/v1/support/tickets/${id}/messages`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
    escalateTicket: build.mutation<Ticket, { id: string; note: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/support/tickets/${id}/escalate`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
    resolveTicket: build.mutation<Ticket, { id: string; note?: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/support/tickets/${id}/resolve`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
    updateTicket: build.mutation<Ticket, { id: string; priority?: TicketPriority; assignee_id?: string | null }>({
      query: ({ id, ...body }) => ({ url: `/v1/support/tickets/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
  }),
});

export const { useTicketsQuery, useTicketQuery, useOpenTicketMutation, useReplyTicketMutation, useEscalateTicketMutation, useResolveTicketMutation, useUpdateTicketMutation } = resellerSupportApi;

export type ChatStatus = 'bot' | 'waiting' | 'with_staff' | 'closed';

export type ChatMessage = { id: string; author: 'customer' | 'reseller' | 'bitocard' | 'bot' | 'system'; author_name: string | null; body: string; created_at: string };

/** A live chat as staff (or the reseller asking BitoCard) see it. */
export type Chat = {
  object: 'support_chat';
  id: string;
  mode: Mode;
  requester: TicketRequester;
  requester_name: string | null;
  queue: TicketQueue;
  status: ChatStatus;
  store_id: string | null;
  customer_id: string | null;
  user_id: string | null;
  assignee_id: string | null;
  ticket_id: string | null;
  ticket_reference: string | null;
  last_message_at: string;
  last_asked_at: string;
  closed_at: string | null;
  created_at: string;
  messages: ChatMessage[];
};
export type ChatSummary = Omit<Chat, 'messages'>;

const chatTags = (id: string) => [{ type: 'SupportChat' as const, id }, { type: 'SupportChat' as const, id: 'LIST' }];

/**
 * Live chat in SHQ (`/v1/support/chats`, sessions only): the store's customers' chats, and the reseller's own chat with
 * BitoCard (`/v1/support/bitocard-chat`). Screens poll while a chat is open.
 */
export const resellerChatsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    chats: build.query<List<ChatSummary>, { status?: ChatStatus } | void>({
      query: filter => ({ url: '/v1/support/chats', params: params({ limit: 100, ...(filter ?? {}) }) }),
      providesTags: [{ type: 'SupportChat', id: 'LIST' }],
    }),
    chat: build.query<Chat, string>({ query: id => `/v1/support/chats/${id}`, providesTags: (_result, _error, id) => [{ type: 'SupportChat', id }] }),
    replyChat: build.mutation<Chat, { id: string; body: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/support/chats/${id}/messages`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => chatTags(id),
    }),
    takeChat: build.mutation<Chat, string>({ query: id => ({ url: `/v1/support/chats/${id}/take`, method: 'POST' }), invalidatesTags: (_result, _error, id) => chatTags(id) }),
    closeChat: build.mutation<Chat, string>({ query: id => ({ url: `/v1/support/chats/${id}/close`, method: 'POST' }), invalidatesTags: (_result, _error, id) => chatTags(id) }),
    chatTicket: build.mutation<Chat, { id: string; subject: string; category: TicketCategory }>({
      query: ({ id, ...body }) => ({ url: `/v1/support/chats/${id}/ticket`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [...chatTags(id), { type: 'SupportTicket', id: 'LIST' }],
    }),
    bitocardChat: build.query<{ object: 'support_chat_current'; chat: Chat | null }, void>({ query: () => '/v1/support/bitocard-chat', providesTags: [{ type: 'SupportChat', id: 'BITOCARD' }] }),
    sendBitocardChat: build.mutation<Chat, { body: string }>({
      query: body => ({ url: '/v1/support/bitocard-chat/messages', method: 'POST', body }),
      invalidatesTags: [{ type: 'SupportChat', id: 'BITOCARD' }],
    }),
    closeBitocardChat: build.mutation<Chat, string>({
      query: id => ({ url: `/v1/support/bitocard-chat/${id}/close`, method: 'POST' }),
      invalidatesTags: [{ type: 'SupportChat', id: 'BITOCARD' }],
    }),
  }),
});

export const {
  useChatsQuery,
  useChatQuery,
  useReplyChatMutation,
  useTakeChatMutation,
  useCloseChatMutation,
  useChatTicketMutation,
  useBitocardChatQuery,
  useSendBitocardChatMutation,
  useCloseBitocardChatMutation,
} = resellerChatsApi;
