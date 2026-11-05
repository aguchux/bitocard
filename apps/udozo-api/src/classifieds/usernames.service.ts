import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { type Limiter, limiterFor } from '../common/rate-limit/rate-limit.guard.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { ListingsService } from './listings.service.js';

/**
 * Usernames (docs/UDOZO_USERNAMES_PLAN.md): 3 to 24 characters, lower-case letters, digits and underscores, starting
 * with a letter (as `usernamePattern` in `@bitocard/api-client/classifieds`). Typed in any case, stored lower-case.
 */
export const usernamePattern = /^[a-z][a-z0-9_]{2,23}$/;
/** What a seller page's address may be: a username or a handle (`/<cc>/seller/<key>`), in any case. */
export const sellerKeyPattern = /^[a-z0-9_]{3,24}$/i;
/** How often a username may change, how long an old one is held (and redirects), and the banner's "Not now"s. */
export const usernameRules = { changeEveryDays: 30, holdDays: 90, checksPerMinute: 30, promptDismissals: 3 } as const;

/**
 * Never a username: Udozo's own words and the names of its pages (so an address never reads as Udozo's), and anything
 * containing `udozo` (checked apart).
 */
export const reservedUsernames: ReadonlySet<string> = new Set([
  'udozo', 'admin', 'administrator', 'support', 'help', 'helpdesk', 'safepay', 'safe_pay', 'seller', 'sellers', 'official',
  'staff', 'moderator', 'moderators', 'account', 'accounts', 'settings', 'api', 'www', 'shop', 'store', 'stores', 'search',
  'market', 'markets', 'null', 'undefined', 'root', 'system', 'team', 'security', 'billing', 'payments', 'payouts',
  'wallet', 'orders', 'listings', 'listing', 'messages', 'favourites', 'requests', 'resellers', 'reseller', 'verification',
  'verify', 'privacy', 'profile', 'sell', 'signin', 'signup', 'signout', 'login', 'logout', 'register', 'handoff', 'legal',
  'terms', 'cookies', 'safe_trade', 'safetrade', 'start_here', 'areas', 'home', 'home_preview', 'sitemap', 'sitemaps',
  'img', 'images', 'flags', 'auth', 'seller_card', 'contact', 'faqs', 'about', 'blog', 'news', 'press', 'jobs', 'careers',
  'shq', 'seller_hq', 'sellerhq', 'bitocard', 'golojan', 'anjio', 'everyone', 'anonymous',
]);

export type UsernameReason = 'taken' | 'reserved' | 'refused' | 'invalid' | 'own';

const phoneRun = /\d{7,}/;
const dayMs = 86_400_000;
const compact = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const refusal = (status: HttpStatus, code: string, message: string) =>
  new ApiError(status, status === HttpStatus.CONFLICT ? 'conflict_error' : status === HttpStatus.FORBIDDEN ? 'permission_error' : 'invalid_request_error', code, message, 'username');

const reasonErrors: Record<Exclude<UsernameReason, 'own'>, () => ApiError> = {
  invalid: () => refusal(HttpStatus.BAD_REQUEST, 'username_invalid', 'Use 3 to 24 letters, digits and underscores, starting with a letter.'),
  reserved: () => refusal(HttpStatus.BAD_REQUEST, 'username_reserved', 'That username is kept for Udozo. Choose another.'),
  refused: () => refusal(HttpStatus.BAD_REQUEST, 'username_refused', 'That username cannot be used on Udozo: no phone numbers or words our rules refuse. Choose another.'),
  taken: () => refusal(HttpStatus.CONFLICT, 'username_taken', 'Someone already has that username. Choose another.'),
};

type Owner = { id: string; storeId: string; country: string | null; status: string; name: string; firstName: string | null; lastName: string | null; username: string | null; usernameSetAt: Date | null; usernamePromptDismissals: number };
const ownerSelect = { id: true, storeId: true, country: true, status: true, name: true, firstName: true, lastName: true, username: true, usernameSetAt: true, usernamePromptDismissals: true } as const;

