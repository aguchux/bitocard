import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { houseStoreId } from '../checkout/house-ids.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AccountNotices } from '../notifications/account-notices.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { centreNumber } from './applications.service.js';

export const memberRoles = ['owner', 'manager', 'staff'] as const;
export type MemberRole = (typeof memberRoles)[number];
/** Who may change the centre's settings, shelves and pauses. */
const managers: MemberRole[] = ['owner', 'manager'];
/** How many people may work at one centre, and how many storage places it may have. */
export const maxMembers = 20;
export const maxShelves = 200;
/** Where a centre's people work: connect.udozo.com, through udozo.com's address for notices and emails. */
const dashboardPath = '/connect/centre';

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const unknown = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'centre_unknown', 'No such centre.');
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const forbidden = (message: string) => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'centre_role_required', message);

const centreInclude = {
  state: { select: { id: true, name: true, slug: true } },
  area: { select: { id: true, name: true, slug: true } },
  _count: { select: { members: true, shelves: { where: { active: true } } } },
} satisfies Prisma.ConnectCentreInclude;
type CentreRow = Prisma.ConnectCentreGetPayload<{ include: typeof centreInclude }>;

export type CentreInput = { hours?: string | null; phone?: string | null; capacity?: number | null; landmark?: string | null };
export type ShelfInput = { code?: string; label?: string | null; capacity?: number | null; active?: boolean; position?: number };

function line(value: string | null | undefined, param: string, min: number, max: number, what: string) {
  if (value === undefined) return undefined;
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (cleaned.length < min || cleaned.length > max) throw invalid('parameter_invalid', `${what} must be ${min} to ${max} characters.`, param);
  return cleaned;
}

const shelfOf = (row: { id: string; code: string; label: string | null; capacity: number | null; active: boolean; position: number }) => ({
  object: 'connect_shelf' as const,
  id: row.id,
  code: row.code,
  label: row.label,
  capacity: row.capacity,
  active: row.active,
  position: row.position,
});

/**
 * Running a Connect Centre (docs/UDOZO_CONNECT_PLAN.md, phase 3). On connect.udozo.com a centre's people (its owner, the
 * partner who applied, then managers and staff the owner adds, each a Udozo account with a confirmed mobile) see their
 * centre, change its hours, phone, capacity and landmark, pause it for a holiday and open it again, and set up its storage
 * places. Udozo's team pauses (with a reason only Udozo lifts), reinstates or closes centres. Active centres are listed
 * publicly, by market and state, for buyers and sellers.
 */
