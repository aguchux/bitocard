import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ClassifiedBanner, Prisma } from '../generated/prisma/client.js';
import { ShopDirectoryService } from './directory.service.js';

/**
 * Where on udozo.com a banner shows. `account_rail`: the account pages, above the menu on the left (desktops; the
 * rail's width, 15rem). On the account dashboard (`/account`, 8 November 2026): `dashboard_top`, a wide strip beside
 * the title (under it on phones); `dashboard_side`, under the message board; `dashboard_main`, under the chart. A new
 * place is a new key here, on udozo.com and in the admin's `bannerPlaces`.
 */
export const bannerPositions = ['account_rail', 'dashboard_top', 'dashboard_side', 'dashboard_main'] as const;
export type BannerPosition = (typeof bannerPositions)[number];

export type BannerState = 'showing' | 'off' | 'scheduled' | 'ended';
export type BannerInput = {
  position?: BannerPosition;
  country?: string | null;
  image_url?: string;
  href?: string;
  alt?: string;
  enabled?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  note?: string | null;
};

const invalid = (code: string, message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);

/** A page on udozo.com (`/…`, never `//…`) or an https address elsewhere. */
export function bannerHrefOk(href: string) {
  if (href.length > 500) return false;
  if (href.startsWith('/')) return !href.startsWith('//') && !href.includes('\\');
  try {
    return new URL(href).protocol === 'https:';
  } catch {
    return false;
  }
}

