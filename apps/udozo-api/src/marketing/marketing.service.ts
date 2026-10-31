import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { AuditService } from '../audit/audit.service.js';
import { normalisePhone } from '../auth/auth.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { EmailService } from '../notifications/email.service.js';
import { marketingInviteEmail } from '../notifications/templates.js';

/**
 * Udozo's marketing (Marketplace > Marketing, any admin role): sellers found on other marketplaces (a list from Jiji,
 * grouped by phone into one seller with every advert), or anyone invited by email, worked one stage at a time. Each
 * has an invite link, udozo.com/i/<code>, which records the click and carries the code to sign-up; the account it
 * makes (or one using their phone or email) is linked here, so every invitation's sign-up is tracked. Every seller is
 * in one of Udozo's markets (`country`, Nigeria unless the list or the admin says otherwise): their numbers are read as
 * that country's, so WhatsApp and calls carry its dialling code, and the pipeline filters by it.
 */

export const stages = ['reach_out', 'invitation', 'onboarding', 'follow_up', 'feedback'] as const;
export const stageStatuses = ['not_started', 'in_progress', 'waiting', 'done', 'skipped', 'failed'] as const;
export const outcomes = ['signed_up', 'first_post', 'declined', 'no_response'] as const;
export const channels = ['whatsapp', 'jiji_chat', 'call', 'sms', 'email', 'in_person', 'other'] as const;
/** What an admin logs; the rest (stage, assigned, scheduled, feedback, imported, opened, signed_up…) are written here. */
export const loggedKinds = ['message', 'call', 'invite', 'follow_up', 'note'] as const;
export const advocacies = ['advocate', 'nurture'] as const;

export type Stage = (typeof stages)[number];
export type StageStatus = (typeof stageStatuses)[number];
export type Outcome = (typeof outcomes)[number];

/** Listings that count as posted: submitted, live or once live. */
const postedStatuses = ['pending_review', 'active', 'sold', 'expired'];
/** One invite email at a time: another only after this long. */
const inviteEmailGapMs = 10 * 60 * 1000;
const maxAdverts = 50;
export const invitePattern = /^[a-z0-9]{6,20}$/;

type Advert = { url: string; title: string | null; price: string | null; category: string | null; location: string | null };
type ProspectRow = Prisma.MarketingProspectGetPayload<{ include: { owner: { select: { id: true; name: true } } } }>;

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such seller.', 'id');
const clean = (value: string | null | undefined, max = 500) => {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};

/** Every number in a phone field ("0806…; 0902…"), in E.164 for the market; numbers it cannot read are left out. */
export function phonesOf(raw: string | null | undefined, country = 'NG') {
  const found: string[] = [];
  for (const part of (raw ?? '').split(/[;,/|]+/)) {
    const text = part.trim();
    if (!text) continue;
    try {
      const phone = normalisePhone(text, country);
      if (!found.includes(phone)) found.push(phone);
    } catch {
      // A number of another country, or not a mobile: left out.
    }
  }
  return found;
}

/** The national form people dial in the number's own country ("08031234567", "0241234567"), without spaces. */
const localPhone = (phone: string) => parsePhoneNumberFromString(phone)?.formatNational().replace(/\s/g, '') ?? phone;

/** What a Jiji note says about the seller (badges, years), without the item's own condition after the bar. */
const sellerNotes = (notes: string | null | undefined) => clean(notes?.split('|')[0]?.replace(/;\s*$/, ''), 300);

const inviteCode = () => randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10).padEnd(10, '0');

/** End of today in Lagos (West Africa Time, UTC+1, no summer time). */
function endOfTodayLagos(now = new Date()) {
  const lagos = new Date(now.getTime() + 60 * 60 * 1000);
  return new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() + 1) - 60 * 60 * 1000);
}

export type ImportRow = {
  name?: string;
  store_name?: string;
  phone?: string;
  email?: string;
  category?: string;
  location?: string;
  advert_url?: string;
  title?: string;
  price?: string;
  notes?: string;
  source?: string;
};

export type ProspectPatch = Partial<{
  name: string;
  store_name: string | null;
  phones: string[];
  email: string | null;
  location: string | null;
  categories: string[];
  notes: string | null;
  owner_id: string | null;
  next_action: string | null;
  next_action_at: string | null;
  outcome: Outcome | null;
  do_not_contact: boolean;
  country: string;
}>;

