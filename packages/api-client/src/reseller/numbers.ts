import { bitocardApi } from '../base';
import { settleOptimistic } from '../optimistic';
import { cursorPages, type List, type Mode, params } from './common';

export const numberStatuses = ['active', 'expired', 'deleted'] as const;
/** `expired`: paused by the supplier but still renewable until `delete_at`; `deleted`: released for good. */
export type NumberStatus = (typeof numberStatuses)[number];

/** A virtual number sold by an order (`/v1/numbers`). It is paid up to `expires_at` and renewed from your wallet. */
export type VirtualNumber = {
  object: 'virtual_number';
  id: string;
  order_id: string;
  mode: Mode;
  /** E.164, with its plus. */
  number: string;
  status: NumberStatus;
  /** Paid up to. */
  expires_at: string;
  /** Released for good on this date unless renewed first. */
  delete_at: string;
  auto_renew: boolean;
  /** The customer may send SMS from the order's page, charged to your wallet. */
  customer_sending: boolean;
  /** The number can send SMS. */
  sends_sms: boolean;
  /** Why the last automatic renewal failed (`insufficient_funds`, or another reason), cleared once one succeeds. */
  renewal_error: string | null;
  created_at: string;
  updated_at: string;
};

/** A month's renewal at today's wholesale price, taken from your wallet. Amount in `currency` minor units. */
export type NumberRenewalPrice = { object: 'number_renewal_price'; amount: number; currency: string };

export type NumberMessageStatus = 'received' | 'queued' | 'sent' | 'delivered' | 'failed';
/** An SMS to (`in`) or from (`out`) the number. `charged` is what a sent message cost your wallet. */
export type NumberMessage = {
  object: 'number_message';
  id: string;
  number_id: string;
  direction: 'in' | 'out';
  from: string;
  to: string;
  text: string | null;
  status: NumberMessageStatus;
  charged: number | null;
  currency: string | null;
  failure_reason: string | null;
  created_at: string;
};

export type NumberFilter = { status?: NumberStatus };
export type NumberSettings = { auto_renew?: boolean; customer_sending?: boolean };

/** The GSM alphabet, as the API checks it: anything else needs Unicode. */
const gsm = /^[\n\r\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€^{}\\[~\]|]*$/;
/** One SMS part, the most a message may be: 160 GSM characters, or 70 when the text needs Unicode. */
export const smsLimit = (text: string) => (gsm.test(text) ? 160 : 70);

const messagesTag = (id: string) => ({ type: 'Number' as const, id: `${id}:messages` });

/** Virtual numbers: the list, one number, its settings, renewals and SMS. They follow live or sandbox mode. */
export const resellerNumbersApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    resellerNumbers: build.infiniteQuery<List<VirtualNumber>, NumberFilter, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ queryArg, pageParam }) => ({ url: '/v1/numbers', params: params({ ...queryArg, limit: 25, starting_after: pageParam }) }),
      providesTags: [{ type: 'Number', id: 'LIST' }],
    }),
    resellerNumber: build.query<VirtualNumber, string>({ query: id => `/v1/numbers/${id}`, providesTags: (_result, _error, id) => [{ type: 'Number', id }] }),
    /** Auto-renew and customer sending: shown at once on the number and every loaded list, undone if refused. */
    updateNumber: build.mutation<VirtualNumber, { id: string } & NumberSettings>({
      query: ({ id, ...body }) => ({ url: `/v1/numbers/${id}`, method: 'PATCH', body }),
      async onQueryStarted({ id, ...settings }, { dispatch, getState, queryFulfilled }) {
        const changes = Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)) as NumberSettings;
        const state = getState() as Parameters<typeof resellerNumbersApi.util.selectCachedArgsForQuery>[0];
        const lists = resellerNumbersApi.util.selectCachedArgsForQuery(state, 'resellerNumbers');
        const patchLists = (values: Partial<VirtualNumber>) =>
          lists.map(args =>
            dispatch(
              resellerNumbersApi.util.updateQueryData('resellerNumbers', args, draft => {
                for (const number of draft.pages.flatMap(page => page.data)) if (number.id === id) Object.assign(number, values);
              }),
            ),
          );
        const patches = [dispatch(resellerNumbersApi.util.updateQueryData('resellerNumber', id, draft => void Object.assign(draft, changes))), ...patchLists(changes)];
        const saved = await settleOptimistic(patches, queryFulfilled, () => dispatch(resellerNumbersApi.util.invalidateTags([{ type: 'Number', id }, { type: 'Number', id: 'LIST' }])));
        if (saved) {
          // The API's answer is the truth: take it without refetching the lists.
          dispatch(resellerNumbersApi.util.updateQueryData('resellerNumber', id, draft => void Object.assign(draft, saved)));
          patchLists(saved);
        }
      },
    }),
    numberRenewalPrice: build.query<NumberRenewalPrice, string>({ query: id => `/v1/numbers/${id}/renewal-price`, providesTags: (_result, _error, id) => [{ type: 'Number', id }] }),
    /** Renews a month now, paid from your wallet (`insufficient_funds` when it cannot cover it). */
    renewNumber: build.mutation<VirtualNumber, string>({
      query: id => ({ url: `/v1/numbers/${id}/renew`, method: 'POST' }),
      invalidatesTags: (_result, _error, id) => [{ type: 'Number', id }, { type: 'Number', id: 'LIST' }, 'Wallet'],
    }),
    numberMessages: build.infiniteQuery<List<NumberMessage>, string, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ queryArg, pageParam }) => ({ url: `/v1/numbers/${queryArg}/messages`, params: params({ limit: 25, starting_after: pageParam }) }),
      providesTags: (_result, _error, id) => [messagesTag(id)],
    }),
    /** Sends an SMS from the number (see `smsLimit`); charged to your wallet. */
    sendNumberMessage: build.mutation<NumberMessage, { id: string; to: string; text: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/numbers/${id}/messages`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [messagesTag(id), 'Wallet'],
    }),
  }),
});

export const {
  useResellerNumbersInfiniteQuery,
  useResellerNumberQuery,
  useUpdateNumberMutation,
  useNumberRenewalPriceQuery,
  useRenewNumberMutation,
  useNumberMessagesInfiniteQuery,
  useSendNumberMessageMutation,
} = resellerNumbersApi;