const imageOk = (url: string) => {
  try {
    return url.length <= 500 && new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Banner ads Udozo's team places on udozo.com (no advertiser pays through Udozo yet): an image linking to a page, on
 * one market or all of them, switched on and off by admins (the gate), optionally between two dates. A market's own
 * banners win over those for all markets; udozo.com shows one of them, labelled Ad. Every change is audited, and
 * udozo.com reads them within a minute.
 */
@Injectable()
export class BannersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly directory: ShopDirectoryService,
  ) {}

  stateOf(row: Pick<ClassifiedBanner, 'enabled' | 'startsAt' | 'endsAt'>, now = new Date()): BannerState {
    if (row.endsAt && row.endsAt <= now) return 'ended';
    if (!row.enabled) return 'off';
    return row.startsAt && row.startsAt > now ? 'scheduled' : 'showing';
  }

  present(row: ClassifiedBanner) {
    return {
      object: 'banner' as const,
      id: row.id,
      position: row.position as BannerPosition,
      /** A market's code, or null for every market. */
      country: row.country,
      image_url: row.imageUrl,
      href: row.href,
      alt: row.alt,
      enabled: row.enabled,
      state: this.stateOf(row),
      starts_at: row.startsAt?.toISOString() ?? null,
      ends_at: row.endsAt?.toISOString() ?? null,
      note: row.note,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  /** Admins: every banner, by place and market (`global`: those for every market), the newest first. */
  async list(filter: { position?: BannerPosition; country?: string }) {
    const where: Prisma.ClassifiedBannerWhereInput = {
      ...(filter.position ? { position: filter.position } : {}),
      ...(filter.country ? { country: filter.country === 'global' ? null : filter.country.toUpperCase() } : {}),
    };
    const rows = await this.prisma.classifiedBanner.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    return { object: 'list' as const, data: rows.map(row => this.present(row)) };
  }

  /**
   * What udozo.com shows in a place for a market: its own banners showing now, else those for every market. Only what
   * the page needs (never the team's note).
   */
  async showing(position: BannerPosition, country: string | null) {
    const now = new Date();
    const live: Prisma.ClassifiedBannerWhereInput = {
      position,
      enabled: true,
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    };
    const code = country?.toUpperCase() ?? null;
    let rows = code ? await this.prisma.classifiedBanner.findMany({ where: { ...live, country: code }, orderBy: { createdAt: 'desc' }, take: 10 }) : [];
    if (!rows.length) rows = await this.prisma.classifiedBanner.findMany({ where: { ...live, country: null }, orderBy: { createdAt: 'desc' }, take: 10 });
    return { object: 'list' as const, position, data: rows.map(row => ({ object: 'banner' as const, id: row.id, image_url: row.imageUrl, href: row.href, alt: row.alt })) };
  }

  private async one(id: string) {
    const row = await this.prisma.classifiedBanner.findUnique({ where: { id } });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such banner.');
    return row;
  }

  /** The banner's fields checked, merged over what it had. */
  private async fields(input: BannerInput, before?: ClassifiedBanner) {
    const date = (value: string | null | undefined, param: string, otherwise: Date | null) => {
      if (value === undefined) return otherwise;
      if (value === null || value === '') return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) throw invalid('parameter_invalid', 'Use a date and time.', param);
      return parsed;
    };
    const position = input.position ?? (before?.position as BannerPosition | undefined);
    if (!position || !bannerPositions.includes(position)) throw invalid('parameter_missing', 'Choose where it shows.', 'position');
    const country = input.country === undefined ? (before?.country ?? null) : input.country === null ? null : input.country.toUpperCase();
    if (country !== null && !(await this.directory.markets()).data.some(market => market.country === country)) throw invalid('market_unavailable', 'Udozo is not open in that country.', 'country');
    const imageUrl = (input.image_url ?? before?.imageUrl ?? '').trim();
    if (!imageUrl) throw invalid('parameter_missing', 'Add the banner’s image.', 'image_url');
    if (!imageOk(imageUrl)) throw invalid('parameter_invalid', 'Upload the image, or use an https address.', 'image_url');
    const href = (input.href ?? before?.href ?? '').trim();
    if (!href) throw invalid('parameter_missing', 'Add where it links to.', 'href');
    if (!bannerHrefOk(href)) throw invalid('parameter_invalid', 'Link to a page on udozo.com (starting with /) or an https address.', 'href');
    const alt = (input.alt ?? before?.alt ?? '').trim();
    if (!alt) throw invalid('parameter_missing', 'Describe the banner for people who cannot see it.', 'alt');
    if (alt.length > 120) throw invalid('parameter_invalid', 'Keep the description to 120 characters.', 'alt');
    const startsAt = date(input.starts_at, 'starts_at', before?.startsAt ?? null);
    const endsAt = date(input.ends_at, 'ends_at', before?.endsAt ?? null);
    if (startsAt && endsAt && !(endsAt > startsAt)) throw invalid('parameter_invalid', 'End it after it starts.', 'ends_at');
    const note = input.note === undefined ? (before?.note ?? null) : input.note?.trim() || null;
    return { position, country, imageUrl, href, alt, enabled: input.enabled ?? before?.enabled ?? true, startsAt, endsAt, note };
  }

  async create(actorId: string | null, input: BannerInput) {
    const row = await this.prisma.classifiedBanner.create({ data: { ...(await this.fields(input)), createdById: actorId, updatedById: actorId } });
    await this.audit.record({ actorId, action: 'banner.created', targetType: 'banner', targetId: row.id, after: row });
    return this.present(row);
  }

  /** Changes a banner; `enabled` alone is the on and off switch. */
  async update(actorId: string | null, id: string, input: BannerInput) {
    const before = await this.one(id);
    const row = await this.prisma.classifiedBanner.update({ where: { id }, data: { ...(await this.fields(input, before)), updatedById: actorId } });
    await this.audit.record({ actorId, action: 'banner.updated', targetType: 'banner', targetId: id, before, after: row });
    return this.present(row);
  }

  async remove(actorId: string | null, id: string) {
    const before = await this.one(id);
    await this.prisma.classifiedBanner.delete({ where: { id } });
    await this.audit.record({ actorId, action: 'banner.deleted', targetType: 'banner', targetId: id, before });
    return { object: 'banner' as const, id, deleted: true };
  }
}
