import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { ApiError } from '../../common/errors/api-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { ClassifiedSponsoredPlacement, Prisma } from '../../generated/prisma/client.js';
import { ShopDirectoryService } from '../directory.service.js';
import { isOnShop } from '../rules.js';
import { ListingSearchService } from '../search.service.js';
import { HomeService } from './home.service.js';

/** The longest a placement runs. */
export const maxSponsoredDays = 90;
const day = 86_400_000;

export type SponsoredState = 'active' | 'scheduled' | 'ended';
export type SponsoredInput = { listing_ref?: number; country?: string | null; starts_at?: string; ends_at?: string; position?: number; note?: string | null };

const invalid = (code: string, message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);

/**
 * Sponsored placements (admin-placed; no seller pays yet): a live listing Udozo's team puts in a home page's Sponsored
 * rail, on its country's page or the page across countries, for a set time (at most 90 days), always labelled
 * Sponsored. Ending one early keeps it for the record. Every change is audited and every page reads it within a minute.
 */
@Injectable()
export class SponsoredService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly directory: ShopDirectoryService,
    private readonly search: ListingSearchService,
    private readonly home: HomeService,
  ) {}

  private stateOf(row: ClassifiedSponsoredPlacement, now = new Date()): SponsoredState {
    if (row.endedAt || row.endsAt <= now) return 'ended';
    return row.startsAt > now ? 'scheduled' : 'active';
  }

  private async present(rows: Array<ClassifiedSponsoredPlacement & { listing: { ref: bigint; title: string | null; country: string; status: string; onShop: boolean } }>) {
    const cards = await this.search.cards(rows.map(row => row.listingId));
    return rows.map(row => ({
      object: 'sponsored_placement' as const,
      id: row.id,
      country: row.country,
      state: this.stateOf(row),
      position: row.position,
      starts_at: row.startsAt.toISOString(),
      ends_at: row.endsAt.toISOString(),
      ended_at: row.endedAt?.toISOString() ?? null,
      note: row.note,
      /** The listing as shoppers see it; `live` false while it is not for sale (the rail leaves it out). */
      listing: { ref: Number(row.listing.ref), title: row.listing.title, country: row.listing.country, live: isOnShop(row.listing), card: cards.get(row.listingId) ?? null },
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }));
  }

  /** Placements by page (`country`: a code, or `global`) and state, the latest first. */
  async list(filter: { country?: string; state?: SponsoredState }) {
    const now = new Date();
    const where: Prisma.ClassifiedSponsoredPlacementWhereInput = {
      ...(filter.country ? { country: filter.country === 'global' ? null : filter.country.toUpperCase() } : {}),
      ...(filter.state === 'active' ? { endedAt: null, startsAt: { lte: now }, endsAt: { gt: now } } : {}),
      ...(filter.state === 'scheduled' ? { endedAt: null, startsAt: { gt: now } } : {}),
      ...(filter.state === 'ended' ? { OR: [{ endedAt: { not: null } }, { endsAt: { lte: now } }] } : {}),
    };
    const rows = await this.prisma.classifiedSponsoredPlacement.findMany({ where, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }], take: 200, include: { listing: { select: { ref: true, title: true, country: true, status: true, onShop: true } } } });
    return { object: 'list' as const, data: await this.present(rows) };
  }

  private async one(id: string) {
    const row = await this.prisma.classifiedSponsoredPlacement.findUnique({ where: { id }, include: { listing: { select: { ref: true, title: true, country: true, status: true, onShop: true } } } });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such placement.');
    return row;
  }

  /** The page and dates checked: an open market (or across countries), the listing live there, and a span that fits. */
  private async check(input: { listingId: string; listingCountry: string; country: string | null; startsAt: Date; endsAt: Date }) {
    const markets = await this.directory.markets();
    if (input.country !== null && !markets.data.some(market => market.country === input.country)) throw invalid('market_unavailable', 'Udozo is not open in that country.', 'country');
    if (input.country !== null && input.listingCountry !== input.country) throw invalid('parameter_invalid', "The listing is not in that country: place it on its own country's page or across countries.", 'country');
    if (input.country === null && !markets.data.some(market => market.country === input.listingCountry)) throw invalid('market_unavailable', 'Udozo is not open in the listing’s country.', 'listing_ref');
    if (!(input.endsAt > input.startsAt)) throw invalid('parameter_invalid', 'End it after it starts.', 'ends_at');
    if (input.endsAt.getTime() - input.startsAt.getTime() > maxSponsoredDays * day) throw invalid('parameter_invalid', `Run it for ${maxSponsoredDays} days at most.`, 'ends_at');
  }

  private dates(input: SponsoredInput, fallback?: { startsAt: Date; endsAt: Date }) {
    const parse = (value: string | undefined, param: string, otherwise?: Date) => {
      if (value === undefined) {
        if (otherwise) return otherwise;
        throw invalid('parameter_missing', 'Choose when.', param);
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw invalid('parameter_invalid', 'Use a date and time.', param);
      return date;
    };
    return { startsAt: parse(input.starts_at, 'starts_at', fallback?.startsAt), endsAt: parse(input.ends_at, 'ends_at', fallback?.endsAt) };
  }

  async create(actorId: string | null, input: SponsoredInput) {
    if (input.listing_ref === undefined) throw invalid('parameter_missing', 'Give the listing’s number.', 'listing_ref');
    const listing = await this.prisma.classifiedListing.findUnique({ where: { ref: BigInt(input.listing_ref) }, select: { id: true, country: true, status: true, onShop: true } });
    if (!listing) throw invalid('resource_missing', 'No listing has that number.', 'listing_ref');
    if (!isOnShop(listing)) throw invalid('listing_not_live', 'Only a listing for sale on Udozo can be sponsored.', 'listing_ref');
    const country = input.country ? input.country.toUpperCase() : null;
    const { startsAt, endsAt } = this.dates(input);
    await this.check({ listingId: listing.id, listingCountry: listing.country, country, startsAt, endsAt });
    const row = await this.prisma.classifiedSponsoredPlacement.create({
      data: { listingId: listing.id, country, startsAt, endsAt, position: input.position ?? 0, note: input.note?.trim() || null, createdById: actorId, updatedById: actorId },
    });
    this.home.forget();
    await this.audit.record({ actorId, action: 'sponsored_placement.created', targetType: 'sponsored_placement', targetId: row.id, before: null, after: { listing: input.listing_ref, country, starts_at: startsAt, ends_at: endsAt, position: row.position } });
    return (await this.present([await this.one(row.id)]))[0];
  }

  /** Changes a placement's page, dates, position or note (not its listing: place another instead). */
  async update(actorId: string | null, id: string, input: SponsoredInput) {
    const before = await this.one(id);
    if (before.endedAt) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'placement_ended', 'This placement has ended.');
    const country = input.country === undefined ? before.country : input.country ? input.country.toUpperCase() : null;
    const { startsAt, endsAt } = this.dates(input, before);
    await this.check({ listingId: before.listingId, listingCountry: before.listing.country, country, startsAt, endsAt });
    await this.prisma.classifiedSponsoredPlacement.update({
      where: { id },
      data: { country, startsAt, endsAt, position: input.position ?? before.position, note: input.note === undefined ? before.note : input.note?.trim() || null, updatedById: actorId },
    });
    this.home.forget();
    await this.audit.record({ actorId, action: 'sponsored_placement.updated', targetType: 'sponsored_placement', targetId: id, before: { country: before.country, starts_at: before.startsAt, ends_at: before.endsAt, position: before.position }, after: { country, starts_at: startsAt, ends_at: endsAt, position: input.position ?? before.position } });
    return (await this.present([await this.one(id)]))[0];
  }

  /** Ends a placement now; it is kept for the record. */
  async end(actorId: string | null, id: string) {
    const before = await this.one(id);
    if (!before.endedAt) await this.prisma.classifiedSponsoredPlacement.update({ where: { id }, data: { endedAt: new Date(), updatedById: actorId } });
    this.home.forget();
    if (!before.endedAt) await this.audit.record({ actorId, action: 'sponsored_placement.ended', targetType: 'sponsored_placement', targetId: id, before: { ends_at: before.endsAt }, after: { ended: true } });
    return (await this.present([await this.one(id)]))[0];
  }
}
