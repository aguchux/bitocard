import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeadsService } from './leads.service.js';
import { ListingsService, shopOrigin } from './listings.service.js';
import { ListingSearchService, publicName } from './search.service.js';
import { onShopWhere } from './rules.js';
import { UsernamesService } from './usernames.service.js';
import { ReviewStatsService } from './reviews/stats.service.js';
import { SellerScoreReader } from './scores/reader.js';

/** A seller's handle: 10 lower-case letters and digits (`customers.seller_handle`). */
export const sellerHandlePattern = /^[a-z0-9]{6,12}$/;
/** The live listings a buyer can choose between when contacting the seller from their page. */
export const contactListingsLimit = 20;

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such seller.');

/**
 * Every account's public seller page (`/<cc>/seller/<handle>`): what their listings already show (their first name and
 * initial, when they joined, their badges and how they answer chats) gathered in one place, with what they sell live,
 * the categories and states it is in, and their sales. Never anything a listing does not already make public: no full
 * name, phone, email or where they live. The listings themselves come from the search (`seller=<handle>`).
 */
@Injectable()
export class SellerProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly search: ListingSearchService,
    private readonly leads: LeadsService,
    private readonly usernames: UsernamesService,
    private readonly reviewStats: ReviewStatsService,
    private readonly scores: SellerScoreReader,
  ) {}

  /**
   * The account a page's address names, while it is usable (a suspended account has no page): their username, their
   * handle, or a username they gave up within its 90 days (`redirect`: the address their page is at now).
   */
  async seller(key: string) {
    const found = await this.usernames.resolve(key);
    if (!found) throw notFound();
    const customer = await this.prisma.customer.findUnique({ where: { id: found.customerId }, select: { id: true, name: true, country: true, status: true, createdAt: true, phoneVerifiedAt: true, phone: true, avatarUrl: true, sellerHandle: true, username: true } });
    if (!customer || customer.status !== 'active') throw notFound();
    return { ...customer, redirect: found.redirect };
  }

  async profile(key: string) {
    const customer = await this.seller(key);
    const handle = customer.sellerHandle;
    const live = { customerId: customer.id, ...onShopWhere };
    // The page lives in the seller's own market; an account from before countries were asked takes its listings'.
    const country = customer.country ?? (await this.prisma.classifiedListing.findFirst({ where: live, orderBy: { publishedAt: 'desc' }, select: { country: true } }))?.country ?? null;
    if (!country) throw notFound();
    await this.listings.requireOpen(country);
    const inMarket = { ...live, country };

    const [byCategory, byState, sold, sales, responseRate, badges, contactRows, latest, reviews, scores] = await Promise.all([
      this.prisma.classifiedListing.groupBy({ by: ['categoryId'], where: inMarket, _count: { _all: true } }),
      this.prisma.classifiedListing.groupBy({ by: ['stateId'], where: inMarket, _count: { _all: true } }),
      this.prisma.classifiedListing.count({ where: { customerId: customer.id, country, status: 'sold', onShop: true } }),
      this.prisma.classifiedOrder.count({ where: { sellerId: customer.id, status: 'released' } }),
      this.leads.responseRate(customer.id),
      this.search.sellerBadges([customer]),
      this.prisma.classifiedListing.findMany({
        where: { ...inMarket, contact: { in: ['chat', 'phone', 'both'] } },
        orderBy: { publishedAt: 'desc' },
        take: contactListingsLimit,
        select: { id: true, ref: true, title: true, slug: true, currency: true, contact: true },
      }),
      this.prisma.classifiedListing.findFirst({ where: inMarket, orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
      this.reviewStats.summary(customer.id, country),
      this.scores.forPublic(customer.id, country),
    ]);
    const [categories, states] = await Promise.all([
      this.prisma.classifiedCategory.findMany({ where: { id: { in: byCategory.map(row => row.categoryId).filter((id): id is string => Boolean(id)) } }, include: { parent: true } }),
      this.prisma.classifiedArea.findMany({ where: { id: { in: byState.map(row => row.stateId).filter((id): id is string => Boolean(id)) } } }),
    ]);
    const count = (rows: Array<{ _count: { _all: number } } & Record<string, unknown>>, key: string, id: string) => rows.find(row => row[key] === id)?._count._all ?? 0;
    const phone = Boolean(customer.phoneVerifiedAt && customer.phone);
    const active = byCategory.reduce((sum, row) => sum + row._count._all, 0);
    return {
      object: 'classified_seller' as const,
      handle,
      /** Their chosen username, their page's address once set (else `handle`). */
      username: customer.username,
      /** Asked by a username they gave up (within 90 days): the address their page is at now, to redirect to. */
      redirect: customer.redirect,
      name: publicName(customer.name),
      /** Their profile photo (a face, logo or icon), or null for their initials. */
      avatar_url: customer.avatarUrl,
      country,
      url: `${shopOrigin}/${country.toLowerCase()}/seller/${customer.username ?? handle}`,
      member_since: customer.createdAt.toISOString(),
      badges: badges.get(customer.id) ?? [],
      response_rate: responseRate,
      active_listings: active,
      sold_listings: sold,
      safe_pay_sales: sales,
      last_listed_at: latest?.publishedAt?.toISOString() ?? null,
      /** Their live listings' categories, most listed first. */
      categories: categories
        .map(category => ({ slug: category.slug, name: category.name, icon: category.icon, parent: category.parent ? { slug: category.parent.slug, name: category.parent.name } : null, listings: count(byCategory, 'categoryId', category.id) }))
        .sort((a, b) => b.listings - a.listings || a.name.localeCompare(b.name)),
      /** Where their live listings are, most first. */
      states: states.map(state => ({ slug: state.slug, name: state.name, listings: count(byState, 'stateId', state.id) })).sort((a, b) => b.listings - a.listings || a.name.localeCompare(b.name)),
      /** How buyers can reach them: by chat and by phone (calls and call backs) on any of their listings. */
      contact: { chat: contactRows.some(row => row.contact !== 'phone'), phone: phone && contactRows.some(row => row.contact !== 'chat') },
      /** Their newest live listings that take chats or calls: what a buyer contacting them from this page is asking about. */
      /** Their reviews' summary where reviews are open in the market (null otherwise). */
      reviews,
      /** Anjio's view, in words, where scores are public in the market (null otherwise); never in metadata. */
      scores,
      contact_listings: contactRows.map(row => ({ id: row.id, ref: Number(row.ref), title: row.title!, slug: row.slug!, currency: row.currency, chat: row.contact !== 'phone', phone: phone && row.contact !== 'chat' })),
    };
  }
}
