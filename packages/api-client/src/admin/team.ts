import { bitocardApi } from '../base';
import type { AdminRole } from './types';

/** An admin as Settings > Team shows them (`AdminTeamService`): never a password, code or secret. */
export type AdminMember = {
  object: 'admin_member';
  id: string;
  name: string;
  email: string;
  roles: AdminRole[];
  status: 'active' | 'disabled';
  /** False until they choose a password with the emailed link (invited). */
  password_set: boolean;
  /** Set up at their first sign-in. */
  authenticator: boolean;
  last_sign_in_at: string | null;
  created_at: string;
};

/** Whether the set-password link went: `outbox` when no email provider is set up, `skipped` within a minute of the last. */
export type AdminLinkSent = 'sent' | 'outbox' | 'skipped' | 'failed';

export type AdminTeam = { object: 'list'; data: AdminMember[]; roles: AdminRole[]; domains: string[] };

/** Super admins: the admin team, inviting staff with roles and managing them (every change after step-up). */
export const adminTeamApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    adminTeam: build.query<AdminTeam, void>({ query: () => '/v1/admin/team', providesTags: ['AdminTeam'] }),
    inviteAdmin: build.mutation<AdminMember & { email_sent: AdminLinkSent }, { name: string; email: string; roles: AdminRole[] }>({
      query: body => ({ url: '/v1/admin/team', method: 'POST', body }),
      invalidatesTags: ['AdminTeam', 'Activity'],
    }),
    setAdminRoles: build.mutation<AdminMember, { id: string; roles: AdminRole[] }>({
      query: ({ id, roles }) => ({ url: `/v1/admin/team/${id}`, method: 'PATCH', body: { roles } }),
      invalidatesTags: ['AdminTeam', 'Activity'],
    }),
    sendAdminPasswordLink: build.mutation<AdminMember & { email_sent: AdminLinkSent }, string>({
      query: id => ({ url: `/v1/admin/team/${id}/password-link`, method: 'POST' }),
      invalidatesTags: ['Activity'],
    }),
    resetAdminAuthenticator: build.mutation<AdminMember, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/team/${id}/authenticator/reset`, method: 'POST', body: { reason } }),
      invalidatesTags: ['AdminTeam', 'Activity'],
    }),
    suspendAdmin: build.mutation<AdminMember, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/team/${id}/suspend`, method: 'POST', body: { reason } }),
      invalidatesTags: ['AdminTeam', 'Activity'],
    }),
    restoreAdmin: build.mutation<AdminMember, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/team/${id}/restore`, method: 'POST', body: { reason } }),
      invalidatesTags: ['AdminTeam', 'Activity'],
    }),
  }),
});

export const {
  useAdminTeamQuery,
  useInviteAdminMutation,
  useSetAdminRolesMutation,
  useSendAdminPasswordLinkMutation,
  useResetAdminAuthenticatorMutation,
  useSuspendAdminMutation,
  useRestoreAdminMutation,
} = adminTeamApi;