@Injectable()
export class ConnectCentresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly notices: AccountNotices,
    private readonly audit: AuditService,
  ) {}

  // ---- A centre's people ----

  /** The customer's place at the centre, or unknown (never saying the centre exists); `roles` narrows who may act. */
  private async member(customer: CustomerWithStore, centreId: string, roles?: MemberRole[]) {
    const member = await this.prisma.connectCentreMember.findUnique({ where: { centreId_customerId: { centreId, customerId: customer.id } } });
    if (!member) throw unknown();
    if (roles && !roles.includes(member.role as MemberRole)) {
      throw forbidden(roles.includes('manager') ? 'Only the centre’s owner and managers can do this.' : 'Only the centre’s owner can do this.');
    }
    return member;
  }

  /** The centres the customer works at, with their role at each. */
  async mine(customer: CustomerWithStore) {
    await this.reopenDue();
    const rows = await this.prisma.connectCentreMember.findMany({
      where: { customerId: customer.id },
      include: { centre: { include: centreInclude } },
      orderBy: { createdAt: 'asc' },
    });
    return { object: 'list' as const, data: rows.map(row => ({ ...this.present(row.centre), role: row.role as MemberRole })) };
  }

  async get(customer: CustomerWithStore, id: string) {
    const member = await this.member(customer, id);
    return { ...this.present(await this.row(id)), role: member.role as MemberRole };
  }

  private async row(id: string) {
    await this.reopenDue();
    const row = await this.prisma.connectCentre.findUnique({ where: { id }, include: centreInclude });
    if (!row) throw unknown();
    return row;
  }

  async update(customer: CustomerWithStore, id: string, input: CentreInput) {
    await this.member(customer, id, managers);
    const centre = await this.row(id);
    if (centre.status === 'closed') throw conflict('centre_closed', 'This centre is closed.');
    const data: Prisma.ConnectCentreUpdateInput = {};
    const hours = line(input.hours, 'hours', 3, 200, 'The opening hours');
    if (hours === null) throw invalid('parameter_missing', 'Give the opening hours.', 'hours');
    if (hours !== undefined) data.hours = hours;
    const landmark = line(input.landmark, 'landmark', 3, 120, 'The landmark');
    if (landmark !== undefined) data.landmark = landmark;
    if (input.phone !== undefined) {
      const phone = (input.phone ?? '').replace(/[\s()-]/g, '');
      if (!/^\+?\d{7,15}$/.test(phone)) throw invalid('parameter_invalid', "Give the centre's phone number, digits only.", 'phone');
      data.phone = phone;
    }
    if (input.capacity !== undefined) {
      if (input.capacity === null || !Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 100_000) throw invalid('parameter_invalid', 'Say how many items the centre can hold: a whole number from 1.', 'capacity');
      data.capacity = input.capacity;
    }
    await this.prisma.connectCentre.update({ where: { id }, data });
    return this.get(customer, id);
  }

  /** Pauses the centre for a holiday (no new orders while it finishes what it holds); never over a pause of Udozo's. */
  async pause(customer: CustomerWithStore, id: string, input: { until?: string | null; note?: string | null }) {
    await this.member(customer, id, managers);
    const until = input.until ? new Date(input.until) : null;
    if (until && (Number.isNaN(until.getTime()) || until.getTime() < Date.now())) throw invalid('parameter_invalid', 'Choose a day in the future to open again, or leave it empty.', 'until');
    const note = line(input.note, 'note', 3, 200, 'The note') ?? 'Closed for a holiday';
    const updated = await this.prisma.connectCentre.updateMany({ where: { id, status: 'active' }, data: { status: 'paused', pausedBy: 'partner', pausedReason: note, pausedUntil: until } });
    if (!updated.count) throw conflict('centre_not_active', 'Only an open centre can be paused.');
    return this.get(customer, id);
  }

  /** Opens the centre again after the partner's own pause. */
  async resume(customer: CustomerWithStore, id: string) {
    await this.member(customer, id, managers);
    const updated = await this.prisma.connectCentre.updateMany({ where: { id, status: 'paused', pausedBy: 'partner' }, data: { status: 'active', pausedBy: null, pausedReason: null, pausedUntil: null } });
    if (!updated.count) throw conflict('centre_not_paused_by_you', 'This centre is not paused by you: Udozo’s team will reopen it, or it is already open.');
    return this.get(customer, id);
  }

  /** The centres a partner paused until a day that has come: open again (checked whenever centres are read). */
  async reopenDue(now = new Date()) {
    const reopened = await this.prisma.connectCentre.updateMany({ where: { status: 'paused', pausedBy: 'partner', pausedUntil: { lte: now } }, data: { status: 'active', pausedBy: null, pausedReason: null, pausedUntil: null } });
    return { reopened: reopened.count };
  }

  // ---- Staff ----

  async members(customer: CustomerWithStore, id: string) {
    await this.member(customer, id);
    return { object: 'list' as const, data: await this.memberList(id) };
  }

  private async memberList(centreId: string) {
    const rows = await this.prisma.connectCentreMember.findMany({ where: { centreId }, include: { customer: { select: { id: true, name: true, email: true, phone: true } } }, orderBy: { createdAt: 'asc' } });
    const order = (role: string) => memberRoles.indexOf(role as MemberRole);
    return rows
      .sort((a, b) => order(a.role) - order(b.role))
      .map(row => ({ object: 'connect_centre_member' as const, id: row.id, role: row.role as MemberRole, name: row.customer.name, email: row.customer.email, phone: row.customer.phone, since: row.createdAt.toISOString() }));
  }

  /** The owner adds a manager or staff member by the email of their Udozo account, which must have a confirmed mobile. */
  async addMember(customer: CustomerWithStore, id: string, input: { email: string; role: 'manager' | 'staff' }) {
    const owner = await this.member(customer, id, ['owner']);
    const centre = await this.row(id);
    if (centre.status === 'closed') throw conflict('centre_closed', 'This centre is closed.');
    const email = input.email.trim().toLowerCase();
    const person = await this.prisma.customer.findFirst({ where: { storeId: houseStoreId, email }, select: { id: true, name: true, phoneVerifiedAt: true, status: true, storeId: true } });
    if (!person || person.status !== 'active') throw invalid('account_not_found', 'There is no Udozo account with that email. Ask them to sign up on udozo.com first.', 'email');
    if (!person.phoneVerifiedAt) throw invalid('mobile_not_confirmed', 'They must confirm their mobile number on their Udozo account first.', 'email');
    if ((await this.prisma.connectCentreMember.count({ where: { centreId: id } })) >= maxMembers) throw conflict('too_many_members', `A centre can have at most ${maxMembers} people.`);
    try {
      await this.prisma.connectCentreMember.create({ data: { centreId: id, customerId: person.id, role: input.role, addedById: owner.customerId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('member_exists', 'They already work at this centre.', 'email');
      throw error;
    }
    this.tell(person, `You now work at ${centre.name}`, `${customer.name} added you to Udozo Connect Centre ${centreNumber(centre.number)} as ${input.role === 'manager' ? 'a manager' : 'staff'}. Sign in on connect.udozo.com to start.`);
    return { object: 'list' as const, data: await this.memberList(id) };
  }

  async updateMember(customer: CustomerWithStore, id: string, memberId: string, role: 'manager' | 'staff') {
    await this.member(customer, id, ['owner']);
    const target = await this.prisma.connectCentreMember.findUnique({ where: { id: memberId } });
    if (!target || target.centreId !== id) throw notFound('member');
    if (target.role === 'owner') throw conflict('owner_fixed', 'The owner’s role cannot change.');
    await this.prisma.connectCentreMember.update({ where: { id: memberId }, data: { role } });
    return { object: 'list' as const, data: await this.memberList(id) };
  }

  /** The owner removes someone, or a manager or staff member leaves (their own id); the owner never leaves. */
  async removeMember(customer: CustomerWithStore, id: string, memberId: string) {
    const me = await this.member(customer, id);
    const target = await this.prisma.connectCentreMember.findUnique({ where: { id: memberId }, include: { customer: { select: { id: true, storeId: true } }, centre: { select: { name: true } } } });
    if (!target || target.centreId !== id) throw notFound('member');
    if (target.role === 'owner') throw conflict('owner_fixed', 'The owner cannot be removed.');
    const leaving = target.customerId === customer.id;
    if (!leaving && me.role !== 'owner') throw forbidden('Only the centre’s owner can do this.');
    await this.prisma.connectCentreMember.delete({ where: { id: memberId } });
    if (!leaving) this.tell(target.customer, `You no longer work at ${target.centre.name}`, `${customer.name} removed you from the centre on Udozo Connect.`);
    return { object: 'list' as const, data: leaving ? [] : await this.memberList(id) };
  }

  // ---- Shelves ----

  async shelves(customer: CustomerWithStore, id: string) {
    await this.member(customer, id);
    const rows = await this.prisma.connectShelf.findMany({ where: { centreId: id }, orderBy: [{ active: 'desc' }, { position: 'asc' }, { code: 'asc' }] });
    return { object: 'list' as const, data: rows.map(shelfOf) };
  }

  private shelfFields(input: ShelfInput) {
    const data: { code?: string; label?: string | null; capacity?: number | null; active?: boolean; position?: number } = {};
    if (input.code !== undefined) {
      const code = input.code.replace(/\s+/g, ' ').trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9 -]{0,19}$/.test(code)) throw invalid('parameter_invalid', 'A storage place’s code is up to 20 letters, digits, spaces or hyphens (A-01, SHELF 3).', 'code');
      data.code = code;
    }
    const label = line(input.label, 'label', 2, 60, 'The description');
    if (label !== undefined) data.label = label;
    if (input.capacity !== undefined) {
      if (input.capacity !== null && (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 10_000)) throw invalid('parameter_invalid', 'Say how many items it holds: a whole number from 1, or leave it empty.', 'capacity');
      data.capacity = input.capacity;
    }
    if (input.active !== undefined) data.active = input.active;
    if (input.position !== undefined) data.position = input.position;
    return data;
  }

  async addShelf(customer: CustomerWithStore, id: string, input: ShelfInput) {
    await this.member(customer, id, managers);
    const data = this.shelfFields(input);
    if (!data.code) throw invalid('parameter_missing', 'Give the storage place a code.', 'code');
    if ((await this.prisma.connectShelf.count({ where: { centreId: id } })) >= maxShelves) throw conflict('too_many_shelves', `A centre can have at most ${maxShelves} storage places.`);
    const position = data.position ?? (await this.prisma.connectShelf.count({ where: { centreId: id } }));
    try {
      await this.prisma.connectShelf.create({ data: { centreId: id, code: data.code, label: data.label ?? null, capacity: data.capacity ?? null, position } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('shelf_exists', 'This centre already has a storage place with that code.', 'code');
      throw error;
    }
    return this.shelves(customer, id);
  }

  /** Changes a storage place; one in use is switched off rather than deleted, so its history stays. */
  async updateShelf(customer: CustomerWithStore, id: string, shelfId: string, input: ShelfInput) {
    await this.member(customer, id, managers);
    const shelf = await this.prisma.connectShelf.findUnique({ where: { id: shelfId } });
    if (!shelf || shelf.centreId !== id) throw notFound('storage place');
    try {
      await this.prisma.connectShelf.update({ where: { id: shelfId }, data: this.shelfFields(input) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('shelf_exists', 'This centre already has a storage place with that code.', 'code');
      throw error;
    }
    return this.shelves(customer, id);
  }

  // ---- Udozo's team ----

  async adminGet(id: string) {
    const row = await this.prisma.connectCentre.findUnique({
      where: { id },
      include: { ...centreInclude, partner: { select: { id: true, name: true, email: true, phone: true } }, application: { select: { id: true } }, shelves: { orderBy: [{ active: 'desc' }, { position: 'asc' }] } },
    });
    if (!row) throw unknown();
    return {
      ...this.present(row),
      partner: row.partner,
      application_id: row.application?.id ?? null,
      members: await this.memberList(id),
      shelves: row.shelves.map(shelfOf),
    };
  }

  /** Udozo pauses a centre (no new orders while it finishes what it holds), reinstates it, or closes it for good. */
  async adminStatus(adminId: string | null, id: string, action: 'pause' | 'reinstate' | 'close', reason: string) {
    const centre = await this.row(id);
    const why = line(reason, 'reason', 3, 500, 'The reason');
    if (!why) throw invalid('parameter_missing', 'Say why.', 'reason');
    const now = new Date();
    const changes = {
      pause: { from: ['active', 'paused'], data: { status: 'paused', pausedBy: 'udozo', pausedReason: why, pausedUntil: null } },
      reinstate: { from: ['paused'], data: { status: 'active', pausedBy: null, pausedReason: null, pausedUntil: null } },
      close: { from: ['active', 'paused'], data: { status: 'closed', closedAt: now, closedReason: why } },
    }[action];
    const updated = await this.prisma.connectCentre.updateMany({ where: { id, status: { in: changes.from } }, data: changes.data });
    if (!updated.count) throw conflict('centre_status', `This centre is ${centre.status}: it cannot be ${action === 'reinstate' ? 'reinstated' : action === 'pause' ? 'paused' : 'closed'}.`);
    await this.audit.record({ actorId: adminId, action: `connect_centre.${action === 'reinstate' ? 'reinstated' : action === 'pause' ? 'paused' : 'closed'}`, targetType: 'connect_centre', targetId: id, before: { status: centre.status }, after: { status: changes.data.status, reason: why } });
    const people = await this.prisma.connectCentreMember.findMany({ where: { centreId: id, role: { in: managers } }, include: { customer: { select: { id: true, storeId: true } } } });
    const [title, body] =
      action === 'pause'
        ? [`Udozo paused ${centre.name}`, `It takes no new orders for now: ${why} Finish what it holds; our team will be in touch.`]
        : action === 'reinstate'
          ? [`${centre.name} is open again`, 'Udozo reopened your centre: it takes orders again.']
          : [`Udozo closed ${centre.name}`, `${why} Our team will be in touch about what it holds and your deposit.`];
    for (const person of people) this.tell(person.customer, title, body);
    return this.adminGet(id);
  }

  // ---- The public list ----

  /** Active centres in a market, for buyers and sellers: where they are, when they open and how to reach them. */
  async publicList(country: string, stateId?: string) {
    await this.reopenDue();
    const rows = await this.prisma.connectCentre.findMany({
      where: { country: country.toUpperCase(), status: 'active', ...(stateId ? { stateId } : {}) },
      include: { state: { select: { id: true, name: true, slug: true } }, area: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ state: { name: 'asc' } }, { area: { name: 'asc' } }, { name: 'asc' }],
      take: 500,
    });
    return {
      object: 'list' as const,
      country: country.toUpperCase(),
      data: rows.map(row => ({
        object: 'connect_centre' as const,
        id: row.id,
        number: centreNumber(row.number),
        name: row.name,
        state: { id: row.state.id, name: row.state.name, slug: row.state.slug },
        area: { id: row.area.id, name: row.area.name, slug: row.area.slug },
        address: row.address,
        landmark: row.landmark,
        latitude: row.latitude === null ? null : Number(row.latitude),
        longitude: row.longitude === null ? null : Number(row.longitude),
        hours: row.hours,
        phone: row.phone,
        photo: row.photos[0] ?? null,
      })),
    };
  }

  // ---- Presenting and telling ----

  present(row: CentreRow) {
    return {
      object: 'connect_centre' as const,
      id: row.id,
      number: centreNumber(row.number),
      name: row.name,
      status: row.status as 'active' | 'paused' | 'closed',
      paused: row.status === 'paused' ? { by: row.pausedBy as 'partner' | 'udozo', reason: row.pausedReason, until: row.pausedUntil?.toISOString() ?? null } : null,
      closed: row.status === 'closed' ? { at: row.closedAt?.toISOString() ?? null, reason: row.closedReason } : null,
      country: row.country,
      state: { id: row.state.id, name: row.state.name },
      area: { id: row.area.id, name: row.area.name },
      address: row.address,
      landmark: row.landmark,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      hours: row.hours,
      phone: row.phone,
      capacity: row.capacity,
      photos: row.photos,
      deposit: { amount: Number(row.depositMinor), currency: row.currency },
      people: row._count.members,
      shelves: row._count.shelves,
      created_at: row.createdAt.toISOString(),
    };
  }

  /** Tells one of the centre's people (inbox, push and email), never failing the change. */
  private tell(person: { id: string; storeId: string }, title: string, body: string) {
    void this.inbox
      .customer({ customerId: person.id, storeId: person.storeId }, 'customer.connect.centre', { subject: `connect_centre:${title}:${Date.now()}`, title, body, link: dashboardPath })
      .catch(() => undefined);
    this.notices.customer(person.id, { title, body, path: dashboardPath, action: 'Open Udozo Connect' });
  }
}
