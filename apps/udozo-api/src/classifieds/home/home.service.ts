import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { ApiError } from '../../common/errors/api-error.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma, type StorefrontPage } from '../../generated/prisma/client.js';
import { ShopDirectoryService } from '../directory.service.js';
import { HomeResolver } from './home-resolver.js';
import { blocksFor, blocksOf, type HomeRow, type HomeScope, homeSections, parseHomeRows, readRows, rowsFromSections } from './layout.js';
import { defaultLayoutFor, type HomeLayoutKey, homeLayoutFor, homeLayouts } from './layouts.js';

const previewLifetimeMs = 30 * 60_000;
const cacheMs = 60_000;

/** A page as stored: its layout and its rows (`storefront_pages`, key `home:<page>`; pages from before rows had `sections`). */
type Envelope = { layout: HomeLayoutKey; rows: HomeRow[] };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such home page.');
const keyOf = (page: string) => `home:${page}`;
const scopeOf = (page: string): HomeScope => (page === 'global' ? 'global' : 'country');

/**
 * What was stored, read again with today's rules (defaults filled in); anything no longer valid reads as nothing. A page
 * from before rows (drafts, published pages and versions alike) reads as rows that look the same (`rowsFromSections`).
 */
function readEnvelope(value: unknown, scope: HomeScope): Envelope | null {
  if (!value || typeof value !== 'object') return null;
  const stored = value as { layout?: unknown; rows?: unknown; sections?: unknown };
  const layout = typeof stored.layout === 'string' ? homeLayoutFor(stored.layout) : undefined;
  if (!layout) return null;
  if (stored.rows !== undefined) {
    const rows = readRows(stored.rows, scope);
    return rows ? { layout: layout.key, rows } : null;
  }
  const parsed = homeSections.safeParse(stored.sections);
  if (!parsed.success) return null;
  return { layout: layout.key, rows: rowsFromSections(parsed.data.filter(section => blocksFor(scope).includes(section.type))) };
}

const starter = (scope: HomeScope, layout = defaultLayoutFor(scope)): Envelope => ({ layout: layout.key, rows: layout.starter(scope) });

/**
 * udozo.com's home pages: the one across countries (`global`, shown when a visitor chose All countries or nothing) and
 * each open country's (`NG`). Admins choose a layout for each, edit its sections in the home page editor (a draft),
 * preview it with a 30-minute link, publish it (each publish a version that can be restored), take it offline (back to
 * the layout's starting page) or start again. Visitors read the published page, filled with listings when read
 * (`HomeResolver`), cached a minute.
 */
@Injectable()
export class HomeService {
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly directory: ShopDirectoryService,
    private readonly resolver: HomeResolver,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The pages there are: across countries, then each open market. */
  private async pages() {
    const markets = await this.directory.markets();
    return { markets, pages: [{ page: 'global', name: 'All countries' }, ...markets.data.map(market => ({ page: market.country, name: market.name }))] };
  }

  /** A page by its id (`global` or an open market's code), else not found. */
  private async known(page: string) {
    const id = page.toLowerCase() === 'global' ? 'global' : page.toUpperCase();
    const { pages, markets } = await this.pages();
    const found = pages.find(item => item.page === id);
    if (!found) throw notFound();
    return { ...found, scope: scopeOf(id), markets };
  }

  /** The page's row, made with its default layout's starting page the first time an admin opens it. */
  private async row(page: string, scope: HomeScope) {
    const key = keyOf(page);
    const existing = await this.prisma.storefrontPage.findUnique({ where: { key } });
    if (existing) return existing;
    return this.prisma.storefrontPage.upsert({ where: { key }, create: { key, draft: starter(scope) as unknown as Prisma.InputJsonValue }, update: {} });
  }

  private draftOf(row: StorefrontPage, scope: HomeScope) {
    return readEnvelope(row.draft, scope) ?? starter(scope);
  }

