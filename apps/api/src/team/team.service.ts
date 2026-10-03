import { HttpStatus, Injectable } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../database/prisma.service';
import { randomToken, sha256 } from '../common/crypto';
import { ApiError } from '../common/errors/api-error';
import type { Invitation, ResellerRole } from '../generated/prisma/client';
import { EmailService } from '../notifications/email.service';
import { invitationEmail } from '../notifications/templates';

export const staffRoles = ['admin', 'developer', 'finance', 'support'] as const;
const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

const invalidInvitation = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'invitation_invalid', 'This invitation is no longer valid. Ask for a new one.', 'token');
const memberMissing = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such team member.');

function presentInvitation(invitation: Invitation) {
  return {
    object: 'invitation' as const,
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expires_at: invitation.expiresAt.toISOString(),
    created_at: invitation.createdAt.toISOString(),
  };
}

/** A reseller's staff: invitations by email, roles, and removal. The owner cannot be changed or removed here. */
@Injectable()
export class TeamService {
  /** Admin integration settings over the environment, read fresh on every use. */
  private get config() {
    return this.integrations.config;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly integrations: IntegrationsService,
  ) {}

  async team(resellerId: string) {
    const [members, invitations] = await Promise.all([
      this.prisma.resellerMember.findMany({ where: { resellerId }, include: { user: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.invitation.findMany({ where: { resellerId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      object: 'team' as const,
      members: members.map(member => ({
        object: 'member' as const,
        user_id: member.userId,
        name: member.user.name,
        email: member.user.email,
        role: member.role,
        joined_at: member.createdAt.toISOString(),
      })),
      invitations: invitations.map(presentInvitation),
    };
  }

  /** Emails a 7-day invitation. A new invitation to the same address replaces the previous one. */
  async invite(resellerId: string, invitedById: string, emailInput: string, role: ResellerRole) {
    const email = emailInput.trim().toLowerCase();
    const existing = await this.prisma.resellerMember.findFirst({ where: { resellerId, user: { email, realm: 'reseller' } } });
    if (existing) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'already_a_member', 'This person is already on your team.', 'email');

    const token = randomToken();
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    const [, invitation] = await this.prisma.$transaction([
      this.prisma.invitation.updateMany({ where: { resellerId, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.invitation.create({
        data: { resellerId, email, role, invitedById, tokenHash: sha256(token), expiresAt: new Date(Date.now() + invitationLifetimeMs) },
      }),
    ]);
    const link = new URL('/invitations/accept', this.config.DASHBOARD_URL);
    link.searchParams.set('token', token);
    await this.email.send(invitationEmail(email, reseller.name, role, link.toString()));
    return presentInvitation(invitation);
  }

  async revokeInvitation(resellerId: string, id: string) {
    const revoked = await this.prisma.invitation.updateMany({ where: { id, resellerId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (revoked.count === 0) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such pending invitation.');
  }

  /** A valid invitation for this token and email, or an error. */
  async findValid(token: string, email: string) {
    const invitation = await this.prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) throw invalidInvitation();
    if (invitation.email !== email) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'invitation_email_mismatch', `This invitation was sent to ${invitation.email}. Sign in with that email.`);
    }
    return invitation;
  }

  /** Adds a signed-in person to the inviting reseller. */
  async accept(userId: string, token: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const invitation = await this.findValid(token, user.email);
    await this.prisma.$transaction([
      this.prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } }),
      this.prisma.resellerMember.upsert({
        where: { resellerId_userId: { resellerId: invitation.resellerId, userId } },
        create: { resellerId: invitation.resellerId, userId, role: invitation.role },
        update: {},
      }),
      // Following the emailed link proves the address.
      this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() } }),
    ]);
    return { object: 'membership_created' as const, reseller_id: invitation.resellerId, role: invitation.role };
  }

  async changeRole(resellerId: string, userId: string, role: ResellerRole) {
    const member = await this.prisma.resellerMember.findUnique({ where: { resellerId_userId: { resellerId, userId } } });
    if (!member) throw memberMissing();
    if (member.role === 'owner') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'owner_protected', "The owner's role cannot be changed.");
    await this.prisma.resellerMember.update({ where: { resellerId_userId: { resellerId, userId } }, data: { role } });
    return this.team(resellerId);
  }

  async remove(resellerId: string, userId: string) {
    const member = await this.prisma.resellerMember.findUnique({ where: { resellerId_userId: { resellerId, userId } } });
    if (!member) throw memberMissing();
    if (member.role === 'owner') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'owner_protected', 'The owner cannot be removed.');
    await this.prisma.resellerMember.delete({ where: { resellerId_userId: { resellerId, userId } } });
  }
}
