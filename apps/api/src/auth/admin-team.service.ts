import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type User } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { AdminAuthService, adminRoles } from './admin-auth.service.js';

const includeAuthenticator = { totp: { select: { confirmedAt: true } } } as const;
const realm = 'admin' as const;

function present(member: User & { totp: { confirmedAt: Date | null } | null }) {
  return {
    object: 'admin_member' as const,
    id: member.id,
    name: member.name,
    email: member.email,
    roles: member.adminRoles,
    status: member.status,
    password_set: member.passwordHash !== null,
    authenticator: Boolean(member.totp?.confirmedAt),
    last_sign_in_at: member.lastSignInAt?.toISOString() ?? null,
    created_at: member.createdAt.toISOString(),
  };
}

const conflict = (code: string, message: string, param?: string) =>
  new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);

@Injectable()
export class AdminTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AdminAuthService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
  ) {}

  async list() {
    const members = await this.prisma.user.findMany({
      where: { realm },
      include: includeAuthenticator,
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return { object: 'list' as const, data: members.map(present), roles: adminRoles, domains: this.auth.adminDomains() };
  }

  async invite(actorId: string, input: { email: string; name: string; roles: string[] }) {
    const { email, name } = input;
    if (!this.auth.isAdminDomain(email)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'admin_domain_not_allowed', 'Use an email on an approved admin domain.', 'email');
    }
    const roles = this.checkRoles(input.roles);
    const member = await this.auth.createAdmin({ email, name, roles, realm }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('admin_exists', 'An admin already uses this email.', 'email');
      }
      throw error;
    });
    await this.audit.record({ actorId, action: 'admin.invited', targetType: 'user', targetId: member.id, after: { email, roles } });
    return { ...present({ ...member, totp: null }), email_sent: await this.auth.sendPasswordLink(member, 'create') };
  }

  async setRoles(actorId: string, id: string, roles: string[]) {
    const next = this.checkRoles(roles);
    const { member, updated } = await this.changeAccess(async tx => {
      const member = await this.member(id, tx);
      if (!next.includes('super_admin')) await this.keepSuperAdmin(member, tx);
      const updated = await tx.user.update({ where: { id }, data: { adminRoles: next }, include: includeAuthenticator });
      return { member, updated };
    });
    await this.audit.record({ actorId, action: 'admin.roles_changed', targetType: 'user', targetId: id, before: { roles: member.adminRoles }, after: { roles: next } });
    return present(updated);
  }

  async passwordLink(actorId: string, id: string) {
    const member = await this.member(id);
    if (member.status !== 'active') throw conflict('admin_suspended', 'Restore this admin first.');
    const email_sent = await this.auth.sendPasswordLink(member, member.passwordHash ? 'reset' : 'create');
    await this.audit.record({ actorId, action: 'admin.password_link_requested', targetType: 'user', targetId: id, after: { email_sent } });
    return { ...present(member), email_sent };
  }

  async resetAuthenticator(actorId: string, id: string, reason: string) {
    this.requireOther(actorId, id);
    const member = await this.member(id);
    await this.prisma.$transaction([
      this.prisma.totpCredential.deleteMany({ where: { userId: id } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record({ actorId, action: 'admin.authenticator_reset', targetType: 'user', targetId: id, after: { reason } });
    await this.inbox.person(id, 'security.two_step_changed', {
      subject: `admin_authenticator_reset:${Date.now()}`,
      title: 'Your authenticator app was reset',
      body: 'A super admin reset your authenticator and signed you out. If you did not request this, contact a super admin.',
      link: '/account',
    });
    return present({ ...member, totp: null });
  }

  async suspend(actorId: string, id: string, reason: string) {
    this.requireOther(actorId, id);
    const updated = await this.changeAccess(async tx => {
      const member = await this.member(id, tx);
      await this.keepSuperAdmin(member, tx);
      const updated = await tx.user.update({ where: { id }, data: { status: 'disabled' }, include: includeAuthenticator });
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      return updated;
    });
    await this.audit.record({ actorId, action: 'admin.suspended', targetType: 'user', targetId: id, after: { reason } });
    return present(updated);
  }

  async restore(actorId: string, id: string, reason: string) {
    await this.member(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: 'active', failedSignIns: 0, lockedUntil: null },
      include: includeAuthenticator,
    });
    await this.audit.record({ actorId, action: 'admin.restored', targetType: 'user', targetId: id, after: { reason } });
    return present(updated);
  }

  private async member(id: string, db: Prisma.TransactionClient = this.prisma) {
    const member = await db.user.findFirst({ where: { id, realm }, include: includeAuthenticator });
    if (!member) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No admin has that ID.');
    return member;
  }

  private checkRoles(roles: string[]) {
    const unique = [...new Set(roles)];
    if (!unique.length || unique.some(role => !(adminRoles as readonly string[]).includes(role))) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Choose one or more admin roles.', 'roles');
    }
    return unique;
  }

  private requireOther(actorId: string, id: string) {
    if (actorId === id) throw conflict('not_yourself', 'Ask another super admin to do this.');
  }

  private async keepSuperAdmin(member: User, tx: Prisma.TransactionClient) {
    if (member.status !== 'active' || !member.passwordHash || !member.adminRoles.includes('super_admin')) return;
    const other = await tx.user.findFirst({
      where: { id: { not: member.id }, realm, status: 'active', passwordHash: { not: null }, adminRoles: { has: 'super_admin' } },
      select: { id: true },
    });
    if (!other) throw conflict('last_super_admin', 'Keep at least one active super admin with a password set.');
  }

  /** Serialize the super-admin check with the role or status change so concurrent changes cannot remove everyone. */
  private async changeAccess<T>(change: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(change, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (attempt === 3 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }
  }
}