  private async present(row: StorefrontPage, page: { page: string; name: string; scope: HomeScope }) {
    const versions = await this.prisma.storefrontPageVersion.findMany({ where: { pageKey: row.key }, orderBy: { version: 'desc' }, take: 20, select: { version: true, publishedAt: true, sections: true } });
    const draft = this.draftOf(row, page.scope);
    const published = readEnvelope(row.published, page.scope);
    return {
      object: 'home_page' as const,
      page: page.page,
      name: page.name,
      scope: page.scope,
      layout: draft.layout,
      rows: draft.rows,
      published_layout: published?.layout ?? null,
      published_rows: published?.rows ?? null,
      /** The blocks as one list, for the editor of before (one release). */
      draft: blocksOf(draft.rows),
      published: published ? blocksOf(published.rows) : null,
      /** The draft differs from what visitors see. */
      unpublished_changes: JSON.stringify(draft) !== JSON.stringify(published),
      live: published !== null,
      version: row.version,
      published_at: row.publishedAt?.toISOString() ?? null,
      updated_at: row.updatedAt.toISOString(),
      versions: versions.map(item => ({ version: item.version, published_at: item.publishedAt.toISOString(), layout: readEnvelope(item.sections, page.scope)?.layout ?? null })),
      layouts: homeLayouts.map(layout => ({ key: layout.key, name: layout.name, description: layout.description, look: layout.look })),
      blocks_allowed: blocksFor(page.scope),
      sections_allowed: blocksFor(page.scope),
    };
  }

  /** Admins: every page with its layout, whether it is live and whether its draft has changes. */
  async list() {
    const { pages } = await this.pages();
    const rows = await this.prisma.storefrontPage.findMany({ where: { key: { in: pages.map(item => keyOf(item.page)) } } });
    return {
      object: 'list' as const,
      data: pages.map(item => {
        const scope = scopeOf(item.page);
        const row = rows.find(entry => entry.key === keyOf(item.page));
        const draft = row ? this.draftOf(row, scope) : starter(scope);
        const published = row ? readEnvelope(row.published, scope) : null;
        return {
          object: 'home_page_summary' as const,
          page: item.page,
          name: item.name,
          scope,
          layout: published?.layout ?? draft.layout,
          live: published !== null,
          version: row?.version ?? 0,
          unpublished_changes: JSON.stringify(draft) !== JSON.stringify(published),
        };
      }),
    };
  }

  async get(page: string) {
    const found = await this.known(page);
    return this.present(await this.row(found.page, found.scope), found);
  }

  /**
   * Saves the draft's rows (validated, defaults filled in); visitors see nothing until it is published. `sections` (the
   * editor of before) are saved as rows that look the same.
   */
  async saveDraft(actorId: string | null, page: string, input: { rows?: unknown; sections?: unknown }) {
    const found = await this.known(page);
    const rows = parseHomeRows(input.rows !== undefined ? input.rows : this.sectionsAsRows(input.sections), found.scope);
    const row = await this.row(found.page, found.scope);
    const draft: Envelope = { layout: this.draftOf(row, found.scope).layout, rows };
    const updated = await this.prisma.storefrontPage.update({ where: { key: row.key }, data: { draft: draft as unknown as Prisma.InputJsonValue, updatedById: actorId } });
    return this.present(updated, found);
  }

  /** Chooses the page's layout (its look), keeping the sections or starting them again from the layout's own. */
  async setLayout(actorId: string | null, page: string, input: { layout: string; replace?: boolean }) {
    const found = await this.known(page);
    const layout = homeLayoutFor(input.layout);
    if (!layout) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Choose one of the layouts.', 'layout');
    const row = await this.row(found.page, found.scope);
    const before = this.draftOf(row, found.scope);
    const draft: Envelope = { layout: layout.key, rows: input.replace ? layout.starter(found.scope) : before.rows };
    const updated = await this.prisma.storefrontPage.update({ where: { key: row.key }, data: { draft: draft as unknown as Prisma.InputJsonValue, updatedById: actorId } });
    await this.audit.record({ actorId, action: 'home_page.layout_changed', targetType: 'home_page', targetId: found.page, before: { layout: before.layout }, after: { layout: layout.key, replaced: Boolean(input.replace) } });
    return this.present(updated, found);
  }

