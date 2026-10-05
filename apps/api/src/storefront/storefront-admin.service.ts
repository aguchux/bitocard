import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { Prisma, type ProductCategory, type StorefrontPage } from '../generated/prisma/client.js';
import { brandInitials, brandRegistry, registryAssetUrl, registryBrand, registryCardArtUrl, registryIconUrl } from './brand-registry.js';
import { categoryLabels, defaultHome, sections as sectionsSchema } from './layout.js';
import { StorefrontService } from './storefront.service.js';

const homeKey = 'home';

export type BrandInput = {
  name: string;
  company?: string | null;
  description?: string | null;
  logo_url?: string | null;
  image_url?: string | null;
  color?: string | null;
  tags?: string[];
  aliases?: string[];
  featured?: boolean;
  sort_order?: number;
  visible?: boolean;
};

/** Turns a layout validation failure into the API's error shape, naming the field. */
function invalidLayout(issues: Array<{ path: PropertyKey[]; message: string }>) {
  const first = issues[0];
  const param = `sections${first.path.map(part => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('')}`;
  return new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'layout_invalid', first.message, param);
}

/**
 * The Storefront Manager (admin app): the home page's draft, publishing it (each publish is a version that can be
 * restored), taking it offline, preview links, and how brands are presented. Publishing and taking offline are audited.
 */
