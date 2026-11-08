import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { ApiError } from '../../common/errors/api-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { ClassifiedBoardPost, Prisma } from '../../generated/prisma/client.js';
import { bannerHrefOk, type BannerState } from '../banners.service.js';
import { ShopDirectoryService } from '../directory.service.js';

/** How a post looks on the board: news (the default), a tip, or an alert (something to act on). */
export const boardTones = ['news', 'tip', 'alert'] as const;
export type BoardTone = (typeof boardTones)[number];

export type BoardPostInput = {
  country?: string | null;
  title?: string;
  body?: string;
  tone?: BoardTone;
  href?: string | null;
  link_label?: string | null;
  pinned?: boolean;
  enabled?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
};

/** At most this many posts on a customer's board: pinned ones first, then the newest. */
export const boardShown = 10;

const invalid = (code: string, message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);

/**
 * The account dashboard's message board (8 November 2026, the owner's request): posts Udozo's team writes to its
 * customers, shown on udozo.com's `/account` beside their figures. For one market or every market, on and off by
 * admins (the gate), optionally between two dates, pinned ones first. Plain text with an optional link; every change is
 * audited.
 */
@Injectable()
export class BoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly directory: ShopDirectoryService,
  ) {}

  stateOf(row: Pick<ClassifiedBoardPost, 'enabled' | 'startsAt' | 'endsAt'>, now = new Date()): BannerState {
    if (row.endsAt && row.endsAt <= now) return 'ended';
    if (!row.enabled) return 'off';
    return row.startsAt && row.startsAt > now ? 'scheduled' : 'showing';
  }

  present(row: ClassifiedBoardPost) {
    return {
      object: 'board_post' as const,
      id: row.id,
      country: row.country,
      title: row.title,
      body: row.body,
      tone: row.tone as BoardTone,
      href: row.href,
      link_label: row.linkLabel,
      pinned: row.pinned,
      enabled: row.enabled,
      state: this.stateOf(row),
      starts_at: row.startsAt?.toISOString() ?? null,
      ends_at: row.endsAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  /** What a customer's board shows: their market's posts and every market's, showing now; pinned first, then the newest. */
  async showing(country: string | null) {
    const now = new Date();
    const rows = await this.prisma.classifiedBoardPost.findMany({
      where: {
        enabled: true,
        OR: [{ country: null }, ...(country ? [{ country: country.toUpperCase() }] : [])],
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: boardShown,
    });
    return rows.map(row => ({
      object: 'board_post' as const,
      id: row.id,
      title: row.title,
      body: row.body,
      tone: row.tone as BoardTone,
      href: row.href,
      link_label: row.linkLabel,
      pinned: row.pinned,
      posted_at: (row.startsAt ?? row.createdAt).toISOString(),
    }));
  }

  /** Admins: every post, by market (`global`: those for every market), the newest first. */
  async list(filter: { country?: string }) {
    const where: Prisma.ClassifiedBoardPostWhereInput = filter.country ? { country: filter.country === 'global' ? null : filter.country.toUpperCase() } : {};
    const rows = await this.prisma.classifiedBoardPost.findMany({ where, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 200 });
    return { object: 'list' as const, data: rows.map(row => this.present(row)) };
  }

  private async one(id: string) {
    const row = await this.prisma.classifiedBoardPost.findUnique({ where: { id } });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such post.');
    return row;
  }

  /** The post's fields checked, merged over what it had. */
  private async fields(input: BoardPostInput, before?: ClassifiedBoardPost) {
    const date = (value: string | null | undefined, param: string, otherwise: Date | null) => {
      if (value === undefined) return otherwise;
      if (value === null || value === '') return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) throw invalid('parameter_invalid', 'Use a date and time.', param);
      return parsed;
    };
    const country = input.country === undefined ? (before?.country ?? null) : input.country === null ? null : input.country.toUpperCase();
    if (country !== null && !(await this.directory.markets()).data.some(market => market.country === country)) throw invalid('market_unavailable', 'Udozo is not open in that country.', 'country');
    const title = (input.title ?? before?.title ?? '').trim();
    if (!title) throw invalid('parameter_missing', 'Give the post a title.', 'title');
    if (title.length > 100) throw invalid('parameter_invalid', 'Keep the title to 100 characters.', 'title');
    const body = (input.body ?? before?.body ?? '').replace(/\r\n/g, '\n').trim();
    if (!body) throw invalid('parameter_missing', 'Write what the post says.', 'body');
    if (body.length > 1000) throw invalid('parameter_invalid', 'Keep the post to 1,000 characters.', 'body');
    const tone = input.tone ?? (before?.tone as BoardTone | undefined) ?? 'news';
    if (!boardTones.includes(tone)) throw invalid('parameter_invalid', 'Choose news, a tip or an alert.', 'tone');
    const href = input.href === undefined ? (before?.href ?? null) : input.href?.trim() || null;
    if (href && !bannerHrefOk(href)) throw invalid('parameter_invalid', 'Link to a page on udozo.com (starting with /) or an https address.', 'href');
    const label = input.link_label === undefined ? (before?.linkLabel ?? null) : input.link_label?.trim() || null;
    if (label && label.length > 40) throw invalid('parameter_invalid', 'Keep the link’s words to 40 characters.', 'link_label');
    const startsAt = date(input.starts_at, 'starts_at', before?.startsAt ?? null);
    const endsAt = date(input.ends_at, 'ends_at', before?.endsAt ?? null);
    if (startsAt && endsAt && !(endsAt > startsAt)) throw invalid('parameter_invalid', 'End it after it starts.', 'ends_at');
    return {
      country,
      title,
      body,
      tone,
      href,
      linkLabel: href ? label : null,
      pinned: input.pinned ?? before?.pinned ?? false,
      enabled: input.enabled ?? before?.enabled ?? true,
      startsAt,
      endsAt,
    };
  }

  async create(actorId: string | null, input: BoardPostInput) {
    const row = await this.prisma.classifiedBoardPost.create({ data: { ...(await this.fields(input)), createdById: actorId, updatedById: actorId } });
    await this.audit.record({ actorId, action: 'board_post.created', targetType: 'board_post', targetId: row.id, after: row });
    return this.present(row);
  }

  /** Changes a post; `enabled` alone is the on and off switch, `pinned` alone pins it. */
  async update(actorId: string | null, id: string, input: BoardPostInput) {
    const before = await this.one(id);
    const row = await this.prisma.classifiedBoardPost.update({ where: { id }, data: { ...(await this.fields(input, before)), updatedById: actorId } });
    await this.audit.record({ actorId, action: 'board_post.updated', targetType: 'board_post', targetId: id, before, after: row });
    return this.present(row);
  }

  async remove(actorId: string | null, id: string) {
    const before = await this.one(id);
    await this.prisma.classifiedBoardPost.delete({ where: { id } });
    await this.audit.record({ actorId, action: 'board_post.deleted', targetType: 'board_post', targetId: id, before });
    return { object: 'board_post' as const, id, deleted: true };
  }
}