  /** Publishes the draft as the next version: udozo.com shows it within a minute. */
  async publish(actorId: string | null, page: string) {
    const found = await this.known(page);
    const before = await this.row(found.page, found.scope);
    const draft = this.draftOf(before, found.scope);
    // Checked again: what is published must be valid, whatever was saved before the rules changed.
    parseHomeRows(draft.rows, found.scope);
    const row = await this.prisma.$transaction(async tx => {
      // Locked, so two admins publishing at once get consecutive versions.
      await tx.$queryRaw`SELECT key FROM storefront_pages WHERE key = ${before.key} FOR UPDATE`;
      const current = await tx.storefrontPage.findUniqueOrThrow({ where: { key: before.key } });
      const version = current.version + 1;
      await tx.storefrontPageVersion.create({ data: { pageKey: before.key, version, sections: draft as unknown as Prisma.InputJsonValue, publishedById: actorId } });
      return tx.storefrontPage.update({ where: { key: before.key }, data: { published: draft as unknown as Prisma.InputJsonValue, version, publishedAt: new Date(), publishedById: actorId } });
    });
    this.cache.delete(found.page);
    await this.audit.record({ actorId, action: 'home_page.published', targetType: 'home_page', targetId: found.page, before: { version: before.version }, after: { version: row.version, layout: draft.layout, rows: draft.rows.length, blocks: blocksOf(draft.rows).length } });
    return this.present(row, found);
  }

