import { bitocardApi } from '../base';

/** What a Contact us message is about, as udozo.com's form offers it. */
export const contactKinds = ['order', 'safe_pay', 'account', 'selling', 'reselling', 'report', 'partnership', 'other'] as const;
export type ContactKind = (typeof contactKinds)[number];
export const contactKindLabels: Record<ContactKind, string> = {
  order: 'An order',
  safe_pay: 'Safe pay',
  account: 'My account',
  selling: 'Selling',
  reselling: 'Reselling on Seller HQ',
  report: 'Reporting a person or listing',
  partnership: 'Partnerships and press',
  other: 'Something else',
};

/** new (nobody has looked), open (being worked), waiting (replied, waiting for the sender), resolved or spam. */
export const contactStatuses = ['new', 'open', 'waiting', 'resolved', 'spam'] as const;
export type ContactStatus = (typeof contactStatuses)[number];
export const contactStatusLabels: Record<ContactStatus, string> = { new: 'New', open: 'Open', waiting: 'Waiting for the sender', resolved: 'Resolved', spam: 'Spam' };

/** A step on a message: a reply emailed to the sender, or a note for the team only. */
export type ContactEntry = { id: string; kind: 'reply' | 'note'; author_name: string; body: string; created_at: string };

/** A message from udozo.com's Contact us form (`ContactMessagesService` in Udozo's API). */
export type ContactMessage = {
  object: 'contact_message';
  id: string;
  /** C-000123 */
  reference: string;
  kind: ContactKind;
  status: ContactStatus;
  name: string;
  email: string;
  phone: string | null;
  body: string;
  country: string | null;
  /** The sender's Udozo account, when they were signed in. */
  customer_id: string | null;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
  replied_at: string | null;
  resolved_at: string | null;
  /** On a single message only. */
  entries?: ContactEntry[];
};

export type ContactMessageList = { object: 'list'; data: ContactMessage[]; total: number; counts: Record<ContactStatus, number> };
export type ContactMessageFilter = { status?: ContactStatus | 'active'; kind?: ContactKind; assignee?: 'me' | 'none' | string; q?: string; limit?: number; offset?: number };

/** Udozo's support team (support and operations): Contact us messages, their status and assignee, replies and notes. */
export const contactMessagesApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    contactMessages: build.query<ContactMessageList, ContactMessageFilter>({
      query: filter => ({ url: '/v1/admin/support/contact-messages', params: Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined && value !== '')) }),
      providesTags: ['ContactMessages'],
    }),
    contactMessage: build.query<ContactMessage, string>({ query: id => `/v1/admin/support/contact-messages/${id}`, providesTags: (_result, _error, id) => [{ type: 'ContactMessages', id }] }),
    updateContactMessage: build.mutation<ContactMessage, { id: string; status?: ContactStatus; assignee_id?: string | null }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/support/contact-messages/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['ContactMessages', 'Activity'],
    }),
    replyContactMessage: build.mutation<ContactMessage, { id: string; body: string }>({
      query: ({ id, body }) => ({ url: `/v1/admin/support/contact-messages/${id}/replies`, method: 'POST', body: { body } }),
      invalidatesTags: ['ContactMessages', 'Activity'],
    }),
    noteContactMessage: build.mutation<ContactMessage, { id: string; body: string }>({
      query: ({ id, body }) => ({ url: `/v1/admin/support/contact-messages/${id}/notes`, method: 'POST', body: { body } }),
      invalidatesTags: ['ContactMessages'],
    }),
  }),
});

export const { useContactMessagesQuery, useContactMessageQuery, useUpdateContactMessageMutation, useReplyContactMessageMutation, useNoteContactMessageMutation } = contactMessagesApi;
