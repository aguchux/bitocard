import { Controller, Get, Header, HttpStatus, Injectable, Param, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { Public } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { brandListingSql, ClassifiedBrandsService } from './brands.service.js';
import { ListingsService, shopOrigin } from './listings.service.js';
import { ProductOnly } from '../products/product.js';
import { modelFeatureKey } from './rules.js';

/** The models a brand page offers as filters, most listed first. */
export const brandPageModels = 40;
/** The registry's categories shown on a brand page with nothing for sale yet ("Be the first to sell"). */
export const brandPageEmptyCategories = 12;

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such brand.');

type Count = { id: string | null; n: number };

class BrandPageDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value)) @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code' })
  country: string;
}

/**
 * A brand's public page in one market (`/<cc>/brand/<slug>`, Udozo): the registry's brand (its name, logo and colour)
 * with what is for sale under it there: how many live listings and sellers, the categories and states they are in, and
 * its models with live listings, most first. A brand with nothing for sale yet shows the categories it sells in. The
 * listings themselves come from the search (`brand=<slug>`), which counts a listing under the brand's every word.
 */
@Injectable()
export class BrandPagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: ClassifiedBrandsService,
    private readonly listings: ListingsService,
  ) {}

  async page(slug: string, country: string) {
    const code = country.toUpperCase();
    await this.listings.requireOpen(code);
    const brand = await this.brands.bySlug(slug);
    if (!brand) throw notFound();
    const live = Prisma.sql`l."country" = ${code} AND l."status" = 'active' AND l."on_shop" AND ${brandListingSql(brand.keys)}`;

    const [totals, byCategory, byState, models, registry] = await Promise.all([
      this.prisma.$queryRaw<{ listings: number; sellers: number; updated_at: Date | null }[]>`
        SELECT count(*)::int AS listings, count(DISTINCT l."customer_id")::int AS sellers, max(l."updated_at") AS updated_at
        FROM "classified_listings" l WHERE ${live}`,
      this.prisma.$queryRaw<Count[]>`SELECT l."category_id" AS id, count(*)::int AS n FROM "classified_listings" l WHERE ${live} GROUP BY 1`,
      this.prisma.$queryRaw<Count[]>`SELECT l."state_id" AS id, count(*)::int AS n FROM "classified_listings" l WHERE ${live} GROUP BY 1`,
      // Models as sellers saved them (the model registry's words, or as typed), one row however it is cased.
      this.prisma.$queryRaw<{ name: string; n: number }[]>`
        SELECT max(mv."value_text") AS name, count(*)::int AS n
        FROM "classified_listings" l
        JOIN "classified_listing_features" mv ON mv."listing_id" = l."id"
        JOIN "classified_features" mf ON mf."id" = mv."feature_id" AND mf."key" = ${modelFeatureKey}
        WHERE ${live} AND mv."value_text" IS NOT NULL AND btrim(mv."value_text") <> ''
        GROUP BY lower(btrim(mv."value_text"))
        ORDER BY 2 DESC, 1 LIMIT ${brandPageModels}`,
      this.prisma.classifiedBrandCategory.findMany({ where: { brandId: brand.row.id }, orderBy: { position: 'asc' }, select: { categoryId: true } }),
    ]);
    const counted = (rows: Count[]) => new Map(rows.filter(row => row.id).map(row => [row.id!, row.n]));
    const categoryCounts = counted(byCategory);
    const stateCounts = counted(byState);
    const listings = totals[0]?.listings ?? 0;
    // Its categories with something for sale; with nothing yet, the registry's categories it sells in.
    const categoryIds = listings ? [...categoryCounts.keys()] : registry.map(link => link.categoryId).slice(0, brandPageEmptyCategories * 2);
    const [categories, states] = await Promise.all([
      this.prisma.classifiedCategory.findMany({ where: { id: { in: categoryIds }, enabled: true, countries: { some: { country: code, enabled: true } } }, include: { parent: true } }),
      this.prisma.classifiedArea.findMany({ where: { id: { in: [...stateCounts.keys()] } } }),
    ]);
    const place = new Map(categoryIds.map((id, index) => [id, index]));
    return {
      ...brand.card,
      object: 'classified_brand_page' as const,
      country: code,
      url: `${shopOrigin}/${code.toLowerCase()}/brand/${brand.row.slug}`,
      /** The banner Udozo's admins gave it (4:1), else null for the page's drawn one. */
      banner_url: brand.row.bannerUrl,
      /** Its live listings in the market, and how many sellers they come from. */
      listings,
      sellers: totals[0]?.sellers ?? 0,
      updated_at: totals[0]?.updated_at?.toISOString() ?? null,
      /** Where its live listings are (most first), or the categories it sells in while it has none. */
      categories: categories
        .map(category => ({ slug: category.slug, name: category.name, icon: category.icon, parent: category.parent ? { slug: category.parent.slug, name: category.parent.name } : null, listings: categoryCounts.get(category.id) ?? 0, place: place.get(category.id) ?? 0 }))
        .sort((a, b) => b.listings - a.listings || (listings ? a.name.localeCompare(b.name) : a.place - b.place))
        .slice(0, listings ? undefined : brandPageEmptyCategories)
        .map(category => ({ slug: category.slug, name: category.name, icon: category.icon, parent: category.parent, listings: category.listings })),
      /** Its models with live listings, most first. */
      models: models.map(row => ({ name: row.name.trim(), listings: row.n })),
      /** The states its live listings are in, most first. */
      states: states.map(state => ({ slug: state.slug, name: state.name, listings: stateCounts.get(state.id) ?? 0 })).sort((a, b) => b.listings - a.listings || a.name.localeCompare(b.name)),
    };
  }
}

/** A brand's public page in a market (`GET /v1/classifieds/brands/:slug?country=`), cached a minute. */
@ApiExcludeController()
@Public()
@Controller('classifieds')
@ProductOnly('udozo')
export class ClassifiedBrandPagesController {
  constructor(private readonly pages: BrandPagesService) {}

  @Get('brands/:slug')
  @Header('Cache-Control', 'public, max-age=60')
  page(@Param('slug') slug: string, @Query() query: BrandPageDto) {
    if (slug.length > 80 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw notFound();
    return this.pages.page(slug, query.country);
  }
}