@Injectable()
export class MarketingService {
  private readonly logger = new Logger('MarketingService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** The invite link: udozo.com/i/<code>, which records the click and opens sign-up with the code. */
  inviteLink(code: string) {
    return `${String(this.integrations.config.STOREFRONT_URL ?? 'https://udozo.com').replace(/\/$/, '')}/i/${code}`;
  }

  present(row: ProspectRow) {
    return {
      object: 'marketing_prospect' as const,
      id: row.id,
      name: row.name,
      store_name: row.storeName,
      phones: row.phones,
      email: row.email,
      country: row.country,
      location: row.location,
      categories: row.categories,
      adverts: (row.adverts ?? []) as Advert[],
      source: row.source,
      source_notes: row.sourceNotes,
      stage: row.stage as Stage,
      stage_status: row.stageStatus as StageStatus,
      status_reason: row.statusReason,
      outcome: row.outcome as Outcome | null,
      owner: row.owner ? { id: row.owner.id, name: row.owner.name } : null,
      next_action: row.nextAction,
      next_action_at: row.nextActionAt?.toISOString() ?? null,
      last_contact_at: row.lastContactAt?.toISOString() ?? null,
      follow_ups: row.followUps,
      invite_code: row.inviteCode,
      invite_link: this.inviteLink(row.inviteCode),
      invited_at: row.invitedAt?.toISOString() ?? null,
      invite_emailed_at: row.inviteEmailedAt?.toISOString() ?? null,
      clicked_at: row.clickedAt?.toISOString() ?? null,
      clicks: row.clicks,
      do_not_contact: row.doNotContact,
      customer_id: row.customerId,
      linked_at: row.linkedAt?.toISOString() ?? null,
      feedback: { rating: row.feedbackRating, would_recommend: row.wouldRecommend, notes: row.feedbackNotes, advocacy: row.advocacy },
      notes: row.notes,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private async load(id: string) {
    const row = await this.prisma.marketingProspect.findUnique({ where: { id }, include: { owner: { select: { id: true, name: true } } } });
    if (!row) throw notFound();
    return row;
  }

  private note(prospectId: string, actorId: string | null, data: Omit<Prisma.MarketingActivityUncheckedCreateInput, 'prospectId' | 'actorId'>, tx: Prisma.TransactionClient = this.prisma) {
    return tx.marketingActivity.create({ data: { prospectId, actorId, ...data } });
  }

  // -- Linking sign-ups ----------------------------------------------------------------------------------------------

  /**
   * Links sellers not yet linked to the Udozo account that signed up with their invite code, else one using their email
   * or phone: the outcome becomes signed up and a seller still being reached or invited moves on to onboarding.
   */
  async autoLink(rows: Array<{ id: string; customerId: string | null; inviteCode: string; email: string | null; phones: string[] }>) {
    const open = rows.filter(row => !row.customerId);
    if (!open.length) return 0;
    const codes = open.map(row => row.inviteCode);
    const emails = open.flatMap(row => (row.email ? [row.email] : []));
    const phones = open.flatMap(row => row.phones);
    const customers = await this.prisma.customer.findMany({
      where: { OR: [{ signupRef: { in: codes } }, ...(emails.length ? [{ email: { in: emails } }] : []), ...(phones.length ? [{ phone: { in: phones } }] : [])] },
      select: { id: true, email: true, phone: true, signupRef: true },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });
    if (!customers.length) return 0;
    let linked = 0;
    for (const row of open) {
      const byCode = customers.find(customer => customer.signupRef === row.inviteCode);
      const byEmail = row.email ? customers.find(customer => customer.email === row.email) : undefined;
      const byPhone = customers.find(customer => customer.phone && row.phones.includes(customer.phone));
      const match = byCode ?? byEmail ?? byPhone;
      if (!match) continue;
      const how = byCode ? 'with their invite link' : byEmail ? 'with their email' : 'with their phone number';
      const done = await this.prisma.$transaction(async tx => {
        const current = await tx.marketingProspect.findUnique({ where: { id: row.id }, select: { customerId: true, stage: true, outcome: true } });
        if (!current || current.customerId) return false;
        const moveOn = current.stage === 'reach_out' || current.stage === 'invitation';
        await tx.marketingProspect.update({
          where: { id: row.id },
          data: {
            customerId: match.id,
            linkedAt: new Date(),
            outcome: !current.outcome || current.outcome === 'no_response' || current.outcome === 'declined' ? 'signed_up' : current.outcome,
            ...(moveOn ? { stage: 'onboarding', stageStatus: 'in_progress' } : {}),
          },
        });
        await this.note(row.id, null, { kind: 'signed_up', body: `Signed up on Udozo ${how}.`, ...(moveOn ? { stage: 'onboarding', status: 'in_progress' } : {}) }, tx);
        return true;
      });
      if (done) linked += 1;
    }
    return linked;
  }

  /** The linked account's onboarding: signed up, email and mobile confirmed, a first listing, a store on Seller HQ. */
  private async account(row: ProspectRow) {
    if (!row.customerId) return null;
    const customer = await this.prisma.customer.findUnique({
      where: { id: row.customerId },
      select: { id: true, name: true, email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true, createdAt: true, country: true },
    });
    if (!customer) return null;
    const [posted, live, first, seller] = await Promise.all([
      this.prisma.classifiedListing.count({ where: { customerId: customer.id, status: { in: postedStatuses } } }),
      this.prisma.classifiedListing.count({ where: { customerId: customer.id, status: 'active' } }),
      this.prisma.classifiedListing.findFirst({ where: { customerId: customer.id, status: { in: postedStatuses } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      this.prisma.user.findFirst({
        where: { realm: 'reseller', email: customer.email },
        select: { memberships: { select: { reseller: { select: { stores: { select: { status: true, publishedAt: true } } } } } } },
      }),
    ]);
    const stores = seller?.memberships.flatMap(member => member.reseller.stores) ?? [];
    const published = stores.find(store => store.publishedAt);
    // A first listing moves the outcome on.
    if (posted > 0 && (!row.outcome || row.outcome === 'signed_up' || row.outcome === 'no_response')) {
      await this.prisma.marketingProspect.update({ where: { id: row.id }, data: { outcome: 'first_post' } });
      await this.note(row.id, null, { kind: 'first_post', body: 'Posted their first listing on Udozo.' });
      row.outcome = 'first_post';
    }
    return {
      object: 'marketing_account' as const,
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      country: customer.country,
      listings: { posted, live },
      checks: [
        { key: 'signed_up', label: 'Signed up', done: true, at: customer.createdAt.toISOString() },
        { key: 'email_confirmed', label: 'Email confirmed', done: Boolean(customer.emailVerifiedAt), at: customer.emailVerifiedAt?.toISOString() ?? null },
        { key: 'mobile_confirmed', label: 'Mobile confirmed', done: Boolean(customer.phoneVerifiedAt), at: customer.phoneVerifiedAt?.toISOString() ?? null },
        { key: 'first_listing', label: 'Posted a first listing', done: posted > 0, at: first?.createdAt.toISOString() ?? null },
        { key: 'seller_hq_store', label: 'Opened a store on Seller HQ', done: stores.length > 0, at: published?.publishedAt?.toISOString() ?? null },
      ],
    };
  }

  // -- Reading ---------------------------------------------------------------------------------------------------------

  async list(adminId: string | null, filters: { stage?: string; status?: string; owner?: string; q?: string; due?: string; outcome?: string; linked?: string; category?: string; country?: string; limit?: number; offset?: number }) {
    const and: Prisma.MarketingProspectWhereInput[] = [];
    if (filters.country) and.push({ country: filters.country });
    if (filters.stage) and.push({ stage: filters.stage });
    if (filters.status) and.push({ stageStatus: filters.status });
    if (filters.outcome) and.push(filters.outcome === 'none' ? { outcome: null } : { outcome: filters.outcome });
    if (filters.owner === 'me') and.push({ ownerId: adminId ?? '00000000-0000-0000-0000-000000000000' });
    else if (filters.owner === 'none') and.push({ ownerId: null });
    else if (filters.owner) and.push({ ownerId: filters.owner });
    if (filters.category) and.push({ categories: { has: filters.category } });
    const now = new Date();
    if (filters.due === 'overdue') and.push({ nextActionAt: { lt: now } });
    else if (filters.due === 'today') and.push({ nextActionAt: { lte: endOfTodayLagos(now) } });
    else if (filters.due === 'week') and.push({ nextActionAt: { lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) } });
    else if (filters.due === 'none') and.push({ nextActionAt: null });
    const words = filters.q?.trim();
    if (words) {
      const phones = /\d{7,}/.test(words.replace(/\D/g, '')) ? phonesOf(words, filters.country ?? 'NG') : [];
      and.push({
        OR: [
          { name: { contains: words, mode: 'insensitive' } },
          { storeName: { contains: words, mode: 'insensitive' } },
          { email: { contains: words.toLowerCase() } },
          { location: { contains: words, mode: 'insensitive' } },
          { inviteCode: words.toLowerCase() },
          ...(phones.length ? [{ phones: { hasSome: phones } }] : []),
        ],
      });
    }
    // Sellers matching the search who have signed up since are linked first, so the list (and its "linked" filter) is current.
    const unlinked = await this.prisma.marketingProspect.findMany({
      where: { AND: [...and, { customerId: null }] },
      select: { id: true, customerId: true, inviteCode: true, email: true, phones: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    await this.autoLink(unlinked);
    if (filters.linked) and.push(filters.linked === 'yes' ? { customerId: { not: null } } : { customerId: null });
    const where: Prisma.MarketingProspectWhereInput = and.length ? { AND: and } : {};
    const limit = Math.min(filters.limit ?? 50, 100);
    const offset = filters.offset ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.marketingProspect.findMany({
        where,
        include: { owner: { select: { id: true, name: true } } },
        orderBy: [{ nextActionAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.marketingProspect.count({ where }),
    ]);
    return { object: 'list' as const, data: rows.map(row => this.present(row)), total, has_more: offset + rows.length < total };
  }

  /** The funnel, what each stage holds, what is due, and the admins sellers can be given to. */
  async summary() {
    const recent = await this.prisma.marketingProspect.findMany({
      where: { customerId: null },
      select: { id: true, customerId: true, inviteCode: true, email: true, phones: true },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    await this.autoLink(recent);
    const now = new Date();
    const count = (where: Prisma.MarketingProspectWhereInput) => this.prisma.marketingProspect.count({ where });
    const [total, reached, invited, clicked, signedUp, posted, feedback, grouped, overdue, today, unassigned, owners, byCountry] = await Promise.all([
      count({}),
      count({ lastContactAt: { not: null } }),
      count({ invitedAt: { not: null } }),
      count({ clickedAt: { not: null } }),
      count({ customerId: { not: null } }),
      count({ customer: { classifiedListings: { some: { status: { in: postedStatuses } } } } }),
      count({ feedbackRating: { not: null } }),
      this.prisma.marketingProspect.groupBy({ by: ['stage', 'stageStatus'], _count: { _all: true } }),
      count({ nextActionAt: { lt: now } }),
      count({ nextActionAt: { gte: now, lte: endOfTodayLagos(now) } }),
      count({ ownerId: null }),
      this.prisma.user.findMany({ where: { realm: 'admin', status: 'active' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.marketingProspect.groupBy({ by: ['country'], _count: { _all: true } }),
    ]);
    return {
      object: 'marketing_summary' as const,
      total,
      funnel: { reached, invited, clicked, signed_up: signedUp, posted, feedback },
      stages: stages.map(stage => ({
        stage,
        total: grouped.filter(row => row.stage === stage).reduce((sum, row) => sum + row._count._all, 0),
        statuses: Object.fromEntries(stageStatuses.map(status => [status, grouped.find(row => row.stage === stage && row.stageStatus === status)?._count._all ?? 0])),
      })),
      due: { overdue, today },
      unassigned,
      owners,
      countries: byCountry.map(row => ({ country: row.country, total: row._count._all })).sort((a, b) => b.total - a.total),
    };
  }

  async get(id: string) {
    let row = await this.load(id);
    if (await this.autoLink([row])) row = await this.load(id);
    const account = await this.account(row);
    const activities = await this.prisma.marketingActivity.findMany({
      where: { prospectId: id },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      ...this.present(row),
      account,
      activities: activities.map(item => ({
        object: 'marketing_activity' as const,
        id: item.id,
        kind: item.kind,
        channel: item.channel,
        template: item.template,
        body: item.body,
        replied: item.replied,
        outcome: item.outcome,
        stage: item.stage,
        status: item.status,
        actor: item.actor ? { id: item.actor.id, name: item.actor.name } : null,
        created_at: item.createdAt.toISOString(),
      })),
    };
  }

  // -- Adding ----------------------------------------------------------------------------------------------------------

  /** A seller already here with one of these numbers or this email. */
  private existing(phones: string[], email: string | null) {
    const or: Prisma.MarketingProspectWhereInput[] = [...(phones.length ? [{ phones: { hasSome: phones } }] : []), ...(email ? [{ email }] : [])];
    return or.length ? this.prisma.marketingProspect.findFirst({ where: { OR: or }, orderBy: { createdAt: 'asc' } }) : Promise.resolve(null);
  }

  /** One of Udozo's markets (Nigeria when none is given). */
  private async market(code: string | null | undefined) {
    const country = (code ?? 'NG').toUpperCase();
    const found = await this.prisma.country.findUnique({ where: { code: country }, select: { code: true } });
    if (!found) throw invalid('market_unavailable', 'Choose one of Udozo’s markets.', 'country');
    return found.code;
  }

  private async assertOwner(ownerId: string | null | undefined) {
    if (!ownerId) return;
    const owner = await this.prisma.user.findFirst({ where: { id: ownerId, realm: 'admin' }, select: { id: true } });
    if (!owner) throw invalid('parameter_invalid', 'Choose a member of the admin team.', 'owner_id');
  }

  private async insert(actorId: string | null, data: Omit<Prisma.MarketingProspectUncheckedCreateInput, 'inviteCode'>, note: string) {
    return this.prisma.$transaction(async tx => {
      const row = await tx.marketingProspect.create({ data: { ...data, inviteCode: inviteCode(), createdById: actorId } });
      await this.note(row.id, actorId, { kind: 'imported', body: note }, tx);
      return row;
    });
  }

  async create(actorId: string | null, input: { name: string; store_name?: string; phones?: string[]; email?: string; location?: string; categories?: string[]; source?: string; notes?: string; owner_id?: string; country?: string }) {
    const country = await this.market(input.country);
    const phones = (input.phones ?? []).flatMap(phone => phonesOf(phone, country));
    if ((input.phones ?? []).some(phone => phone.trim()) && !phones.length) throw invalid('phone_invalid', 'Enter a valid mobile number of the market.', 'phones');
    const email = clean(input.email?.toLowerCase(), 254);
    if (!phones.length && !email) throw invalid('parameter_missing', 'Give a phone number or an email to reach them.', 'phones');
    const found = await this.existing(phones, email);
    if (found) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'prospect_exists', `${found.name} is already in Marketing with this number or email.`, 'phones');
    await this.assertOwner(input.owner_id);
    const row = await this.insert(
      actorId,
      {
        name: clean(input.name, 120)!,
        storeName: clean(input.store_name, 120),
        phones,
        email,
        country,
        location: clean(input.location, 120),
        categories: [...new Set((input.categories ?? []).map(item => clean(item, 80)).filter((item): item is string => Boolean(item)))].slice(0, 20),
        source: clean(input.source, 60) ?? 'Direct',
        notes: clean(input.notes, 5000),
        ownerId: input.owner_id ?? null,
      },
      'Added by hand.',
    );
    await this.audit.record({ actorId, action: 'marketing.prospect_added', targetType: 'marketing_prospect', targetId: row.id, after: { name: row.name, source: row.source } });
    return this.get(row.id);
  }

  /**
   * A list's rows (a Jiji export, mapped by the admin app), grouped by phone (else email) into one seller each with
   * every advert and category. A seller already here (any of the numbers, or the email) gets the new adverts instead
   * of a second entry. Rows with no number or email that can be read are skipped, saying why. The whole list is one
   * market's (`country`, the admin's choice, Nigeria by default): its numbers are read as that country's.
   */
  async import(actorId: string | null, input: { rows: ImportRow[]; owner_id?: string; source?: string; country?: string }) {
    const country = await this.market(input.country);
    await this.assertOwner(input.owner_id);
    const groups = new Map<string, { phones: string[]; email: string | null; rows: ImportRow[] }>();
    const skipped: Array<{ row: number; reason: string }> = [];
    input.rows.forEach((row, index) => {
      const phones = phonesOf(row.phone, country);
      const email = clean(row.email?.toLowerCase(), 254);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        skipped.push({ row: index, reason: 'email_invalid' });
        return;
      }
      const key = phones[0] ?? email;
      if (!key) {
        skipped.push({ row: index, reason: row.phone?.trim() ? 'phone_invalid' : 'no_contact' });
        return;
      }
      const group = groups.get(key) ?? { phones: [], email: null, rows: [] };
      for (const phone of phones) if (!group.phones.includes(phone)) group.phones.push(phone);
      group.email ??= email;
      group.rows.push(row);
      groups.set(key, group);
    });
    let created = 0;
    let merged = 0;
    const source = clean(input.source, 60) ?? 'Jiji';
    for (const group of groups.values()) {
      const name = group.rows.map(row => clean(row.name, 120)).find(Boolean) ?? null;
      const storeName = group.rows.map(row => clean(row.store_name, 120)).find(Boolean) ?? null;
      const adverts: Advert[] = group.rows.flatMap(row => {
        const url = clean(row.advert_url, 500);
        return url && /^https?:\/\//i.test(url) ? [{ url, title: clean(row.title, 200), price: clean(row.price, 40), category: clean(row.category, 80), location: clean(row.location, 120) }] : [];
      });
      const categories = [...new Set(group.rows.map(row => clean(row.category, 80)).filter((item): item is string => Boolean(item)))];
      const location = group.rows.map(row => clean(row.location, 120)).find(Boolean) ?? null;
      const notes = group.rows.map(row => sellerNotes(row.notes)).find(Boolean) ?? null;
      const found = await this.existing(group.phones, group.email);
      if (found) {
        const have = (found.adverts ?? []) as Advert[];
        const fresh = adverts.filter(advert => !have.some(item => item.url === advert.url));
        await this.prisma.marketingProspect.update({
          where: { id: found.id },
          data: {
            phones: [...new Set([...found.phones, ...group.phones])],
            email: found.email ?? group.email,
            categories: [...new Set([...found.categories, ...categories])].slice(0, 20),
            adverts: [...have, ...fresh].slice(0, maxAdverts) as unknown as Prisma.InputJsonValue,
            ...(name && found.name.startsWith('Seller ') ? { name } : {}),
            storeName: found.storeName ?? storeName,
            location: found.location ?? location,
            sourceNotes: found.sourceNotes ?? notes,
          },
        });
        if (fresh.length) await this.note(found.id, actorId, { kind: 'imported', body: `Seen again in a ${source} list: ${fresh.length} new advert${fresh.length === 1 ? '' : 's'}.` });
        merged += 1;
        continue;
      }
      await this.insert(
        actorId,
        {
          name: name ?? storeName ?? `Seller ${localPhone(group.phones[0] ?? group.email ?? '')}`,
          storeName: name ? storeName : null,
          phones: group.phones,
          email: group.email,
          country,
          location,
          categories: categories.slice(0, 20),
          adverts: adverts.slice(0, maxAdverts) as unknown as Prisma.InputJsonValue,
          source,
          sourceNotes: notes,
          ownerId: input.owner_id ?? null,
        },
        `Imported from a ${source} list with ${adverts.length} advert${adverts.length === 1 ? '' : 's'}.`,
      );
      created += 1;
    }
    await this.audit.record({ actorId, action: 'marketing.imported', targetType: 'marketing_import', targetId: actorId ?? 'admin', after: { rows: input.rows.length, created, merged, skipped: skipped.length, source, country } });
    return { object: 'marketing_import' as const, rows: input.rows.length, country, created, merged, skipped };
  }

  // -- Working a seller ------------------------------------------------------------------------------------------------

  async update(actorId: string | null, id: string, input: ProspectPatch) {
    const row = await this.load(id);
    const data: Prisma.MarketingProspectUncheckedUpdateInput = {};
    // A seller filed under the wrong market: numbers sent with the change are read as the new country's.
    const country = input.country !== undefined ? await this.market(input.country) : row.country;
    if (country !== row.country) data.country = country;
    if (input.name !== undefined) data.name = clean(input.name, 120) ?? row.name;
    if (input.store_name !== undefined) data.storeName = clean(input.store_name, 120);
    if (input.location !== undefined) data.location = clean(input.location, 120);
    if (input.notes !== undefined) data.notes = clean(input.notes, 5000);
    if (input.categories !== undefined) data.categories = [...new Set(input.categories.map(item => clean(item, 80)).filter((item): item is string => Boolean(item)))].slice(0, 20);
    let phones = row.phones;
    if (input.phones !== undefined) {
      phones = input.phones.flatMap(phone => phonesOf(phone, country));
      if (input.phones.some(phone => phone.trim()) && phones.length < input.phones.filter(phone => phone.trim()).length) throw invalid('phone_invalid', 'Enter valid mobile numbers of the market.', 'phones');
      data.phones = phones;
    }
    let email = row.email;
    if (input.email !== undefined) {
      email = clean(input.email?.toLowerCase(), 254);
      data.email = email;
    }
    if (!phones.length && !email) throw invalid('parameter_missing', 'Keep a phone number or an email to reach them.', 'phones');
    if (input.outcome !== undefined) data.outcome = input.outcome;
    if (input.do_not_contact !== undefined) data.doNotContact = input.do_not_contact;
    const owner = input.owner_id !== undefined && input.owner_id !== row.ownerId;
    if (owner) {
      await this.assertOwner(input.owner_id);
      data.ownerId = input.owner_id;
    }
    const scheduled = (input.next_action !== undefined && input.next_action !== row.nextAction) || (input.next_action_at !== undefined && (input.next_action_at ? new Date(input.next_action_at).getTime() : null) !== (row.nextActionAt?.getTime() ?? null));
    if (input.next_action !== undefined) data.nextAction = clean(input.next_action, 200);
    if (input.next_action_at !== undefined) data.nextActionAt = input.next_action_at ? new Date(input.next_action_at) : null;
    await this.prisma.$transaction(async tx => {
      await tx.marketingProspect.update({ where: { id }, data });
      if (owner) {
        const name = input.owner_id ? (await tx.user.findUnique({ where: { id: input.owner_id }, select: { name: true } }))?.name : null;
        await this.note(id, actorId, { kind: 'assigned', body: name ? `Given to ${name}.` : 'No longer assigned.' }, tx);
      }
      if (scheduled) {
        const when = input.next_action_at ?? row.nextActionAt?.toISOString() ?? null;
        const what = (input.next_action !== undefined ? clean(input.next_action, 200) : row.nextAction) ?? 'Next touch';
        await this.note(id, actorId, { kind: 'scheduled', body: when ? `${what}: ${when}` : `${what} (no date)` }, tx);
      }
      if (input.do_not_contact !== undefined && input.do_not_contact !== row.doNotContact) {
        await this.note(id, actorId, { kind: 'note', body: input.do_not_contact ? 'Asked not to be contacted again.' : 'May be contacted again.' }, tx);
      }
      if (input.outcome !== undefined && input.outcome !== row.outcome) await this.note(id, actorId, { kind: 'outcome', outcome: input.outcome }, tx);
      if (country !== row.country) await this.note(id, actorId, { kind: 'note', body: `Market changed from ${row.country} to ${country}.` }, tx);
    });
    if (input.do_not_contact !== undefined && input.do_not_contact !== row.doNotContact) {
      await this.audit.record({ actorId, action: 'marketing.do_not_contact', targetType: 'marketing_prospect', targetId: id, before: { do_not_contact: row.doNotContact }, after: { do_not_contact: input.do_not_contact } });
    }
    return this.get(id);
  }

  /**
   * Logs a message, call, invite, follow-up or note. Contact moves the stage from not started to in progress, an
   * unanswered one leaves it waiting on the seller, an invite marks them invited, and a follow-up counts.
   */
  async log(actorId: string | null, id: string, input: { kind: (typeof loggedKinds)[number]; channel?: string; template?: string; body?: string; replied?: boolean; outcome?: Outcome; next_action?: string | null; next_action_at?: string | null }) {
    const row = await this.load(id);
    const contact = input.kind !== 'note';
    const now = new Date();
    const data: Prisma.MarketingProspectUncheckedUpdateInput = {};
    if (contact) {
      data.lastContactAt = now;
      if (input.replied === false) data.stageStatus = 'waiting';
      else if (row.stageStatus === 'not_started' || row.stageStatus === 'waiting') data.stageStatus = 'in_progress';
    }
    if (input.kind === 'invite') {
      data.invitedAt = row.invitedAt ?? now;
      if (row.stage === 'reach_out') data.stage = 'invitation';
    }
    if (input.kind === 'follow_up') data.followUps = row.followUps + 1;
    if (input.outcome) data.outcome = input.outcome;
    if (input.next_action !== undefined) data.nextAction = clean(input.next_action, 200);
    if (input.next_action_at !== undefined) data.nextActionAt = input.next_action_at ? new Date(input.next_action_at) : null;
    await this.prisma.$transaction(async tx => {
      await tx.marketingProspect.update({ where: { id }, data });
      await this.note(
        id,
        actorId,
        {
          kind: input.kind,
          channel: input.channel ?? null,
          template: clean(input.template, 60),
          body: input.body?.trim().slice(0, 2000) || null,
          replied: input.replied ?? null,
          outcome: input.outcome ?? null,
          ...(data.stage || data.stageStatus ? { stage: (data.stage as string | undefined) ?? row.stage, status: (data.stageStatus as string | undefined) ?? row.stageStatus } : {}),
        },
        tx,
      );
    });
    return this.get(id);
  }

  /** Moves the seller to a stage and status; skipping or failing one says why. */
  async setStage(actorId: string | null, id: string, input: { stage: Stage; status: StageStatus; reason?: string }) {
    const row = await this.load(id);
    const reason = clean(input.reason, 500);
    if ((input.status === 'skipped' || input.status === 'failed') && !reason) throw invalid('parameter_missing', 'Say why.', 'reason');
    await this.prisma.$transaction(async tx => {
      await tx.marketingProspect.update({ where: { id }, data: { stage: input.stage, stageStatus: input.status, statusReason: reason ?? (input.stage === row.stage ? row.statusReason : null) } });
      await this.note(id, actorId, { kind: 'stage', stage: input.stage, status: input.status, body: reason }, tx);
    });
    return this.get(id);
  }

  /** What they said: a rating, whether they would recommend Udozo, notes, the win or loss reason, advocacy or nurture. */
  async feedback(actorId: string | null, id: string, input: { rating?: number | null; would_recommend?: boolean | null; notes?: string | null; reason?: string | null; advocacy?: (typeof advocacies)[number] | null }) {
    const row = await this.load(id);
    const data: Prisma.MarketingProspectUncheckedUpdateInput = {};
    if (input.rating !== undefined) data.feedbackRating = input.rating;
    if (input.would_recommend !== undefined) data.wouldRecommend = input.would_recommend;
    if (input.notes !== undefined) data.feedbackNotes = clean(input.notes, 2000);
    if (input.reason !== undefined) data.statusReason = clean(input.reason, 500);
    if (input.advocacy !== undefined) data.advocacy = input.advocacy;
    if (row.stage === 'feedback' && input.rating) data.stageStatus = 'done';
    const summary = [input.rating ? `${input.rating}/5` : null, input.would_recommend === true ? 'would recommend' : input.would_recommend === false ? 'would not recommend' : null, input.advocacy, clean(input.notes, 300)].filter(Boolean).join(' · ');
    await this.prisma.$transaction(async tx => {
      await tx.marketingProspect.update({ where: { id }, data });
      await this.note(id, actorId, { kind: 'feedback', body: summary || 'Feedback updated.', ...(data.stageStatus ? { stage: row.stage, status: 'done' } : {}) }, tx);
    });
    return this.get(id);
  }

  /** Links the Udozo account with this email or phone by hand (or unlinks), for one signed up some other way. */
  async link(actorId: string | null, id: string, input: { email?: string; phone?: string; unlink?: boolean }) {
    const row = await this.load(id);
    if (input.unlink) {
      await this.prisma.marketingProspect.update({ where: { id }, data: { customerId: null, linkedAt: null } });
      await this.note(id, actorId, { kind: 'linked', body: 'Unlinked from the Udozo account.' });
      return this.get(id);
    }
    const phone = input.phone ? phonesOf(input.phone, row.country)[0] : undefined;
    const email = clean(input.email?.toLowerCase(), 254);
    if (!phone && !email) throw invalid('parameter_missing', 'Give the account’s email or mobile number.', 'email');
    const customer = await this.prisma.customer.findFirst({ where: phone ? { phone } : { email: email! }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });
    if (!customer) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'account_not_found', 'No Udozo account uses this email or number yet.', phone ? 'phone' : 'email');
    await this.prisma.marketingProspect.update({ where: { id }, data: { customerId: customer.id, linkedAt: new Date(), outcome: row.outcome && row.outcome !== 'no_response' && row.outcome !== 'declined' ? row.outcome : 'signed_up' } });
    await this.note(id, actorId, { kind: 'linked', body: `Linked to the Udozo account of ${customer.name}.` });
    return this.get(id);
  }

  // -- Invites ---------------------------------------------------------------------------------------------------------

  /**
   * Emails the seller their invitation to sell on Udozo (an ordinary Udozo account, never the admin), from the admin
   * who sent it, with the link that tracks the click and the sign-up. One every ten minutes at most; never to someone
   * who asked not to be contacted.
   */
  async emailInvite(actor: { id: string | null; name: string }, id: string, input: { email?: string; message?: string }) {
    const row = await this.load(id);
    if (row.doNotContact) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'do_not_contact', 'They asked not to be contacted again.', 'id');
    const email = clean(input.email?.toLowerCase(), 254) ?? row.email;
    if (!email) throw invalid('parameter_missing', 'Add their email first.', 'email');
    if (row.inviteEmailedAt && Date.now() - row.inviteEmailedAt.getTime() < inviteEmailGapMs) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'invite_recently_sent', 'An invitation went to them a few minutes ago. Try again later.', 'id');
    }
    const link = this.inviteLink(row.inviteCode);
    const from = actor.name.trim().split(/\s+/)[0] || 'The Udozo team';
    const sent = await this.email.send(marketingInviteEmail(email, { name: row.name, from, link, message: input.message }));
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      await tx.marketingProspect.update({
        where: { id },
        data: {
          email: row.email ?? email,
          invitedAt: row.invitedAt ?? now,
          inviteEmailedAt: now,
          lastContactAt: now,
          ...(row.stage === 'reach_out' ? { stage: 'invitation', stageStatus: 'waiting' } : row.stage === 'invitation' ? { stageStatus: 'waiting' } : {}),
        },
      });
      await this.note(id, actor.id, { kind: 'invite', channel: 'email', body: `Invitation emailed to ${email}${sent === 'outbox' ? ' (held: no email provider is set up)' : ''}.`, ...(row.stage === 'reach_out' || row.stage === 'invitation' ? { stage: 'invitation', status: 'waiting' } : {}) }, tx);
    });
    await this.audit.record({ actorId: actor.id, action: 'marketing.invite_emailed', targetType: 'marketing_prospect', targetId: id, after: { email, sent } });
    return { ...(await this.get(id)), email_sent: sent };
  }

  /** Invites anyone by email: the seller with that email, or a new one, gets their invitation. */
  async inviteByEmail(actor: { id: string | null; name: string }, input: { email: string; name?: string; message?: string; owner_id?: string; country?: string }) {
    const email = clean(input.email.toLowerCase(), 254)!;
    let row = await this.prisma.marketingProspect.findFirst({ where: { email }, orderBy: { createdAt: 'asc' } });
    if (!row) {
      const country = await this.market(input.country);
      await this.assertOwner(input.owner_id);
      row = await this.insert(actor.id, { name: clean(input.name, 120) ?? email.split('@')[0]!, email, country, source: 'Email invite', ownerId: input.owner_id ?? actor.id }, 'Added to invite by email.');
    }
    return this.emailInvite(actor, row.id, { message: input.message });
  }

  /**
   * The daily `marketing` job, as the privacy notice says: sellers never linked to an account are deleted 12 months after
   * the last contact (or after being added, never reached); one who asked not to be contacted keeps only their number or
   * email, marked, so no one contacts them again.
   */
  async purge(now = new Date()) {
    const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const stale = await this.prisma.marketingProspect.deleteMany({
      where: { customerId: null, doNotContact: false, OR: [{ lastContactAt: { lt: cutoff } }, { lastContactAt: null, createdAt: { lt: cutoff } }] },
    });
    const quiet = await this.prisma.marketingProspect.findMany({ where: { doNotContact: true, OR: [{ notes: { not: null } }, { location: { not: null } }, { sourceNotes: { not: null } }, { feedbackNotes: { not: null } }, { categories: { isEmpty: false } }] }, select: { id: true }, take: 500 });
    for (const row of quiet) {
      await this.prisma.$transaction([
        this.prisma.marketingActivity.deleteMany({ where: { prospectId: row.id } }),
        this.prisma.marketingProspect.update({ where: { id: row.id }, data: { notes: null, location: null, sourceNotes: null, feedbackNotes: null, statusReason: null, categories: [], adverts: [], storeName: null } }),
      ]);
    }
    return { deleted: stale.count, reduced: quiet.length };
  }

  /** Opening the invite link (udozo.com/i/<code>): counted, and the first time logged. Unknown codes change nothing. */
  async opened(code: string) {
    if (!invitePattern.test(code)) return;
    const row = await this.prisma.marketingProspect.findUnique({ where: { inviteCode: code }, select: { id: true, clickedAt: true } });
    if (!row) return;
    await this.prisma.marketingProspect.update({ where: { id: row.id }, data: { clicks: { increment: 1 }, clickedAt: row.clickedAt ?? new Date() } });
    if (!row.clickedAt) await this.note(row.id, null, { kind: 'opened', body: 'Opened their invite link.' }).catch(error => this.logger.warn({ err: error }, 'Could not log an opened invite'));
  }
}
