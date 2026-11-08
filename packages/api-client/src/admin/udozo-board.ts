import { bitocardApi } from '../base';

// The account dashboard's message board on udozo.com (Udozo's API only: /v1/admin/classifieds/board).

export type BoardTone = 'news' | 'tip' | 'alert';
export type BoardPostState = 'showing' | 'off' | 'scheduled' | 'ended';
export type AdminBoardPost = {
  object: 'board_post';
  id: string;
  /** A market's code, or null for every market. */
  country: string | null;
  title: string;
  body: string;
  tone: BoardTone;
  /** A page on udozo.com (`/…`) or an https address. */
  href: string | null;
  link_label: string | null;
  pinned: boolean;
  /** The gate: off, it never shows. */
  enabled: boolean;
  state: BoardPostState;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};
export type BoardPostInput = Partial<Pick<AdminBoardPost, 'country' | 'title' | 'body' | 'tone' | 'href' | 'link_label' | 'pinned' | 'enabled' | 'starts_at' | 'ends_at'>>;

const tag = { type: 'Settings' as const, id: 'BOARD' };

export const adminUdozoBoardApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    boardPosts: build.query<{ object: 'list'; data: AdminBoardPost[] }, { country?: string } | void>({
      query: filter => ({ url: '/v1/admin/classifieds/board', params: filter?.country ? { country: filter.country } : {} }),
      providesTags: [tag],
    }),
    createBoardPost: build.mutation<AdminBoardPost, BoardPostInput>({
      query: body => ({ url: '/v1/admin/classifieds/board', method: 'POST', body }),
      invalidatesTags: [tag, 'Activity'],
    }),
    updateBoardPost: build.mutation<AdminBoardPost, BoardPostInput & { id: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/classifieds/board/${id}`, method: 'PATCH', body }),
      invalidatesTags: [tag, 'Activity'],
    }),
    deleteBoardPost: build.mutation<{ object: 'board_post'; id: string; deleted: true }, string>({
      query: id => ({ url: `/v1/admin/classifieds/board/${id}`, method: 'DELETE' }),
      invalidatesTags: [tag, 'Activity'],
    }),
  }),
});

export const { useBoardPostsQuery, useCreateBoardPostMutation, useUpdateBoardPostMutation, useDeleteBoardPostMutation } = adminUdozoBoardApi;