/** A day as the customer reads it (`5 December 2026`). */
const dayText = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Udozo's usernames: chosen once a customer has posted the market's minimum of ads, unique across every account, never a
 * handle, a reserved word, a refused word or a phone number. Changed at most once every 30 days; an old username is held
 * for 90 days, redirecting to its customer's page, and nobody else may take it then. Admins can take one away.
 */
@Injectable()
export class UsernamesService {
  private readonly logger = new Logger('Usernames');
  private readonly checks: Limiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.checks = limiterFor(config, usernameRules.checksPerMinute);
  }

  private async owner(customerId: string): Promise<Owner> {
    const owner = await this.prisma.customer.findUnique({ where: { id: customerId }, select: ownerSelect });
    if (!owner) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such customer.');
    return owner;
  }

  /** Ads they have posted: published at least once, whatever became of them, unless moderation removed them or they deleted them. */
  posted(customerId: string) {
    return this.prisma.classifiedListing.count({ where: { customerId, publishedAt: { not: null }, status: { notIn: ['removed', 'deleted'] } } });
  }

  /** The market's minimum (an account from before countries were asked takes the default). */
  private async required(country: string | null) {
    return (await this.listings.marketSettings(country ?? '')).usernameMinListings;
  }

  private changeAfter(owner: Pick<Owner, 'username' | 'usernameSetAt'>, now = new Date()) {
    if (!owner.username || !owner.usernameSetAt) return null;
    const next = new Date(owner.usernameSetAt.getTime() + usernameRules.changeEveryDays * dayMs);
    return next > now ? next : null;
  }

  private async statusOf(owner: Owner) {
    const [posted, required] = await Promise.all([this.posted(owner.id), this.required(owner.country)]);
    // Keeping (and changing) a username never depends on staying above the minimum.
    const eligible = owner.status === 'active' && (owner.username !== null || posted >= required);
    return {
      object: 'username_status' as const,
      username: owner.username,
      posted,
      required,
      eligible,
      change_after: this.changeAfter(owner)?.toISOString() ?? null,
      prompt: eligible && !owner.username && owner.usernamePromptDismissals < usernameRules.promptDismissals,
      dismissals: owner.usernamePromptDismissals,
    };
  }

  async status(customerId: string) {
    return this.statusOf(await this.owner(customerId));
  }

  /** "Not now" on the banner: after three, it never asks again (the profile still offers it). */
  async dismissPrompt(customerId: string) {
    await this.prisma.customer.update({ where: { id: customerId }, data: { usernamePromptDismissals: { increment: 1 } } });
    return this.status(customerId);
  }

  /** The refused words that apply in a market (everywhere's and its own), compacted to letters and digits. */
  private async refusedWords(country: string | null) {
    const rows = await this.prisma.classifiedProhibitedWord.findMany({ where: { platform: 'bitocard', OR: [{ country: null }, ...(country ? [{ country }] : [])] }, select: { phrase: true } });
    return rows.map(row => compact(row.phrase)).filter(Boolean);
  }

  /**
   * Why a well-formed username cannot be anyone's, from its words alone: reserved (Udozo's own words, or `udozo`
   * anywhere) or refused (a phone number, or one of the refused words: a short one as a whole word between underscores
   * or digits, a longer one anywhere).
   */
  private wordsProblem(name: string, refused: string[]): 'reserved' | 'refused' | null {
    if (reservedUsernames.has(name) || name.includes('udozo')) return 'reserved';
    if (phoneRun.test(name)) return 'refused';
    const tokens = new Set(name.split(/[_\d]+/).filter(Boolean));
    const joined = name.replace(/_/g, '');
    if (refused.some(word => tokens.has(word) || (word.length >= 4 && joined.includes(word)))) return 'refused';
    return null;
  }

  /** The names among these that someone else holds: their username, a username held for them, or anyone's handle. */
  private async takenOf(names: string[], customerId: string, db: Prisma.TransactionClient = this.prisma, now = new Date()) {
    if (!names.length) return new Set<string>();
    const [users, held, handles] = await Promise.all([
      db.customer.findMany({ where: { username: { in: names }, id: { not: customerId } }, select: { username: true } }),
      db.customerUsernameHistory.findMany({ where: { username: { in: names }, customerId: { not: customerId }, holdUntil: { gt: now } }, select: { username: true } }),
      db.customer.findMany({ where: { sellerHandle: { in: names } }, select: { sellerHandle: true } }),
    ]);
    return new Set([...users.map(row => row.username!), ...held.map(row => row.username), ...handles.map(row => row.sellerHandle)]);
  }

  /** Free variants of what they typed (unless its words were the problem) and of their name, best first. */
  private async suggestions(owner: Owner, typed: string | null, refused: string[]) {
    const clean = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+/g, '_').replace(/_$/, '').slice(0, 20);
    const first = clean(owner.firstName ?? owner.name.split(/\s+/)[0] ?? '');
    const last = clean(owner.lastName ?? owner.name.split(/\s+/).slice(1).join(' '));
    const bases = [...new Set([typed ? clean(typed) : '', first && last ? `${first}_${last}` : '', first && last ? `${first}${last}` : '', first && last ? `${first}_${last[0]}` : '', first].filter(Boolean))];
    const cc = owner.country?.toLowerCase();
    const candidates: string[] = [];
    for (const base of bases) {
      candidates.push(base, ...(cc ? [`${base}_${cc}`] : []), `${base}_shop`);
      for (const n of [1, 2, 7, 24, 99]) candidates.push(`${base}${n}`);
    }
    const valid = [...new Set(candidates.map(name => name.slice(0, 24)))].filter(name => usernamePattern.test(name) && name !== owner.username && !this.wordsProblem(name, refused));
    const taken = await this.takenOf(valid, owner.id);
    return valid.filter(name => !taken.has(name)).slice(0, 3);
  }

  /** Whether a username is free for this customer, why not, and up to three free ones like it. 30 checks a minute. */
  async availability(customerId: string, raw: string) {
    let verdict: { success: boolean } = { success: true };
    try {
      verdict = await this.checks.limitFor(`username-check:${customerId}`);
    } catch (error) {
      this.logger.warn(`Username check limit unavailable: ${(error as Error).message}`);
    }
    if (!verdict.success) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'username_check_limit', 'You are checking usernames very fast. Wait a moment, then try again.');
    const owner = await this.owner(customerId);
    const username = raw.trim().toLowerCase();
    const refused = await this.refusedWords(owner.country);
    let reason: UsernameReason | null;
    if (!usernamePattern.test(username)) reason = 'invalid';
    else if (owner.username === username) reason = 'own';
    else reason = this.wordsProblem(username, refused) ?? ((await this.takenOf([username], owner.id)).has(username) ? 'taken' : null);
    return {
      object: 'username_availability' as const,
      username,
      available: reason === null,
      reason,
      suggestions: reason === null || reason === 'own' ? [] : await this.suggestions(owner, reason === 'reserved' || reason === 'refused' ? null : username, refused),
    };
  }

  /** Chooses or changes their username (eligible, at most once every 30 days); the old one is held for 90 days. */
  async set(customerId: string, raw: string) {
    const owner = await this.owner(customerId);
    const username = raw.trim().toLowerCase();
    if (!usernamePattern.test(username)) throw reasonErrors.invalid();
    const status = await this.statusOf(owner);
    if (!status.eligible) {
      const more = status.required - status.posted;
      throw refusal(HttpStatus.FORBIDDEN, 'username_not_eligible', `Post ${more} more ${more === 1 ? 'ad' : 'ads'} to choose a username: you have posted ${status.posted} of the ${status.required} needed.`);
    }
    if (owner.username === username) return status;
    const words = this.wordsProblem(username, await this.refusedWords(owner.country));
    if (words) throw reasonErrors[words]();
    const now = new Date();
    const next = this.changeAfter(owner, now);
    if (next) throw refusal(HttpStatus.CONFLICT, 'username_change_too_soon', `You can change your username once every ${usernameRules.changeEveryDays} days: next on ${dayText(next)}.`);

    try {
      await this.prisma.$transaction(async tx => {
        // Again inside the transaction; the unique index decides a race between two accounts.
        if ((await this.takenOf([username], owner.id, tx, now)).has(username)) throw reasonErrors.taken();
        const changed = await tx.customer.updateMany({ where: { id: owner.id, username: owner.username }, data: { username, usernameSetAt: now } });
        if (!changed.count) throw refusal(HttpStatus.CONFLICT, 'username_changed', 'Your username just changed. Refresh and try again.');
        // Taking back one of their own old usernames ends its hold; the one they leave is held for them.
        await tx.customerUsernameHistory.deleteMany({ where: { username, customerId: owner.id } });
        if (owner.username) await this.hold(tx, owner.username, owner.id, now);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw reasonErrors.taken();
      throw error;
    }
    await this.audit.record({ actorId: null, action: 'customer.username_set', targetType: 'customer', targetId: owner.id, before: { username: owner.username }, after: { username } });
    return this.status(owner.id);
  }

  /** An old username redirects to its customer and nobody else may take it for 90 days (a row moves to its latest holder). */
  private hold(tx: Prisma.TransactionClient, username: string, customerId: string, now: Date) {
    const row = { customerId, releasedAt: now, holdUntil: new Date(now.getTime() + usernameRules.holdDays * dayMs) };
    return tx.customerUsernameHistory.upsert({ where: { username }, create: { username, ...row }, update: row });
  }

  /** Admins take a username away (abuse, impersonation): the page goes back to the handle, the old one is held, and the customer is told. */
  async remove(actorId: string | null, customerId: string, reason: string) {
    const owner = await this.owner(customerId);
    if (!owner.username) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'username_not_set', 'This seller has no username.');
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      await tx.customer.update({ where: { id: owner.id }, data: { username: null, usernameSetAt: null } });
      await this.hold(tx, owner.username!, owner.id, now);
    });
    await this.audit.record({ actorId, action: 'classifieds.seller_username_removed', targetType: 'customer', targetId: owner.id, before: { username: owner.username }, after: { username: null, reason } });
    await this.inbox.customer({ customerId: owner.id, storeId: owner.storeId }, 'customer.classifieds.username_removed', {
      subject: `${owner.id}:${now.getTime()}`,
      title: 'Udozo removed your username',
      body: `Your username @${owner.username} was removed: ${reason} Your seller page is back at its first address, and you can choose another username on your profile.`,
      link: '/account/profile#username',
    });
  }

  /**
   * The customer a seller page's address names: their username first, then a handle, then a username they gave up
   * within its 90 days (`redirect` then names the address their page is at now). Null when nobody.
   */
  async resolve(raw: string, { held = true }: { held?: boolean } = {}) {
    if (!sellerKeyPattern.test(raw)) return null;
    const key = raw.toLowerCase();
    const byName = await this.prisma.customer.findUnique({ where: { username: key }, select: { id: true } });
    if (byName) return { customerId: byName.id, redirect: null };
    const byHandle = await this.prisma.customer.findUnique({ where: { sellerHandle: key }, select: { id: true } });
    if (byHandle) return { customerId: byHandle.id, redirect: null };
    if (!held) return null;
    const old = await this.prisma.customerUsernameHistory.findUnique({ where: { username: key }, include: { customer: { select: { id: true, username: true, sellerHandle: true } } } });
    if (!old || old.holdUntil <= new Date()) return null;
    return { customerId: old.customer.id, redirect: old.customer.username ?? old.customer.sellerHandle };
  }
}
