import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type User } from '../generated/prisma/client.js';
import { AdminAuthService, adminRoles } from './admin-auth.service.js';

type AdminRole = (typeof adminRoles)[number];
type Member = User & { totp: { confirmedAt: Date | null } | null };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No admin has that ID.');
const lastSuperAdmin = () =>
  new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'last_super_admin', 'Keep at least one active super admin: make someone else a super admin first.');
const notYourself = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'not_yourself', 'You cannot do this to your own account. Ask another super admin.');

/** An admin as the team page shows them: never a password, code or secret. */
function present(member: Member) {
  return {
    object: 'admin_member' as const,
    id: member.id,
    name: member.name,
    email: member.email,
    roles: member.adminRoles,
    status: member.status,
    // `invited` until they choose a password with the emailed link.
    password_set: member.passwordHash !== null,
    authenticator: Boolean(member.totp?.confirmedAt),
    last_sign_in_at: member.lastSignInAt?.toISOString() ?? null,
    created_at: member.createdAt.toISOString(),
  };
}

/**
 * The admin team (Settings > Team, super admins only): every admin of the realm, inviting staff with chosen roles,
 * changing roles, emailing a new set-password link, resetting an authenticator, suspending and restoring. Invited
 * staff get the same one-time link as sign-in's set-up (`AdminAuthService.sendPasswordLink`), choose a password, then
 * set up their authenticator at their first sign-in, as every admin does. Only addresses on the realm's admin domains
 * (environment only) can be invited, and there is always at least one active super admin. Admins are never deleted
 * (their audit trail points at them): suspending ends their access. Every change is audited.
 */
@Injectable()
export class AdminTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AdminAuthService,
    private readonly audit: AuditService,
  ) {}

  private readonly realm = 'admin' as const;

  async list() {
    const members = await this.prisma.user.findMany({ where: { realm: this.realm }, include: { totp: { select: { confirmedAt: true } } }, orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] });
    return { object: 'list' as const, data: members.map(present), roles: adminRoles, domains: this.auth.adminDomains(this.realm) };
  }

  private async member(id: string) {
    const member = await this.prisma.user.findFirst({ where: { id, realm: this.realm }, include: { totp: { select: { confirmedAt: true } } } });
    if (!member) throw notFound();
    return member;
  }

  private checkRoles(roles: string[]): AdminRole[] {
    const unique = [...new Set(roles)];
    if (!unique.length || unique.some(role => !(adminRoles as readonly string[]).includes(role))) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', `Choose one or more roles: ${adminRoles.join(', ')}.`, 'roles');
    }
    return unique as AdminRole[];
  }

  /** Other active super admins than `exceptId`, so the last one is never demoted or suspended. */
  private async otherSuperAdmins(exceptId: string) {
    return this.prisma.user.count({ where: { realm: this.realm, status: 'active', adminRoles: { has: 'super_admin' }, id: { not: exceptId } } });
  }

  async invite(actorId: string, input: { email: string; name: string; roles: string[] }) {
    const email = input.email.trim().toLowerCase();
    if (!this.auth.isAdminDomain(email, this.realm)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'admin_domain_not_allowed', `Admins use an address on ${this.auth.adminDomains(this.realm).join(' or ')}.`, 'email');
    }
    const roles = this.checkRoles(input.roles);
    let created: User;
    try {
      created = await this.auth.createAdmin({ email, name: input.name.trim(), roles, realm: this.realm });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'admin_exists', 'An admin already uses this email.', 'email');
      }
      throw error;
    }
    await this.audit.record({ actorId, action: 'admin.invited', targetType: 'user', targetId: created.id, after: { email, roles } });
    const email_sent = await this.auth.sendPasswordLink(created, 'create');
    return { ...present({ ...created, totp: null }), email_sent };
  }

  async setRoles(actorId: string, id: string, roles: string[]) {
    const member = await this.member(id);
    const next = this.checkRoles(roles);
    if (member.adminRoles.includes('super_admin') && !next.includes('super_admin') && member.status === 'active' && (await this.otherSuperAdmins(id)) === 0) throw lastSuperAdmin();
    const updated = await this.prisma.user.update({ where: { id }, data: { adminRoles: next }, include: { totp: { select: { confirmedAt: true } } } });
    await this.audit.record({ actorId, action: 'admin.roles_changed', targetType: 'user', targetId: id, before: { roles: member.adminRoles }, after: { roles: next } });
    return present(updated);
  }

  /** A new set-password link: to finish an invitation, or to reset a forgotten password. */
  async passwordLink(actorId: string, id: string) {
    const member = await this.member(id);
    if (member.status !== 'active') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'admin_suspended', 'Restore this admin first.');
    const email_sent = await this.auth.sendPasswordLink(member, member.passwordHash ? 'reset' : 'create');
    await this.audit.record({ actorId, action: 'admin.password_link_requested', targetType: 'user', targetId: id, after: { email_sent } });
    return { ...present(member), email_sent };
  }

  /** A lost phone: the authenticator is removed and they are signed out; they set one up again at their next sign-in. */
  async resetAuthenticator(actorId: string, id: string, reason: string) {
    if (actorId === id) throw notYourself();
    const member = await this.member(id);
    await this.prisma.$transaction([
      this.prisma.totpCredential.deleteMany({ where: { userId: id } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record({ actorId, action: 'admin.authenticator_reset', targetType: 'user', targetId: id, after: { reason } });
    return present({ ...member, totp: null });
  }

  /** Ends their access at once (every session), keeping the account and its history. */
  async suspend(actorId: string, id: string, reason: string) {
    if (actorId === id) throw notYourself();
    const member = await this.member(id);
    if (member.adminRoles.includes('super_admin') && (await this.otherSuperAdmins(id)) === 0) throw lastSuperAdmin();
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status: 'disabled' }, include: { totp: { select: { confirmedAt: true } } } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record({ actorId, action: 'admin.suspended', targetType: 'user', targetId: id, after: { reason } });
    return present(updated);
  }

  async restore(actorId: string, id: string, reason: string) {
    await this.member(id);
    const updated = await this.prisma.user.update({ where: { id }, data: { status: 'active', failedSignIns: 0, lockedUntil: null }, include: { totp: { select: { confirmedAt: true } } } });
    await this.audit.record({ actorId, action: 'admin.restored', targetType: 'user', targetId: id, after: { reason } });
    return present(updated);
  }
}
