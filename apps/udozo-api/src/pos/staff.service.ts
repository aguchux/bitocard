import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { normalisePhone } from '../auth/auth.service.js';
import { PasswordsService } from '../auth/passwords.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { SmsService } from '../notifications/sms.service.js';
import type { PosBy } from './actor.js';
import { limitsOf } from './plans.js';
import {
  allowedLines,
  managesRole,
  permissionGroups,
  permissionSet,
  permissionsProblem,
  posPermissions,
  type PosPermission,
  type ResolvedRole,
  type SystemRoleKey,
  systemRoleKeys,
  systemRoles,
  weakPin,
} from './permissions.js';

export { ownerBy, type PosBy } from './actor.js';

/**
 * Who is managing staff, roles, tills or devices: the owner (`role` null), or a member of staff whose role allows it
 * (a manager: cashiers only; settings for tills and devices).
 */
export type PosManager = { accountId: string; by: PosBy; role: ResolvedRole | null };

/** A member of staff signed in, as `PosGuard` finds them. */
export type PosStaffContext = {
  sessionId: string;
  deviceId: string | null;
  /** The till the session is at: a linked device's, or the one chosen at web sign-in (null: any they may use). */
  tillId: string | null;
  staff: { id: string; name: string; firstName: string };
  role: ResolvedRole;
  /** The tills they may use: every till of the account, or these. */
  tills: 'all' | string[];
  account: { id: string; customerId: string; country: string; currency: string; mode: 'live' | 'test' };
  owner: CustomerWithStore;
  by: PosBy;
};

/** A manager's PIN given at the till, for an action the member of staff may only do with approval. */
export type ApprovalInput = { staff_id: string; pin: string };

export const staffSessionHeader = 'udozo-pos-session';
export const deviceHeader = 'udozo-pos-device';
export const inviteHours = 48;
export const idleHours = 12;
export const pinTries = 5;
export const lockMinutes = 15;
const linkCodeMinutes = 10;
const touchEveryMs = 60_000;
const codeAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const forbidden = (code: string, message: string, param?: string) => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', code, message, param);
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `There is no such ${what} on this Udozo POS account.`);
const badPin = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'invalid_credentials', 'The shop code, phone number or PIN is not right.');
const locked = () => new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'pin_locked', `Too many wrong PINs. Try again in ${lockMinutes} minutes, or ask a manager to reset your PIN.`);
const inviteGone = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'invite_invalid', 'This invite has been used, replaced or has expired. Ask the shop for a new one.');

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);
const text = (value: string | null | undefined, max: number) => (value?.trim() ? value.trim().slice(0, max) : null);
const fullName = (staff: { firstName: string; lastName: string }) => `${staff.firstName} ${staff.lastName}`.trim();
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]!.toUpperCase())
    .join('');
const maskPhone = (phone: string) => `${phone.slice(0, Math.max(4, phone.length - 7))} •••• ${phone.slice(-3)}`;