@Injectable()
export class StorefrontAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storefront: StorefrontService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** The home page, created with the default layout as its first draft. */
  private async page() {
    const existing = await this.prisma.storefrontPage.findUnique({ where: { key: homeKey } });
    if (existing) return existing;
    return this.prisma.storefrontPage.upsert({ where: { key: homeKey }, create: { key: homeKey, draft: defaultHome() as Prisma.InputJsonValue }, update: {} });
  }

  private async present(page: StorefrontPage) {
    const versions = await this.prisma.storefrontPageVersion.findMany({ where: { pageKey: page.key }, orderBy: { version: 'desc' }, take: 20, select: { version: true, publishedAt: true } });
    return {
      object: 'storefront_page' as const,
      key: page.key,
      draft: page.draft,
      published: page.published,
      /** The draft differs from what visitors see. */
      unpublished_changes: JSON.stringify(page.draft) !== JSON.stringify(page.published),
      live: page.published !== null,
      version: page.version,
      published_at: page.publishedAt?.toISOString() ?? null,
      updated_at: page.updatedAt.toISOString(),
      versions: versions.map(item => ({ version: item.version, published_at: item.publishedAt.toISOString() })),
    };
  }

  async get() {
    return this.present(await this.page());
  }

  /** Saves the draft (validated; defaults filled in). Visitors see nothing until it is published. */
  async saveDraft(actorId: string | null, sections: unknown) {
    const parsed = sectionsSchema.safeParse(sections);
    if (!parsed.success) throw invalidLayout(parsed.error.issues);
    await this.page();
    const page = await this.prisma.storefrontPage.update({ where: { key: homeKey }, data: { draft: parsed.data as Prisma.InputJsonValue, updatedById: actorId } });
    return this.present(page);
  }

  /** Publishes the draft as the next version: bitocard.com shows it within a minute. */
  async publish(actorId: string | null) {
    const before = await this.page();
    const parsed = sectionsSchema.safeParse(before.draft);
    if (!parsed.success) throw invalidLayout(parsed.error.issues);
    const page = await this.prisma.$transaction(async tx => {
      // Locked, so two admins publishing at once get consecutive versions.
      await tx.$queryRaw`SELECT key FROM storefront_pages WHERE key = ${homeKey} FOR UPDATE`;
      const current = await tx.storefrontPage.findUniqueOrThrow({ where: { key: homeKey } });
      const version = current.version + 1;
      await tx.storefrontPageVersion.create({ data: { pageKey: homeKey, version, sections: parsed.data as Prisma.InputJsonValue, publishedById: actorId } });
      return tx.storefrontPage.update({
        where: { key: homeKey },
        data: { published: parsed.data as Prisma.InputJsonValue, version, publishedAt: new Date(), publishedById: actorId },
      });
    });
    await this.audit.record({ actorId, action: 'storefront.published', targetType: 'storefront_page', targetId: homeKey, before: { version: before.version }, after: { version: page.version, sections: parsed.data.length } });
    return this.present(page);
  }

  /** Takes the home page offline: the site shows the reseller landing page until it is published again. */
  async unpublish(actorId: string | null) {
    const before = await this.page();
    if (before.published === null) throw new ApiError(HttpStatus.CONFLICT, 'invalid_request_error', 'storefront_not_published', 'The storefront is not published.');
    const page = await this.prisma.storefrontPage.update({ where: { key: homeKey }, data: { published: Prisma.DbNull } });
    await this.audit.record({ actorId, action: 'storefront.unpublished', targetType: 'storefront_page', targetId: homeKey, before: { version: before.version }, after: { live: false } });
    return this.present(page);
  }

  /** Copies an earlier published version into the draft (publish it to make it live again). */
  async restore(actorId: string | null, version: number) {
    const row = await this.prisma.storefrontPageVersion.findUnique({ where: { pageKey_version: { pageKey: homeKey, version } } });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such version.');
    const page = await this.prisma.storefrontPage.update({ where: { key: homeKey }, data: { draft: row.sections as Prisma.InputJsonValue, updatedById: actorId } });
    await this.audit.record({ actorId, action: 'storefront.restored', targetType: 'storefront_page', targetId: homeKey, before: null, after: { version } });
    return this.present(page);
  }

  /** Starts the draft again from the default layout. */
  async reset(actorId: string | null) {
    await this.page();
    const page = await this.prisma.storefrontPage.update({ where: { key: homeKey }, data: { draft: defaultHome() as Prisma.InputJsonValue, updatedById: actorId } });
    return this.present(page);
  }

  previewToken() {
    return { object: 'storefront_preview' as const, ...this.storefront.previewToken() };
  }

  // -- Brands ----------------------------------------------------------------------------------------------------

  /** Every brand products name (with how many products and which categories), and its presentation if set. */
  async brands() {
    await this.storefront.refreshBrandAssets();
    const [grouped, rows] = await Promise.all([
      this.prisma.product.groupBy({ by: ['brand', 'category'], _count: { _all: true } }),
      this.prisma.brand.findMany(),
    ]);
    const slugs = [...new Set([...grouped.map(row => row.brand), ...rows.map(row => row.slug)])];
    return {
      object: 'list' as const,
      data: slugs
        .map(slug => {
          const row = rows.find(item => item.slug === slug) ?? null;
          const products = grouped.filter(item => item.brand === slug);
          return {
            ...this.storefront.presentBrand(slug, row),
            object: 'admin_brand' as const,
            aliases: row ? row.aliases : (registryBrand(slug)?.aliases ?? []),
            /** Known to the brand registry, which supplies its defaults until it is set up. */
            in_registry: registryBrand(slug) !== null,
            featured: row?.featured ?? false,
            sort_order: row?.sortOrder ?? 100,
            visible: row?.visible ?? true,
            configured: row !== null,
            products: products.reduce((sum, item) => sum + item._count._all, 0),
            categories: [...new Set(products.map(item => item.category))],
          };
        })
        .sort((a, b) => Number(b.featured) - Number(a.featured) || a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    };
  }

  async saveBrand(actorId: string | null, slug: string, input: BrandInput) {
    const clean = (list: string[] | undefined) => [...new Set((list ?? []).map(item => item.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    const data = {
      name: input.name.trim(),
      company: input.company?.trim() || null,
      description: input.description?.trim() || null,
      logoUrl: input.logo_url?.trim() || null,
      imageUrl: input.image_url?.trim() || null,
      color: input.color?.trim() || null,
      tags: clean(input.tags),
      aliases: clean(input.aliases),
      featured: input.featured ?? false,
      sortOrder: input.sort_order ?? 100,
      visible: input.visible ?? true,
    };
    const before = await this.prisma.brand.findUnique({ where: { slug } });
    const row = await this.prisma.brand.upsert({ where: { slug }, create: { slug, ...data }, update: data });
    await this.audit.record({ actorId, action: before ? 'brand.updated' : 'brand.created', targetType: 'brand', targetId: slug, before, after: row });
    return (await this.brands()).data.find(item => item.slug === slug)!;
  }

  // -- Brand registry -------------------------------------------------------------------------------------------

  /**
   * Every brand registry entry (`brand-registry.json`) with its logo and card art: an admin upload (Storefront > Brand
   * registry) if there is one, else the file's own, else the bundled icon or card art, else none (initials show). Product counts cover every slug it lists.
   */
  async registry() {
    const [assets, grouped] = await Promise.all([this.prisma.brandAsset.findMany(), this.prisma.product.groupBy({ by: ['brand'], _count: { _all: true } })]);
    const config = this.integrations.config;
    const counts = new Map(grouped.map(row => [row.brand, row._count._all]));
    return {
      object: 'list' as const,
      data: brandRegistry.map(entry => {
        const asset = assets.find(row => row.slug === entry.slug);
        const fileLogo = registryAssetUrl(entry.logo, config);
        const bundled = registryIconUrl(entry, config);
        const fileCard = registryAssetUrl(entry.card, config);
        const bundledCard = registryCardArtUrl(entry, config);
        const slugs = [...new Set([entry.slug, ...entry.slugs])];
        return {
          object: 'brand_registry_entry' as const,
          slug: entry.slug,
          name: entry.name,
          company: entry.company ?? null,
          slugs,
          color: entry.color,
          initials: brandInitials(entry.name, entry.initials),
          aliases: entry.aliases,
          tags: entry.tags,
          logo_url: asset?.logoUrl ?? fileLogo ?? bundled,
          logo_source: asset?.logoUrl ? ('upload' as const) : fileLogo ? ('file' as const) : bundled ? ('bundled' as const) : null,
          card_url: asset?.cardUrl ?? fileCard ?? bundledCard,
          card_source: asset?.cardUrl ? ('upload' as const) : fileCard ? ('file' as const) : bundledCard ? ('bundled' as const) : null,
          products: slugs.reduce((sum, slug) => sum + (counts.get(slug) ?? 0), 0),
          updated_at: asset?.updatedAt.toISOString() ?? null,
        };
      }),
    };
  }

  /** Sets (or clears, with null) a registry entry's uploaded logo or card art. Audited. */
  async saveRegistryAssets(actorId: string | null, slug: string, input: { logo_url?: string | null; card_url?: string | null }) {
    const entry = registryBrand(slug);
    if (!entry || entry.slug !== slug) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such brand in the registry.');
    const data = {
      ...(input.logo_url !== undefined ? { logoUrl: input.logo_url?.trim() || null } : {}),
      ...(input.card_url !== undefined ? { cardUrl: input.card_url?.trim() || null } : {}),
      updatedById: actorId,
    };
    const before = await this.prisma.brandAsset.findUnique({ where: { slug } });
    const after = await this.prisma.brandAsset.upsert({ where: { slug }, create: { slug, ...data }, update: data });
    await this.audit.record({ actorId, action: 'brand_registry.assets_updated', targetType: 'brand_registry', targetId: slug, before, after });
    await this.storefront.refreshBrandAssets(true);
    return (await this.registry()).data.find(item => item.slug === slug)!;
  }

  // -- Categories ------------------------------------------------------------------------------------------------

  /** Every category with its icon and image (labels are fixed in code), and how many products it has. */
  async categories() {
    const [rows, counts] = await Promise.all([this.prisma.categoryPresentation.findMany(), this.prisma.product.groupBy({ by: ['category'], _count: { _all: true } })]);
    return {
      object: 'list' as const,
      data: (Object.keys(categoryLabels) as ProductCategory[]).map(category => {
        const row = rows.find(item => item.category === category);
        return {
          object: 'admin_category' as const,
          category,
          label: categoryLabels[category],
          icon_url: row?.iconUrl ?? null,
          image_url: row?.imageUrl ?? null,
          products: counts.find(item => item.category === category)?._count._all ?? 0,
        };
      }),
    };
  }

  async saveCategory(actorId: string | null, category: ProductCategory, input: { icon_url?: string | null; image_url?: string | null }) {
    const data = { iconUrl: input.icon_url?.trim() || null, imageUrl: input.image_url?.trim() || null, updatedById: actorId };
    const before = await this.prisma.categoryPresentation.findUnique({ where: { category } });
    const row = await this.prisma.categoryPresentation.upsert({ where: { category }, create: { category, ...data }, update: data });
    await this.audit.record({ actorId, action: 'category.presentation_updated', targetType: 'category', targetId: category, before, after: row });
    return (await this.categories()).data.find(item => item.category === category)!;
  }
}
