import { bitocardApi } from '../base';
import type { ResellerRole } from './common';

/** Roles that can be given to staff; the owner role is never assigned or changed here. */
export type StaffRole = Exclude<ResellerRole, 'owner'>;
export const staffRoles: StaffRole[] = ['admin', 'developer', 'finance', 'support'];

export type TeamMember = { object: 'member'; user_id: string; name: string; email: string; role: ResellerRole; joined_at: string };
export type Invitation = { object: 'invitation'; id: string; email: string; role: StaffRole; expires_at: string; created_at: string };
export type Team = { object: 'team'; members: TeamMember[]; invitations: Invitation[] };
export type InvitationAccepted = { object: 'membership_created'; reseller_id: string; role: StaffRole };

/** The reseller's team (`/v1/team`): signed-in people only; owners and admins manage it. */
export const resellerTeamApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    team: build.query<Team, void>({ query: () => '/v1/team', providesTags: ['Team'] }),
    inviteMember: build.mutation<Invitation, { email: string; role: StaffRole }>({
      query: body => ({ url: '/v1/team/invitations', method: 'POST', body }),
      invalidatesTags: ['Team'],
    }),
    cancelInvitation: build.mutation<void, string>({ query: id => ({ url: `/v1/team/invitations/${id}`, method: 'DELETE' }), invalidatesTags: ['Team'] }),
    /** Accept while signed in with the invited email. The page reloads afterwards so the new account appears. */
    acceptInvitation: build.mutation<InvitationAccepted, { token: string }>({
      query: body => ({ url: '/v1/team/invitations/accept', method: 'POST', body }),
      invalidatesTags: ['Session', 'Team'],
    }),
    changeMemberRole: build.mutation<Team, { userId: string; role: StaffRole }>({
      query: ({ userId, role }) => ({ url: `/v1/team/members/${userId}`, method: 'PATCH', body: { role } }),
      invalidatesTags: ['Team'],
    }),
    removeMember: build.mutation<void, string>({ query: userId => ({ url: `/v1/team/members/${userId}`, method: 'DELETE' }), invalidatesTags: ['Team'] }),
  }),
});

export const { useTeamQuery, useInviteMemberMutation, useCancelInvitationMutation, useAcceptInvitationMutation, useChangeMemberRoleMutation, useRemoveMemberMutation } =
  resellerTeamApi;