  /** Takes the page offline: visitors see its default layout's starting page until it is published again. */
  async unpublish(actorId: string | null, page: string) {
    const found = await this.known(page);
    const before = await this.row(found.page, found.scope);
    if (before.published === null) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'home_page_not_published', 'This home page is not published.');
    const row = await this.prisma.storefrontPage.update({ where: { key: before.key }, data: { published: Prisma.DbNull } });
    this.cache.delete(found.page);
    await this.audit.record({ actorId, action: 'home_page.unpublished', targetType: 'home_page', targetId: found.page, before: { version: before.version }, after: { live: false } });
    return this.present(row, found);
  }

  /** Copies an earlier published version (its layout and sections) into the draft; publishing makes it live again. */
  async restore(actorId: string | null, page: string, version: number) {
    const found = await this.known(page);
    const key = keyOf(found.page);
    const saved = await this.prisma.storefrontPageVersion.findUnique({ where: { pageKey_version: { pageKey: key, version } } });
    const envelope = saved ? readEnvelope(saved.sections, found.scope) : null;
    if (!envelope) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such version.');
    const row = await this.prisma.storefrontPage.update({ where: { key }, data: { draft: envelope as unknown as Prisma.InputJsonValue, updatedById: actorId } });
    await this.audit.record({ actorId, action: 'home_page.restored', targetType: 'home_page', targetId: found.page, before: null, after: { version, layout: envelope.layout } });
    return this.present(row, found);
  }

  /** Starts the draft again from its layout's starting page. */
  async reset(actorId: string | null, page: string) {
    const found = await this.known(page);
    const before = await this.row(found.page, found.scope);
    const layout = homeLayoutFor(this.draftOf(before, found.scope).layout)!;
    const row = await this.prisma.storefrontPage.update({ where: { key: before.key }, data: { draft: starter(found.scope, layout) as unknown as Prisma.InputJsonValue, updatedById: actorId } });
    await this.audit.record({ actorId, action: 'home_page.reset', targetType: 'home_page', targetId: found.page, before: null, after: { layout: layout.key } });
    return this.present(row, found);
  }

  /** A link showing the page's draft for 30 minutes, signed for that page only. */
  async previewToken(page: string, now = Date.now()) {
    const found = await this.known(page);
    const expires = now + previewLifetimeMs;
    return { object: 'home_preview' as const, page: found.page, token: `${expires}.${this.sign(found.page, expires)}`, expires_at: new Date(expires).toISOString() };
  }

  /** Sponsored placements changed: every page reads them again. */
  forget() {
    this.cache.clear();
  }

  /**
   * What visitors see: the published page (else its default layout's starting page), or the draft through a valid
   * preview link, filled with listings. The page across countries opens with the second market, as the showcase does.
   */
  async home(page: string, preview?: string) {
    const found = await this.known(page);
    if (found.scope === 'global' && !found.markets.showcase) throw notFound();
    if (preview !== undefined && !this.verify(found.page, preview)) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'preview_expired', 'This preview link has expired. Open a new one from the admin app.');
    }
    const cached = preview === undefined ? this.cache.get(found.page) : undefined;
    if (cached && Date.now() - cached.at < cacheMs) return cached.value;

    const row = await this.prisma.storefrontPage.findUnique({ where: { key: keyOf(found.page) } });
    const published = row ? readEnvelope(row.published, found.scope) : null;
    const draft = row ? this.draftOf(row, found.scope) : starter(found.scope);
    const source = preview !== undefined ? ('draft' as const) : published ? ('published' as const) : ('default' as const);
    const envelope = source === 'draft' ? draft : (published ?? starter(found.scope));
    const layout = homeLayoutFor(envelope.layout)!;
    const markets = found.markets.data.map(market => ({ country: market.country, name: market.name, listings: market.listings }));
    const rows = await this.resolver.resolveRows(envelope.rows, this.context(found, markets));
    // `sections`: the blocks as one list, for udozo.com of before (one release).
    const value = { object: 'classified_home' as const, page: found.page, name: found.name, scope: found.scope, layout: layout.key, look: layout.look, source, version: row?.version ?? 0, rows, sections: rows.flatMap(item => item.blocks) };
    if (preview === undefined) this.cache.set(found.page, { at: Date.now(), value });
    return value;
  }

  /** What a page is filled from: the country's listings, or every open market's (no prices). */
  private context(found: { page: string; scope: HomeScope }, markets: Array<{ country: string; name: string; listings: number }>) {
    return { scope: found.scope, country: found.scope === 'country' ? found.page : null, countries: found.scope === 'country' ? [found.page] : markets.map(market => market.country), markets, now: new Date() };
  }

  private sectionsAsRows(sections: unknown) {
    const parsed = homeSections.safeParse(sections);
    // Anything not valid as sections is refused as rows would be.
    return parsed.success ? rowsFromSections(parsed.data) : sections;
  }

  /**
   * The editor's view of rows not saved yet, or of the draft: each block filled as visitors would see it (never
   * cached), so admins see what each block will show (a sold pick, an empty category) before publishing.
   */
  async resolveDraft(page: string, input: { rows?: unknown }) {
    const found = await this.known(page);
    const rows = input.rows !== undefined ? parseHomeRows(input.rows, found.scope) : this.draftOf(await this.row(found.page, found.scope), found.scope).rows;
    const markets = found.markets.data.map(market => ({ country: market.country, name: market.name, listings: market.listings }));
    return { object: 'home_page_resolved' as const, page: found.page, rows: await this.resolver.resolveRows(rows, this.context(found, markets)) };
  }

  /** Resellers' live stores to pick for a stores marquee: the page's country's (across countries, every open market's). */
  async stores(page: string, q?: string) {
    const found = await this.known(page);
    const countries = found.scope === 'country' ? [found.page] : found.markets.data.map(market => market.country);
    const stores = await this.resolver.storeCards({ picks: [], fill: 'newest', limit: 24 }, { countries }, q?.trim().slice(0, 60) || undefined);
    return { object: 'list' as const, data: stores };
  }

  private verify(page: string, token: string, now = Date.now()) {
    const [expiresText, signature] = token.split('.');
    const expires = Number(expiresText);
    if (!Number.isFinite(expires) || expires < now || !signature) return false;
    const expected = this.sign(page, expires);
    return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  private sign(page: string, expires: number) {
    const key = this.config.ENCRYPTION_KEY;
    if (!key) throw new Error('ENCRYPTION_KEY is not configured');
    return createHmac('sha256', key).update(`home-preview:${page}:${expires}`).digest('base64url');
  }
}