/** A device link code: 8 letters and digits that cannot be misread, shown as `4F7K-29QX`. */
export function linkCode() {
  const raw = Array.from({ length: 8 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
const codeKey = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

const staffInclude = { tills: { include: { till: { select: { id: true, name: true, shopId: true } } } }, role: true } satisfies Prisma.PosStaffInclude;
type StaffRow = Prisma.PosStaffGetPayload<{ include: typeof staffInclude }>;
export type StaffFields = {
  first_name: string;
  last_name: string;
  phone: string;
  email?: string | null;
  /** A fixed role's key (`manager`, `cashier`, `stock_keeper`, `accountant`) or a custom role's id. */
  role: string;
  till_ids?: string[];
  all_tills?: boolean;
  mobile?: boolean;
};
export type RoleFields = { name: string; description?: string | null; permissions: Record<string, unknown>; discount_limit_bps?: number | null };

/**
 * Udozo POS's staff (docs/UDOZO_POS_PLAN.md, milestone 5): the owner's roles, inviting staff by SMS or WhatsApp to set
 * a PIN, signing in with the shop code, phone and PIN (or a name tile and PIN on a linked till), five wrong PINs locking
 * for 15 minutes, sessions ending after 12 hours idle, linking tills' devices with a one-time code, and a manager's PIN
 * for what a role may only do with approval. A staff session never reaches the owner's Udozo account (`PosGuard`).
 */
@Injectable()
export class PosStaffService {
  private readonly logger = new Logger('PosStaff');

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordsService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ---- Roles ----

  /** A staff member's role, worked out from its fixed key or the owner's own role. */
  resolveRole(row: { roleKey: string | null; role: { id: string; name: string; description: string | null; permissions: unknown; discountLimitBps: number | null } | null }): ResolvedRole {
    if (row.roleKey && (systemRoleKeys as string[]).includes(row.roleKey)) return { ...systemRoles[row.roleKey as SystemRoleKey], id: null };
    if (row.role) return { key: null, id: row.role.id, name: row.role.name, description: row.role.description, permissions: permissionSet(row.role.permissions), discountLimitBps: row.role.discountLimitBps, system: false };
    return { key: null, id: null, name: 'No role', description: null, permissions: permissionSet({}), discountLimitBps: 0, system: false };
  }

  /** A role by what was sent: a fixed role's key or one of the account's own role ids. */
  private async roleFor(accountId: string, value: string) {
    if ((systemRoleKeys as string[]).includes(value)) return { roleKey: value, roleId: null, resolved: { ...systemRoles[value as SystemRoleKey], id: null } as ResolvedRole };
    const role = /^[0-9a-f-]{36}$/i.test(value) ? await this.prisma.posRole.findFirst({ where: { id: value, accountId } }) : null;
    if (!role) throw invalid('parameter_invalid', 'Choose one of your roles.', 'role');
    return { roleKey: null, roleId: role.id, resolved: this.resolveRole({ roleKey: null, role }) };
  }

  async roles(accountId: string) {
    const custom = await this.prisma.posRole.findMany({ where: { accountId }, orderBy: { createdAt: 'asc' }, include: { _count: { select: { staff: { where: { status: { not: 'removed' } } } } } } });
    const counts = await this.prisma.posStaff.groupBy({ by: ['roleKey'], where: { accountId, roleKey: { not: null }, status: { not: 'removed' } }, _count: { _all: true } });
    const countOf = (key: string) => counts.find(row => row.roleKey === key)?._count._all ?? 0;
    return {
      object: 'list' as const,
      permissions: permissionGroups.map(group => ({ group: group.group, items: group.items.map(item => ({ key: item.key, label: item.label })) })),
      data: [
        ...systemRoleKeys.map(key => this.presentRole({ ...systemRoles[key], id: null }, countOf(key))),
        ...custom.map(row => this.presentRole(this.resolveRole({ roleKey: null, role: row }), row._count.staff)),
      ],
    };
  }

  private presentRole(role: ResolvedRole, staff: number) {
    return {
      object: 'pos_role' as const,
      id: role.id ?? role.key,
      key: role.key,
      name: role.name,
      description: role.description,
      system: role.system,
      permissions: role.permissions,
      discount_limit_bps: role.discountLimitBps,
      staff,
    };
  }

  private roleData(input: RoleFields) {
    const name = text(input.name, 40);
    if (!name) throw invalid('parameter_missing', 'Name the role.', 'name');
    if (Object.values(systemRoles).some(role => role.name.toLowerCase() === name.toLowerCase()) || name.toLowerCase() === 'owner') throw conflict('role_exists', `${name} is one of the fixed roles: choose another name.`, 'name');
    const problem = permissionsProblem(input.permissions);
    if (problem) throw invalid('parameter_invalid', problem.message, problem.param);
    const limit = input.discount_limit_bps ?? null;
    if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 10_000)) throw invalid('parameter_invalid', 'A discount limit is 0% to 100%, or none for any amount.', 'discount_limit_bps');
    return { name, description: text(input.description, 200), permissions: permissionSet(input.permissions) as Prisma.InputJsonObject, discountLimitBps: limit };
  }

  async createRole(owner: PosManager, input: RoleFields) {
    const data = this.roleData(input);
    try {
      const row = await this.prisma.posRole.create({ data: { accountId: owner.accountId, ...data } });
      await this.audit.record({ actorId: null, action: 'pos.role_created', targetType: 'pos_role', targetId: row.id, after: { by: owner.by.name, ...data } });
      return this.presentRole(this.resolveRole({ roleKey: null, role: row }), 0);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('role_exists', `You already have a role called ${data.name}.`, 'name');
      throw error;
    }
  }

  async updateRole(owner: PosManager, id: string, input: RoleFields) {
    const before = await this.prisma.posRole.findFirst({ where: { id, accountId: owner.accountId } });
    if (!before) throw notFound('role');
    const data = this.roleData(input);
    try {
      const row = await this.prisma.posRole.update({ where: { id }, data });
      await this.audit.record({ actorId: null, action: 'pos.role_changed', targetType: 'pos_role', targetId: id, before: { name: before.name, permissions: before.permissions, discount_limit_bps: before.discountLimitBps }, after: { by: owner.by.name, ...data } });
      const staff = await this.prisma.posStaff.count({ where: { roleId: id, status: { not: 'removed' } } });
      return this.presentRole(this.resolveRole({ roleKey: null, role: row }), staff);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('role_exists', `You already have a role called ${data.name}.`, 'name');
      throw error;
    }
  }

  async deleteRole(owner: PosManager, id: string) {
    const role = await this.prisma.posRole.findFirst({ where: { id, accountId: owner.accountId } });
    if (!role) throw notFound('role');
    const using = await this.prisma.posStaff.count({ where: { roleId: id } });
    if (using) throw conflict('role_in_use', `${using === 1 ? 'Someone has' : `${using} people have`} this role (removed staff included, so their history keeps it): give them another role first.`);
    await this.prisma.posRole.delete({ where: { id } });
    await this.audit.record({ actorId: null, action: 'pos.role_deleted', targetType: 'pos_role', targetId: id, before: { name: role.name }, after: { by: owner.by.name } });
  }

  // ---- Staff ----

  private async account(accountId: string) {
    return this.prisma.posAccount.findUniqueOrThrow({ where: { id: accountId }, include: { plan: true, shops: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { tills: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } } } } });
  }

  async list(accountId: string) {
    const [rows, account] = await Promise.all([
      this.prisma.posStaff.findMany({ where: { accountId, status: { not: 'removed' } }, include: staffInclude, orderBy: [{ createdAt: 'asc' }] }),
      this.account(accountId),
    ]);
    const limit = limitsOf(account.plan).staff;
    return { object: 'list' as const, limit, used: rows.length, data: rows.map(row => this.present(row)) };
  }

  async get(manager: PosManager, id: string) {
    return this.present(await this.member(manager, id));
  }

  /** One of the account's staff that `manager` may manage (a manager: cashiers only), else not found or refused. */
  private async member(manager: PosManager, id: string) {
    const row = await this.prisma.posStaff.findFirst({ where: { id, accountId: manager.accountId, status: { not: 'removed' } }, include: staffInclude });
    if (!row) throw notFound('member of staff');
    if (manager.role && !managesRole(manager.role, { key: row.roleKey })) throw forbidden('pos_permission_required', 'Only the shop owner manages this member of staff.');
    return row;
  }

  present(row: StaffRow) {
    const role = this.resolveRole(row);
    return {
      object: 'pos_staff' as const,
      id: row.id,
      first_name: row.firstName,
      last_name: row.lastName,
      name: fullName(row),
      initials: initials(fullName(row)),
      phone: row.phone,
      phone_hint: maskPhone(row.phone),
      email: row.email,
      role: { id: role.id ?? role.key, key: role.key, name: role.name },
      all_tills: row.allTills,
      tills: row.tills.map(item => ({ id: item.till.id, name: item.till.name, shop_id: item.till.shopId })),
      mobile: row.mobile,
      status: row.status,
      pin_set: Boolean(row.pinHash),
      locked_until: row.lockedUntil && row.lockedUntil > new Date() ? row.lockedUntil.toISOString() : null,
      last_active_at: iso(row.lastActiveAt),
      invited_by: row.invitedByName,
      created_at: row.createdAt.toISOString(),
    };
  }

  /** Checks the tills sent are the account's; `all_tills` wins. */
  private async tillsFor(accountId: string, input: Pick<StaffFields, 'till_ids' | 'all_tills'>) {
    if (input.all_tills) return [];
    const ids = [...new Set(input.till_ids ?? [])];
    if (!ids.length) throw invalid('parameter_missing', 'Choose the tills they may use, or all tills.', 'till_ids');
    const found = await this.prisma.posTill.count({ where: { id: { in: ids }, shop: { accountId } } });
    if (found !== ids.length) throw invalid('parameter_invalid', 'Choose your own tills.', 'till_ids');
    return ids;
  }

  /**
   * Invites a member of staff to set their PIN: by SMS (sent here, through the market's SMS provider), WhatsApp (the
   * owner sends the message from their own phone with `whatsapp_url`) or a link they copy. Within the plan's staff limit.
   */
  async invite(manager: PosManager, input: StaffFields & { send_via: 'sms' | 'whatsapp' | 'link' }) {
    const account = await this.account(manager.accountId);
    const firstName = text(input.first_name, 60);
    const lastName = text(input.last_name, 60);
    if (!firstName) throw invalid('parameter_missing', 'Give their first name.', 'first_name');
    if (!lastName) throw invalid('parameter_missing', 'Give their last name.', 'last_name');
    const phone = normalisePhone(input.phone, account.country);
    const role = await this.roleFor(account.id, input.role);
    if (manager.role && !managesRole(manager.role, { key: role.roleKey })) throw forbidden('pos_permission_required', 'You may invite cashiers only.', 'role');
    const tillIds = await this.tillsFor(account.id, input);
    const limit = limitsOf(account.plan).staff;
    const used = await this.prisma.posStaff.count({ where: { accountId: account.id, status: { not: 'removed' } } });
    if (limit !== null && used >= limit) throw conflict('plan_limit_reached', `${account.plan.name} allows ${limit} member${limit === 1 ? '' : 's'} of staff: change plan to invite more.`);

    let row: StaffRow;
    try {
      row = await this.prisma.posStaff.create({
        data: {
          accountId: account.id,
          firstName,
          lastName,
          phone,
          email: text(input.email, 254),
          roleKey: role.roleKey,
          roleId: role.roleId,
          allTills: Boolean(input.all_tills),
          mobile: Boolean(input.mobile),
          invitedByName: manager.by.name.slice(0, 120),
          tills: { create: tillIds.map(tillId => ({ tillId })) },
        },
        include: staffInclude,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('staff_exists', 'Someone with this phone number is on your staff already.', 'phone');
      throw error;
    }
    await this.audit.record({ actorId: null, action: 'pos.staff_invited', targetType: 'pos_staff', targetId: row.id, after: { by: manager.by.name, role: role.resolved.name } });
    const invite = await this.sendInvite(row, account, input.send_via, manager.by.name);
    return { ...this.present(row), invite };
  }

  /** A new invite (the last one stops working): to someone still invited, or a PIN reset for someone signed in before. */
  async resend(manager: PosManager, id: string, sendVia: 'sms' | 'whatsapp' | 'link') {
    const row = await this.member(manager, id);
    if (row.status === 'suspended') throw conflict('staff_suspended', 'Restore them before sending a new invite.');
    const account = await this.account(manager.accountId);
    const reset = row.status === 'active';
    if (reset) {
      // A PIN reset: the old PIN stops working, and every till they were signed in on signs them out.
      await this.prisma.posStaff.update({ where: { id }, data: { status: 'invited', pinHash: null, failedTries: 0, lockedUntil: null } });
      await this.endSessions({ staffId: id }, 'pin_reset');
      await this.audit.record({ actorId: null, action: 'pos.staff_pin_reset', targetType: 'pos_staff', targetId: id, after: { by: manager.by.name } });
    }
    const invite = await this.sendInvite(row, account, sendVia, manager.by.name, reset);
    return { ...this.present(await this.prisma.posStaff.findUniqueOrThrow({ where: { id }, include: staffInclude })), invite };
  }

  private async sendInvite(row: StaffRow, account: Awaited<ReturnType<PosStaffService['account']>>, sendVia: 'sms' | 'whatsapp' | 'link', invitedBy: string, reset = false) {
    const token = `upi_${randomToken()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + inviteHours * 3_600_000);
    await this.prisma.$transaction([
      this.prisma.posInvite.updateMany({ where: { staffId: row.id, usedAt: null, replacedAt: null }, data: { replacedAt: now } }),
      this.prisma.posInvite.create({ data: { staffId: row.id, tokenHash: sha256(token), sentVia: sendVia, expiresAt } }),
    ]);
    const url = `${this.config.POS_URL}/invite#t=${token}`;
    const shop = account.shops[0];
    const message = reset
      ? `${shop?.name ?? 'Your shop'}: set a new 4-digit PIN for Udozo POS (shop code ${shop?.shopCode ?? ''}). This link works for ${inviteHours} hours: ${url}`
      : `${invitedBy} invited you to sell at ${shop?.name ?? 'their shop'} on Udozo POS. Set your 4-digit PIN (shop code ${shop?.shopCode ?? ''}). This link works for ${inviteHours} hours: ${url}`;
    let sent = false;
    if (sendVia === 'sms') {
      try {
        await this.sms.sendForCountry(account.country, { to: row.phone, text: message });
        sent = true;
      } catch (error) {
        // The invite still stands: the owner shares the link another way.
        this.logger.warn(`An invite text was not sent: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      url,
      expires_at: expiresAt.toISOString(),
      sent_via: sendVia,
      sent,
      message,
      whatsapp_url: `https://wa.me/${row.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`,
      shop_code: shop?.shopCode ?? null,
    };
  }

  async update(manager: PosManager, id: string, input: Partial<StaffFields>) {
    const row = await this.member(manager, id);
    const account = await this.account(manager.accountId);
    const data: Prisma.PosStaffUpdateInput = {};
    if (input.first_name !== undefined) {
      const value = text(input.first_name, 60);
      if (!value) throw invalid('parameter_missing', 'Give their first name.', 'first_name');
      data.firstName = value;
    }
    if (input.last_name !== undefined) {
      const value = text(input.last_name, 60);
      if (!value) throw invalid('parameter_missing', 'Give their last name.', 'last_name');
      data.lastName = value;
    }
    if (input.phone !== undefined) data.phone = normalisePhone(input.phone, account.country);
    if (input.email !== undefined) data.email = text(input.email, 254);
    if (input.mobile !== undefined) data.mobile = input.mobile;
    if (input.role !== undefined) {
      const role = await this.roleFor(account.id, input.role);
      if (manager.role && !managesRole(manager.role, { key: role.roleKey })) throw forbidden('pos_permission_required', 'You may give the cashier role only.', 'role');
      data.roleKey = role.roleKey;
      data.role = role.roleId ? { connect: { id: role.roleId } } : { disconnect: true };
    }
    const changesTills = input.all_tills !== undefined || input.till_ids !== undefined;
    const tillIds = changesTills ? await this.tillsFor(account.id, { all_tills: input.all_tills ?? row.allTills, till_ids: input.till_ids ?? row.tills.map(item => item.tillId) }) : null;
    if (changesTills) data.allTills = Boolean(input.all_tills ?? row.allTills);
    try {
      await this.prisma.$transaction(async tx => {
        await tx.posStaff.update({ where: { id }, data });
        if (tillIds) {
          await tx.posStaffTill.deleteMany({ where: { staffId: id } });
          if (tillIds.length) await tx.posStaffTill.createMany({ data: tillIds.map(tillId => ({ staffId: id, tillId })) });
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('staff_exists', 'Someone with this phone number is on your staff already.', 'phone');
      throw error;
    }
    // A new role or fewer tills takes effect now: their sessions end so the next sign-in has it.
    if (input.role !== undefined || changesTills) await this.endSessions({ staffId: id }, 'changed');
    await this.audit.record({ actorId: null, action: 'pos.staff_changed', targetType: 'pos_staff', targetId: id, before: { role: this.resolveRole(row).name, all_tills: row.allTills }, after: { by: manager.by.name, ...input, phone: undefined } });
    return this.present(await this.prisma.posStaff.findUniqueOrThrow({ where: { id }, include: staffInclude }));
  }

  /** Suspends (signed out everywhere at once; restored later), restores, or removes (kept, so their sales keep their name). */
  async setStatus(manager: PosManager, id: string, action: 'suspend' | 'restore' | 'remove') {
    const row = await this.member(manager, id);
    const now = new Date();
    if (action === 'restore') {
      if (row.status !== 'suspended') throw conflict('staff_not_suspended', `${fullName(row)} is not suspended.`);
      await this.prisma.posStaff.update({ where: { id }, data: { status: row.pinHash ? 'active' : 'invited', failedTries: 0, lockedUntil: null } });
    } else {
      if (action === 'suspend' && row.status === 'suspended') throw conflict('staff_suspended', `${fullName(row)} is suspended already.`);
      await this.prisma.posStaff.update({ where: { id }, data: action === 'suspend' ? { status: 'suspended' } : { status: 'removed', removedAt: now, pinHash: null } });
      await this.prisma.posInvite.updateMany({ where: { staffId: id, usedAt: null, replacedAt: null }, data: { replacedAt: now } });
      await this.endSessions({ staffId: id }, action === 'suspend' ? 'suspended' : 'removed');
    }
    await this.audit.record({ actorId: null, action: `pos.staff_${action === 'suspend' ? 'suspended' : action === 'restore' ? 'restored' : 'removed'}`, targetType: 'pos_staff', targetId: id, after: { by: manager.by.name } });
    return this.present(await this.prisma.posStaff.findUniqueOrThrow({ where: { id }, include: staffInclude }));
  }

  // ---- Invites ----

  private async inviteRow(token: string) {
    const invite = typeof token === 'string' && token.startsWith('upi_') ? await this.prisma.posInvite.findUnique({ where: { tokenHash: sha256(token) }, include: { staff: { include: { ...staffInclude, account: { include: { shops: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { tills: { select: { id: true, name: true } } } } } } } } } }) : null;
    if (!invite || invite.usedAt || invite.replacedAt || invite.expiresAt <= new Date() || !['invited'].includes(invite.staff.status)) throw inviteGone();
    return invite;
  }

  /** What the invite page shows: whose shop, the role and what it allows, the tills, who invited them. Never the phone. */
  async inviteInfo(token: string) {
    const invite = await this.inviteRow(token);
    const { staff } = invite;
    const role = this.resolveRole(staff);
    const shop = staff.account.shops[0];
    const tills = staff.allTills ? staff.account.shops.flatMap(item => item.tills) : staff.tills.map(item => ({ id: item.till.id, name: item.till.name }));
    return {
      object: 'pos_invite' as const,
      first_name: staff.firstName,
      shop: { name: shop?.name ?? null, shop_code: shop?.shopCode ?? null },
      role: { name: role.name, allows: allowedLines(role) },
      tills: staff.allTills ? 'all' : tills.map(till => till.name),
      invited_by: staff.invitedByName,
      reset: Boolean(staff.pinSetAt),
      expires_at: invite.expiresAt.toISOString(),
    };
  }

  /** Sets the PIN the invite asked for and signs them in on the web (no till chosen yet). */
  async acceptInvite(token: string, pin: string) {
    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw invalid('parameter_invalid', 'Your PIN is 4 digits.', 'pin');
    if (weakPin(pin)) throw invalid('pin_too_easy', 'Choose a PIN that is harder to guess: not 1234, one digit four times or a year.', 'pin');
    const invite = await this.inviteRow(token);
    const now = new Date();
    const pinHash = await this.passwords.hash(pin);
    const claimed = await this.prisma.posInvite.updateMany({ where: { id: invite.id, usedAt: null, replacedAt: null }, data: { usedAt: now } });
    if (!claimed.count) throw inviteGone();
    await this.prisma.posStaff.update({ where: { id: invite.staffId }, data: { status: 'active', pinHash, pinSetAt: now, failedTries: 0, lockedUntil: null } });
    await this.audit.record({ actorId: null, action: 'pos.staff_pin_set', targetType: 'pos_staff', targetId: invite.staffId, after: { reset: Boolean(invite.staff.pinSetAt) } });
    return this.openSession(invite.staff.accountId, invite.staffId, { deviceId: null, tillId: null });
  }

  // ---- PINs ----

  /**
   * Checks a member of staff's PIN, counting each try before it is compared, in one statement, so parallel guesses never
   * get past five: the fifth wrong PIN locks them for 15 minutes. A right PIN clears the count.
   */
  async checkPin(staff: { id: string; pinHash: string | null }, pin: string) {
    const now = new Date();
    const lockEnd = new Date(now.getTime() + lockMinutes * 60_000);
    const claimed = await this.prisma.$queryRaw<Array<{ tries: number }>>`
      UPDATE "pos_staff" SET
        "failed_tries" = CASE WHEN "locked_until" IS NOT NULL AND "locked_until" <= ${now} THEN 1 ELSE "failed_tries" + 1 END,
        "locked_until" = CASE WHEN (CASE WHEN "locked_until" IS NOT NULL AND "locked_until" <= ${now} THEN 1 ELSE "failed_tries" + 1 END) >= ${pinTries} THEN CAST(${lockEnd} AS TIMESTAMP(3)) ELSE NULL END
      WHERE "id" = ${staff.id}::uuid AND ("locked_until" IS NULL OR "locked_until" <= ${now})
      RETURNING "failed_tries" AS "tries"`;
    if (!claimed.length) throw locked();
    const ok = await this.passwords.verify(staff.pinHash, pin);
    if (!ok) return false;
    await this.prisma.posStaff.update({ where: { id: staff.id }, data: { failedTries: 0, lockedUntil: null } });
    return true;
  }

  // ---- Signing in ----

  /** Staff on the web: the shop code, their phone and PIN, and optionally the till they sell at. */
  async signIn(input: { shop_code: string; phone: string; pin: string; till_id?: string | null }) {
    const shop = typeof input.shop_code === 'string' ? await this.prisma.posShop.findUnique({ where: { shopCode: input.shop_code.trim().toUpperCase() }, include: { account: true } }) : null;
    let phone: string | null = null;
    try {
      phone = shop ? normalisePhone(input.phone ?? '', shop.account.country) : null;
    } catch {
      phone = null;
    }
    const staff = shop && phone ? await this.prisma.posStaff.findFirst({ where: { accountId: shop.accountId, phone, status: 'active' }, include: staffInclude }) : null;
    if (!staff) {
      await this.passwords.verify(null, input.pin ?? '');
      throw badPin();
    }
    if (!(await this.checkPin(staff, input.pin ?? ''))) throw badPin();
    const tillId = input.till_id ? await this.tillAllowed(staff, input.till_id) : null;
    return this.openSession(staff.accountId, staff.id, { deviceId: null, tillId });
  }

  /** The till, if they may use it (one of the account's, and theirs unless they have every till). */
  private async tillAllowed(staff: { accountId: string; allTills: boolean; tills: Array<{ tillId: string }> }, tillId: string) {
    const till = await this.prisma.posTill.findFirst({ where: { id: tillId, shop: { accountId: staff.accountId } }, select: { id: true } });
    if (!till || (!staff.allTills && !staff.tills.some(item => item.tillId === tillId))) throw forbidden('till_not_allowed', 'You may not use this till: ask the shop owner.', 'till_id');
    return till.id;
  }

  private async openSession(accountId: string, staffId: string, at: { deviceId: string | null; tillId: string | null }) {
    const token = `ups_${randomToken()}`;
    const now = new Date();
    await this.prisma.posStaffSession.create({ data: { accountId, staffId, deviceId: at.deviceId, tillId: at.tillId, tokenHash: sha256(token), lastSeenAt: now } });
    await this.prisma.posStaff.update({ where: { id: staffId }, data: { lastActiveAt: now } });
    const staff = await this.prisma.posStaff.findUniqueOrThrow({ where: { id: staffId }, include: staffInclude });
    return { object: 'pos_staff_session' as const, session: { token, idle_hours: idleHours }, staff: this.present(staff), till_id: at.tillId };
  }

  async signOut(sessionId: string) {
    await this.prisma.posStaffSession.updateMany({ where: { id: sessionId, endedAt: null }, data: { endedAt: new Date(), endedReason: 'signed_out' } });
  }

  private async endSessions(where: Prisma.PosStaffSessionWhereInput, reason: string) {
    await this.prisma.posStaffSession.updateMany({ where: { ...where, endedAt: null }, data: { endedAt: new Date(), endedReason: reason } });
  }

  /**
   * The member of staff a session token belongs to, or null: never ended, used within 12 hours, its member of staff
   * active and its device (if any) still linked. Used by `PosGuard` only.
   */
  async resolve(token: string, owners: (customerId: string) => Promise<CustomerWithStore | null>): Promise<PosStaffContext | null> {
    if (typeof token !== 'string' || !token.startsWith('ups_')) return null;
    const session = await this.prisma.posStaffSession.findUnique({ where: { tokenHash: sha256(token) }, include: { staff: { include: staffInclude }, device: { select: { revokedAt: true, tillId: true } }, account: true } });
    if (!session || session.endedAt) return null;
    const now = new Date();
    if (now.getTime() - session.lastSeenAt.getTime() > idleHours * 3_600_000) {
      await this.endSessions({ id: session.id }, 'idle');
      return null;
    }
    if (session.staff.status !== 'active' || (session.device && session.device.revokedAt)) return null;
    const owner = await owners(session.account.customerId);
    if (!owner) return null;
    if (now.getTime() - session.lastSeenAt.getTime() > touchEveryMs) {
      await this.prisma.posStaffSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
      await this.prisma.posStaff.update({ where: { id: session.staffId }, data: { lastActiveAt: now } });
      if (session.deviceId) await this.prisma.posDevice.update({ where: { id: session.deviceId }, data: { lastSeenAt: now } });
    }
    const name = fullName(session.staff);
    return {
      sessionId: session.id,
      deviceId: session.deviceId,
      tillId: session.device?.tillId ?? session.tillId,
      staff: { id: session.staff.id, name, firstName: session.staff.firstName },
      role: this.resolveRole(session.staff),
      tills: session.staff.allTills ? 'all' : session.staff.tills.map(item => item.tillId),
      account: { id: session.account.id, customerId: session.account.customerId, country: session.account.country, currency: session.account.currency, mode: session.account.mode },
      owner,
      by: { customerId: null, staffId: session.staff.id, name },
    };
  }

  // ---- Devices ----

  /** A one-time code (10 minutes) that links a device to a till: typed or scanned on the device. */
  async linkCode(manager: PosManager, tillId: string) {
    const till = await this.prisma.posTill.findFirst({ where: { id: tillId, shop: { accountId: manager.accountId } }, include: { shop: { select: { name: true } } } });
    if (!till) throw notFound('till');
    const code = linkCode();
    const expiresAt = new Date(Date.now() + linkCodeMinutes * 60_000);
    // Codes nobody used are dropped, so a till has at most a few waiting.
    await this.prisma.posDevice.deleteMany({ where: { accountId: manager.accountId, tokenHash: null, codeExpiresAt: { lt: new Date() } } });
    const device = await this.prisma.posDevice.create({ data: { accountId: manager.accountId, tillId, codeHash: sha256(codeKey(code)), codeExpiresAt: expiresAt, createdByName: manager.by.name.slice(0, 120) } });
    return { object: 'pos_link_code' as const, device_id: device.id, code, expires_at: expiresAt.toISOString(), till: { id: till.id, name: till.name }, shop: till.shop.name, link_url: `${this.config.POS_URL}/link#c=${code}` };
  }

  /** The device (a browser or the app) redeems the code once for its own token, scoped to the till's shop. */
  async link(input: { code: string; name?: string | null; platform?: string | null }) {
    const key = typeof input.code === 'string' ? codeKey(input.code) : '';
    const token = `upd_${randomToken()}`;
    const now = new Date();
    const platform = input.platform && ['web', 'windows', 'android', 'ios'].includes(input.platform) ? input.platform : 'web';
    const claimed = key.length === 8 ? await this.prisma.posDevice.updateMany({ where: { codeHash: sha256(key), tokenHash: null, revokedAt: null, codeExpiresAt: { gt: now } }, data: { tokenHash: sha256(token), codeHash: null, linkedAt: now, lastSeenAt: now, name: text(input.name, 60), platform } }) : { count: 0 };
    if (!claimed.count) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'link_code_invalid', 'This code has been used or has expired. Make a new one in Settings > Shops & tills.');
    const device = await this.prisma.posDevice.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    return { object: 'pos_device_link' as const, token, device: await this.deviceInfo(device.id) };
  }

  /** A linked device by its token, else null. */
  async device(token: string | undefined) {
    if (typeof token !== 'string' || !token.startsWith('upd_')) return null;
    const device = await this.prisma.posDevice.findUnique({ where: { tokenHash: sha256(token) } });
    if (!device || device.revokedAt || !device.linkedAt) return null;
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > touchEveryMs) await this.prisma.posDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    return device;
  }

  /** What a linked till shows before anyone signs in: the shop, the till, and the tiles of who may sell there. */
  async deviceInfo(deviceId: string) {
    const device = await this.prisma.posDevice.findUniqueOrThrow({ where: { id: deviceId }, include: { till: { include: { shop: true } } } });
    const staff = await this.prisma.posStaff.findMany({ where: { accountId: device.accountId, status: 'active', OR: [{ allTills: true }, { tills: { some: { tillId: device.tillId } } }] }, include: staffInclude, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }] });
    return {
      object: 'pos_device' as const,
      id: device.id,
      name: device.name,
      shop: { id: device.till.shop.id, name: device.till.shop.name, shop_code: device.till.shop.shopCode },
      till: { id: device.till.id, name: device.till.name },
      staff: staff.map(row => {
        const role = this.resolveRole(row);
        return { id: row.id, name: fullName(row), first_name: row.firstName, initials: initials(fullName(row)), role: role.name, locked: Boolean(row.lockedUntil && row.lockedUntil > new Date()) };
      }),
    };
  }

  /** A name tile and PIN on a linked till: a session at that till. */
  async deviceSignIn(deviceId: string, input: { staff_id: string; pin: string }) {
    const device = await this.prisma.posDevice.findUniqueOrThrow({ where: { id: deviceId } });
    const staff = /^[0-9a-f-]{36}$/i.test(input.staff_id ?? '') ? await this.prisma.posStaff.findFirst({ where: { id: input.staff_id, accountId: device.accountId, status: 'active' }, include: staffInclude }) : null;
    if (!staff) {
      await this.passwords.verify(null, input.pin ?? '');
      throw badPin();
    }
    if (!(await this.checkPin(staff, input.pin ?? ''))) throw badPin();
    if (!staff.allTills && !staff.tills.some(item => item.tillId === device.tillId)) throw forbidden('till_not_allowed', 'You may not use this till: ask the shop owner.');
    return this.openSession(device.accountId, staff.id, { deviceId: device.id, tillId: device.tillId });
  }

  async devices(accountId: string) {
    const rows = await this.prisma.posDevice.findMany({ where: { accountId, linkedAt: { not: null } }, include: { till: { select: { id: true, name: true } } }, orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { linkedAt: 'desc' }] });
    return {
      object: 'list' as const,
      data: rows.map(row => ({ object: 'pos_device' as const, id: row.id, name: row.name, platform: row.platform, till: row.till, linked_at: iso(row.linkedAt), last_seen_at: iso(row.lastSeenAt), revoked_at: iso(row.revokedAt), linked_by: row.createdByName })),
    };
  }

  /** Unlinks a device: it can sell nothing more, and everyone signed in on it is signed out at once. */
  async unlink(manager: PosManager, deviceId: string) {
    const device = await this.prisma.posDevice.findFirst({ where: { id: deviceId, accountId: manager.accountId } });
    if (!device) throw notFound('device');
    if (!device.revokedAt) {
      await this.prisma.posDevice.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });
      await this.endSessions({ deviceId }, 'device_unlinked');
      await this.audit.record({ actorId: null, action: 'pos.device_unlinked', targetType: 'pos_device', targetId: deviceId, after: { by: manager.by.name } });
    }
    return (await this.devices(manager.accountId)).data.find(row => row.id === deviceId)!;
  }

  // ---- Approval ----

  /**
   * A manager's PIN given at the till for `action`: the approver is another active member of staff of the account who
   * may use that till and whose role does it outright (`allows`). Their PIN counts towards their own lockout. Recorded
   * once the action is done (`recordApproval`).
   */
  async approver(context: PosStaffContext, approval: ApprovalInput | undefined, tillId: string | null, allows: (role: ResolvedRole) => boolean, what: string) {
    if (!approval?.staff_id || !approval.pin) throw forbidden('approval_required', `${what} needs a manager's approval: ask them to enter their PIN.`, 'approval');
    const approver = /^[0-9a-f-]{36}$/i.test(approval.staff_id) ? await this.prisma.posStaff.findFirst({ where: { id: approval.staff_id, accountId: context.account.id, status: 'active' }, include: staffInclude }) : null;
    if (!approver || approver.id === context.staff.id) throw forbidden('approval_invalid', 'Someone else, who may do this, must approve it.', 'approval.staff_id');
    if (!(await this.checkPin(approver, approval.pin))) throw forbidden('approval_invalid', 'That PIN is not right.', 'approval.pin');
    const role = this.resolveRole(approver);
    if (!allows(role)) throw forbidden('approval_invalid', `${fullName(approver)} may not approve this.`, 'approval.staff_id');
    if (tillId && !approver.allTills && !approver.tills.some(item => item.tillId === tillId)) throw forbidden('approval_invalid', `${fullName(approver)} does not work at this till.`, 'approval.staff_id');
    return { id: approver.id, name: fullName(approver), role };
  }

  async recordApproval(context: PosStaffContext, approver: { id: string; name: string }, action: string, subjectId: string | null, tillId: string | null) {
    const row = await this.prisma.posApproval.create({ data: { accountId: context.account.id, action, subjectId, requestedByStaffId: context.staff.id, requestedByName: context.staff.name, approvedByStaffId: approver.id, approvedByName: approver.name, tillId } });
    await this.audit.record({ actorId: null, action: 'pos.approved', targetType: 'pos_approval', targetId: row.id, after: { action, subject_id: subjectId, requested_by: context.staff.name, approved_by: approver.name } });
  }

  async approvals(accountId: string, limit = 50) {
    const rows = await this.prisma.posApproval.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: limit });
    return { object: 'list' as const, data: rows.map(row => ({ object: 'pos_approval' as const, id: row.id, action: row.action, subject_id: row.subjectId, requested_by: row.requestedByName, approved_by: row.approvedByName, till_id: row.tillId, created_at: row.createdAt.toISOString() })) };
  }

  /**
   * Who may approve at the session's till what this member of staff may not do alone: active colleagues whose role
   * sells (a bigger discount, up to their own limit), refunds or changes stock outright. Names and roles only.
   */
  async approvers(context: PosStaffContext) {
    const rows = await this.prisma.posStaff.findMany({ where: { accountId: context.account.id, status: 'active', id: { not: context.staff.id } }, include: staffInclude, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }] });
    const tills = context.tillId ? [context.tillId] : context.tills === 'all' ? null : context.tills;
    return rows
      .filter(row => !tills || row.allTills || row.tills.some(item => tills.includes(item.tillId)))
      .map(row => ({ row, role: this.resolveRole(row) }))
      .filter(({ role }) => ['sell', 'refund', 'stock_adjust'].some(key => role.permissions[key as PosPermission] === 'yes'))
      .map(({ row, role }) => ({
        id: row.id,
        name: fullName(row),
        role: role.name,
        discount_limit_bps: role.permissions.sell === 'yes' ? role.discountLimitBps : 0,
        refund: role.permissions.refund === 'yes',
        stock_adjust: role.permissions.stock_adjust === 'yes',
      }));
  }

  /** What a staff session may do, for the till to hide what it cannot (the API decides). */
  presentContext(context: PosStaffContext) {
    return {
      object: 'pos_staff_me' as const,
      staff: { id: context.staff.id, name: context.staff.name, first_name: context.staff.firstName },
      role: { id: context.role.id ?? context.role.key, key: context.role.key, name: context.role.name, discount_limit_bps: context.role.discountLimitBps },
      permissions: Object.fromEntries(posPermissions.map(key => [key, context.role.permissions[key as PosPermission]])),
      till_id: context.tillId,
      tills: context.tills,
      device: context.deviceId,
    };
  }
}
