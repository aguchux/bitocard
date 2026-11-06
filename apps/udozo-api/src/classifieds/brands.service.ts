import { Body, Controller, Get, Header, HttpCode, HttpStatus, Injectable, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type ClassifiedBrand } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { ProductOnly } from '../products/product.js';
import { brandFeatureKey, brandKey, invalid, linkPattern, slugify } from './rules.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);

/** A stored value as `brandKey` reads it, in SQL (the accents sellers use, then letters and digits only). */
export const brandKeySql = (column: Prisma.Sql) =>
  Prisma.sql`regexp_replace(translate(lower(${column}), 'àáâäãåçèéêëìíîïñòóôöõùúûüýÿšžčćœ', 'aaaaaaceeeeiiiinooooouuuuyyszcco'), '[^a-z0-9]', '', 'g')`;

/**
 * A listing (aliased `l`) whose brand feature is one of these keys: the brand's own name or any of its words, so a
 * listing saved before the registry knew a spelling still counts.
 */
export const brandListingSql = (keys: string[]) =>
  Prisma.sql`EXISTS (SELECT 1 FROM "classified_listing_features" blf JOIN "classified_features" bf ON bf."id" = blf."feature_id" AND bf."key" = ${brandFeatureKey}
    WHERE blf."listing_id" = l."id" AND blf."value_text" IS NOT NULL AND ${brandKeySql(Prisma.sql`blf."value_text"`)} = ANY(${keys}::text[]))`;

/** A seller's new brands are noted at most this many times a day (the rest are still saved, just not counted). */
export const brandSuggestionsPerDay = 20;
/** How long each instance keeps its copy of the registry (admins' changes clear it at once on their instance). */
const cacheMs = 60_000;

const presentCategory = (category: { id: string; slug: string; name: string }) => ({ id: category.id, slug: category.slug, name: category.name });

class BrandsQueryDto {
  /** A category's slug or id: its brands (a top category's: its subcategories'), most listed first. */
  @IsOptional() @IsString() @Length(1, 80)
  category?: string;

  /** What the seller or buyer typed: brands whose name or other words start with or contain it. */
  @IsOptional() @IsString() @Length(1, 60)
  q?: string;

  /** Counts each brand's live listings there. */
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number;
}

class AdminBrandsQueryDto {
  @IsOptional() @IsString() @Length(1, 60)
  q?: string;

  @IsOptional() @IsString() @Length(1, 80)
  category?: string;

  /** missing (no logo), bundled (udozo.com's) or uploaded (an admin's). */
  @IsOptional() @IsIn(['missing', 'bundled', 'uploaded'])
  logo?: 'missing' | 'bundled' | 'uploaded';

  @IsOptional() @IsIn(['enabled', 'disabled'])
  status?: 'enabled' | 'disabled';

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000)
  offset?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

class BrandFieldsDto {
  @IsOptional() @IsString() @Length(1, 60)
  name?: string;

  /** What sellers type instead: model lines, short names, other spellings. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Length(1, 40, { each: true })
  aliases?: string[];

  /** `#RRGGBB`, behind the initials while it has no logo; null for Udozo's choice. */
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/)
  color?: string | null;

  /** An uploaded logo (`classified_brand_logo`); null goes back to the bundled one, if any. */
  @IsOptional() @IsString() @Matches(/^https:\/\/\S+$/) @Length(10, 2000)
  logo_url?: string | null;

  /** The subcategories it sells in; a new one goes last among each category's brands. */
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true })
  category_ids?: string[];

  @IsOptional() @IsBoolean()
  enabled?: boolean;
}

class CreateBrandDto extends BrandFieldsDto {
  @IsString() @Length(1, 60)
  override name: string = '';
}

class DismissBrandDto {
  @IsString() @Length(1, 60)
  name_key: string;
}

type Row = ClassifiedBrand & { categories: { categoryId: string; position: number; category: { id: string; slug: string; name: string } }[]; _count: { models: number } };

/**
 * Udozo's brand registry: the brands sellers pick for the `brand` feature (each in the categories it sells in, with the
 * words sellers type for it and a logo), the public lists the listing form and the filters read, keeping listings'
 * values in the registry's words, and the brands sellers typed that it lacks (added or dismissed by admins).
 */
@Injectable()
export class ClassifiedBrandsService {
  private cache: { at: number; rows: ClassifiedBrand[]; byKey: Map<string, ClassifiedBrand>; byId: Map<string, ClassifiedBrand> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** Every enabled brand, and each by its keys; kept a minute. */
  private async registry() {
    if (this.cache && Date.now() - this.cache.at < cacheMs) return this.cache;
    const rows = await this.prisma.classifiedBrand.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } });
    const byKey = new Map<string, ClassifiedBrand>();
    for (const row of rows) for (const key of [row.nameKey, ...row.matchKeys]) if (!byKey.has(key)) byKey.set(key, row);
    this.cache = { at: Date.now(), rows, byKey, byId: new Map(rows.map(row => [row.id, row])) };
    return this.cache;
  }

  private forget() {
    this.cache = null;
  }

  /** The registry's brand a seller's value names, if any ("benz" is Mercedes-Benz). */
  async match(value: string) {
    const key = brandKey(value);
    return key ? ((await this.registry()).byKey.get(key) ?? null) : null;
  }

  /** The registry's brand of a listing's value, as the public lists show one (its logo, its colour), or null. */
  async lookup(value: string | null | undefined) {
    const row = value ? await this.match(value) : null;
    return row ? this.present(row) : null;
  }

  /** A seller's value in the registry's words, or as typed when the registry lacks it. */
  async canonical(value: string) {
    return (await this.match(value))?.name ?? value;
  }

  /** A registry brand by its id, as the public lists show one, or null when it is off. */
  async card(id: string) {
    const row = (await this.registry()).byId.get(id);
    return row ? this.present(row) : null;
  }

  /** An enabled brand by its address (`/<cc>/brand/<slug>`), with every key its listings may be saved under; null when there is none or it is off. */
  async bySlug(slug: string) {
    const row = (await this.registry()).rows.find(brand => brand.slug === slug);
    return row ? { row, keys: [...new Set([row.nameKey, ...row.matchKeys])], card: this.present(row) } : null;
  }

  /** Live listings and their newest change per enabled brand in a country, by the brand's slug (its sitemap entries). */
  async liveBySlug(country: string) {
    const rows = await this.prisma.$queryRaw<{ value: string; n: number; updated_at: Date }[]>`
      SELECT lf."value_text" AS "value", count(*)::int AS "n", max(l."updated_at") AS "updated_at"
      FROM "classified_listing_features" lf
      JOIN "classified_features" f ON f."id" = lf."feature_id" AND f."key" = ${brandFeatureKey}
      JOIN "classified_listings" l ON l."id" = lf."listing_id"
      WHERE l."country" = ${country} AND l."status" = 'active' AND l."on_shop" = true AND lf."value_text" IS NOT NULL
      GROUP BY lf."value_text"`;
    const { byKey } = await this.registry();
    const found = new Map<string, { listings: number; updated: Date }>();
    for (const row of rows) {
      const brand = byKey.get(brandKey(row.value));
      if (!brand) continue;
      const seen = found.get(brand.slug);
      found.set(brand.slug, { listings: (seen?.listings ?? 0) + row.n, updated: seen && seen.updated > row.updated_at ? seen.updated : row.updated_at });
    }
    return found;
  }

  /** The brands these categories sell. */
  async inCategories(ids: string[]) {
    return (await this.prisma.classifiedBrandCategory.findMany({ where: { categoryId: { in: ids } }, select: { brandId: true } })).map(link => link.brandId);
  }

  /** Notes a brand the registry lacks, once per seller (it is saved on the listing all the same). Never throws. */
  async note(customerId: string, name: string, categoryId: string | null) {
    try {
      const nameKey = brandKey(name);
      if (!nameKey || (await this.match(name))) return;
      if (await this.prisma.classifiedBrandSuggestion.findFirst({ where: { customerId, nameKey, status: 'open' }, select: { id: true } })) return;
      const today = await this.prisma.classifiedBrandSuggestion.count({ where: { customerId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
      if (today >= brandSuggestionsPerDay) return;
      await this.prisma.classifiedBrandSuggestion.create({ data: { customerId, name: name.replace(/\s+/g, ' ').trim().slice(0, 60), nameKey, categoryId } });
    } catch {
      // A parallel save noted it first, or the category went: nothing to do.
    }
  }

  /** Its logo: an admin's upload, else the one bundled with udozo.com, else none (the apps draw its initials). */
  private logo(row: ClassifiedBrand) {
    if (row.logoUrl) return row.logoUrl;
    if (!row.logoFile) return null;
    return `${this.integrations.config.STOREFRONT_URL.replace(/\/+$/, '')}/brand-logos/${row.logoFile}.svg`;
  }

  private present(row: ClassifiedBrand, listings?: number) {
    return { object: 'classified_brand' as const, slug: row.slug, name: row.name, logo_url: this.logo(row), color: row.color, ...(listings !== undefined ? { listings } : {}) };
  }

  /** The category and, for a top category, its subcategories. */
  async categoryIds(category: string) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(category);
    const row = await this.prisma.classifiedCategory.findFirst({ where: uuid ? { id: category } : { slug: category }, include: { children: { select: { id: true } } } });
    if (!row) throw invalid('parameter_invalid', 'No such category.', 'category');
    return [row.id, ...row.children.map(child => child.id)];
  }

  /** Live listings per registry brand in a country (and categories), by the brand's id. */
  private async counts(country: string, categoryIds: string[] | null) {
    const rows = await this.prisma.$queryRaw<{ value: string; n: number }[]>`
      SELECT lf."value_text" AS "value", count(*)::int AS "n"
      FROM "classified_listing_features" lf
      JOIN "classified_features" f ON f."id" = lf."feature_id" AND f."key" = ${brandFeatureKey}
      JOIN "classified_listings" l ON l."id" = lf."listing_id"
      WHERE l."country" = ${country} AND l."status" = 'active' AND l."on_shop" = true AND lf."value_text" IS NOT NULL
        ${categoryIds ? Prisma.sql`AND l."category_id" = ANY(${categoryIds}::uuid[])` : Prisma.empty}
      GROUP BY lf."value_text"`;
    const { byKey } = await this.registry();
    const counts = new Map<string, number>();
    for (const row of rows) {
      const brand = byKey.get(brandKey(row.value));
      if (brand) counts.set(brand.id, (counts.get(brand.id) ?? 0) + row.n);
    }
    return counts;
  }

  /**
   * Brands for the listing form and the filters: a category's (most listed in the country first, then the registry's
   * order), or those matching what was typed (the category's first). One of the two is needed.
   */
  async list(input: BrandsQueryDto) {
    if (!input.category && !input.q?.trim()) throw invalid('parameter_missing', 'Give a category or some words.', 'category');
    const { rows } = await this.registry();
    const ids = input.category ? await this.categoryIds(input.category) : null;
    const place = new Map<string, number>();
    if (ids) {
      const links = await this.prisma.classifiedBrandCategory.findMany({ where: { categoryId: { in: ids } }, select: { brandId: true, position: true } });
      for (const link of links) place.set(link.brandId, Math.min(place.get(link.brandId) ?? Infinity, link.position));
    }
    const counts = input.country ? await this.counts(input.country, ids) : null;
    const words = brandKey(input.q ?? '');
    let picked: ClassifiedBrand[];
    if (words) {
      const score = (row: ClassifiedBrand) => {
        const keys = [row.nameKey, ...row.matchKeys];
        const base = row.nameKey === words ? 6 : keys.includes(words) ? 5 : row.nameKey.startsWith(words) ? 4 : keys.some(key => key.startsWith(words)) ? 3 : words.length >= 3 && keys.some(key => key.includes(words)) ? 1 : 0;
        return base && place.has(row.id) ? base + 10 : base;
      };
      picked = rows
        .map(row => ({ row, score: score(row) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || (counts?.get(b.row.id) ?? 0) - (counts?.get(a.row.id) ?? 0) || a.row.name.localeCompare(b.row.name))
        .map(item => item.row)
        .slice(0, input.limit ?? 20);
    } else {
      picked = rows
        .filter(row => place.has(row.id))
        .sort((a, b) => (counts?.get(b.id) ?? 0) - (counts?.get(a.id) ?? 0) || place.get(a.id)! - place.get(b.id)! || a.name.localeCompare(b.name))
        .slice(0, input.limit ?? 200);
    }
    return { object: 'list' as const, data: picked.map(row => this.present(row, counts ? (counts.get(row.id) ?? 0) : undefined)) };
  }

  // ---- Admins ----

  private presentAdmin(row: Row, listings: number) {
    const bundled = row.logoFile ? `${this.integrations.config.STOREFRONT_URL.replace(/\/+$/, '')}/brand-logos/${row.logoFile}.svg` : null;
    return {
      ...this.present(row),
      id: row.id,
      aliases: row.aliases,
      logo_source: row.logoUrl ? ('uploaded' as const) : row.logoFile ? ('bundled' as const) : null,
      bundled_logo_url: bundled,
      uploaded_logo_url: row.logoUrl,
      enabled: row.enabled,
      categories: [...row.categories].sort((a, b) => a.category.name.localeCompare(b.category.name)).map(link => presentCategory(link.category)),
      listings,
      models: row._count.models,
      updated_at: row.updatedAt.toISOString(),
    };
  }

  /** Live listings per brand everywhere, by the brand's id (admins' "Used by"). */
  private async allCounts() {
    const rows = await this.prisma.$queryRaw<{ value: string; n: number }[]>`
      SELECT lf."value_text" AS "value", count(*)::int AS "n"
      FROM "classified_listing_features" lf
      JOIN "classified_features" f ON f."id" = lf."feature_id" AND f."key" = ${brandFeatureKey}
      JOIN "classified_listings" l ON l."id" = lf."listing_id"
      WHERE l."status" = 'active' AND lf."value_text" IS NOT NULL
      GROUP BY lf."value_text"`;
    const all = await this.prisma.classifiedBrand.findMany({ select: { id: true, nameKey: true, matchKeys: true } });
    const byKey = new Map<string, string>();
    for (const row of all) for (const key of [row.nameKey, ...row.matchKeys]) if (!byKey.has(key)) byKey.set(key, row.id);
    const counts = new Map<string, number>();
    for (const row of rows) {
      const id = byKey.get(brandKey(row.value));
      if (id) counts.set(id, (counts.get(id) ?? 0) + row.n);
    }
    return counts;
  }

  private include = { categories: { include: { category: { select: { id: true, slug: true, name: true } } } }, _count: { select: { models: true } } } as const;

  /** The registry a page at a time: by words, category, logo or status; with the categories and live ads of each. */
  async adminList(input: AdminBrandsQueryDto) {
    const words = input.q?.trim();
    const key = brandKey(words ?? '');
    const ids = input.category ? await this.categoryIds(input.category) : null;
    const where: Prisma.ClassifiedBrandWhereInput = {
      ...(words ? { OR: [{ name: { contains: words, mode: 'insensitive' } }, ...(key ? [{ nameKey: { contains: key } }, { matchKeys: { has: key } }] : [])] } : {}),
      ...(ids ? { categories: { some: { categoryId: { in: ids } } } } : {}),
      ...(input.logo === 'missing' ? { logoUrl: null, logoFile: null } : input.logo === 'bundled' ? { logoUrl: null, logoFile: { not: null } } : input.logo === 'uploaded' ? { logoUrl: { not: null } } : {}),
      ...(input.status ? { enabled: input.status === 'enabled' } : {}),
    };
    const limit = input.limit ?? 50;
    const [rows, total, counts] = await Promise.all([
      this.prisma.classifiedBrand.findMany({ where, include: this.include, orderBy: { name: 'asc' }, skip: input.offset ?? 0, take: limit }),
      this.prisma.classifiedBrand.count({ where }),
      this.allCounts(),
    ]);
    return { object: 'list' as const, data: rows.map(row => this.presentAdmin(row, counts.get(row.id) ?? 0)), total, offset: input.offset ?? 0, limit };
  }

  async adminGet(slug: string) {
    const row = await this.prisma.classifiedBrand.findUnique({ where: { slug }, include: this.include });
    if (!row) throw notFound('brand');
    return this.presentAdmin(row, (await this.allCounts()).get(row.id) ?? 0);
  }

  /** The name and aliases checked and keyed; no other brand may own any of the keys. */
  private async checkWords(name: string, aliases: string[], currentId: string | null) {
    const clean = name.replace(/\s+/g, ' ').trim();
    const nameKey = brandKey(clean);
    if (!nameKey) throw invalid('parameter_invalid', 'Name the brand with letters or digits.', 'name');
    for (const text of [clean, ...aliases]) if (linkPattern.test(text)) throw invalid('parameter_invalid', 'Links, web addresses and HTML are not allowed.', text === clean ? 'name' : 'aliases');
    const words = [...new Map(aliases.map(alias => alias.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean).map(alias => [brandKey(alias), alias] as const)).entries()].filter(([aliasKey]) => aliasKey && aliasKey !== nameKey);
    const matchKeys = [nameKey, ...words.map(([aliasKey]) => aliasKey)];
    const taken = await this.prisma.classifiedBrand.findMany({ where: { id: currentId ? { not: currentId } : undefined, OR: [{ nameKey: { in: matchKeys } }, { matchKeys: { hasSome: matchKeys } }] }, select: { name: true, nameKey: true, matchKeys: true } });
    for (const other of taken) {
      if (other.nameKey === nameKey || other.matchKeys.includes(nameKey)) throw conflict('brand_exists', `${other.name} is already in the registry${other.nameKey === nameKey ? '' : ' under this name'}.`, 'name');
      const clash = words.find(([aliasKey]) => other.nameKey === aliasKey || other.matchKeys.includes(aliasKey));
      if (clash) throw conflict('brand_alias_taken', `“${clash[1]}” already finds ${other.name}.`, 'aliases');
    }
    return { name: clean, nameKey, aliases: words.map(([, alias]) => alias), matchKeys };
  }

  private async checkCategories(ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await this.prisma.classifiedCategory.findMany({ where: { id: { in: unique } }, select: { id: true, parentId: true } });
    if (found.length !== unique.length || found.some(row => !row.parentId)) throw invalid('parameter_invalid', 'Choose subcategories only.', 'category_ids');
    return unique;
  }

  /** Puts the brand in exactly these categories: kept ones keep their place, new ones go last. */
  private async setCategories(tx: Prisma.TransactionClient, brandId: string, ids: string[]) {
    await tx.classifiedBrandCategory.deleteMany({ where: { brandId, categoryId: { notIn: ids } } });
    const kept = new Set((await tx.classifiedBrandCategory.findMany({ where: { brandId }, select: { categoryId: true } })).map(row => row.categoryId));
    for (const categoryId of ids.filter(id => !kept.has(id))) {
      const last = await tx.classifiedBrandCategory.aggregate({ where: { categoryId }, _max: { position: true } });
      await tx.classifiedBrandCategory.create({ data: { brandId, categoryId, position: (last._max.position ?? -1) + 1 } });
    }
  }

  /**
   * Listings whose brand is one of these keys read as the brand's name, and sellers' open suggestions of them are
   * answered; returns how many of each.
   */
  private async adopt(tx: Prisma.TransactionClient, brand: { id: string; name: string }, keys: string[], actorId: string | null) {
    const values = await tx.$executeRaw`
      UPDATE "classified_listing_features" lf SET "value_text" = ${brand.name}
      WHERE lf."feature_id" = (SELECT "id" FROM "classified_features" WHERE "key" = ${brandFeatureKey})
        AND ${brandKeySql(Prisma.sql`lf."value_text"`)} = ANY(${keys}::text[])
        AND lf."value_text" <> ${brand.name}`;
    const answered = await tx.classifiedBrandSuggestion.updateMany({ where: { status: 'open', nameKey: { in: keys } }, data: { status: 'added', brandId: brand.id, decidedById: actorId, decidedAt: new Date() } });
    return { listings_renamed: values, suggestions_answered: answered.count };
  }

  async create(actorId: string | null, input: CreateBrandDto) {
    const words = await this.checkWords(input.name, input.aliases ?? [], null);
    const categories = input.category_ids ? await this.checkCategories(input.category_ids) : [];
    let slug = slugify(words.name);
    for (let n = 2; await this.prisma.classifiedBrand.count({ where: { slug } }); n += 1) slug = `${slugify(words.name).slice(0, 56)}-${n}`;
    const result = await this.prisma.$transaction(async tx => {
      const row = await tx.classifiedBrand.create({ data: { slug, ...words, color: input.color?.toUpperCase() ?? null, logoUrl: input.logo_url ?? null, enabled: input.enabled ?? true } });
      await this.setCategories(tx, row.id, categories);
      return { row, adopted: await this.adopt(tx, row, words.matchKeys, actorId) };
    });
    this.forget();
    const saved = await this.adminGet(result.row.slug);
    await this.audit.record({ actorId, action: 'classifieds.brand_created', targetType: 'classified_brand', targetId: result.row.id, before: null, after: { ...saved, ...result.adopted } });
    return { ...saved, ...result.adopted };
  }

  /** Changes a brand. A new name keeps the old one as an alias, and listings follow it; its address stays. */
  async update(actorId: string | null, slug: string, input: BrandFieldsDto) {
    const current = await this.prisma.classifiedBrand.findUnique({ where: { slug } });
    if (!current) throw notFound('brand');
    const before = await this.adminGet(slug);
    const renamed = input.name !== undefined && brandKey(input.name) !== current.nameKey;
    const aliases = [...(input.aliases ?? current.aliases), ...(renamed ? [current.name.toLowerCase()] : [])];
    const words = await this.checkWords(input.name ?? current.name, aliases, current.id);
    const categories = input.category_ids ? await this.checkCategories(input.category_ids) : null;
    const adopted = await this.prisma.$transaction(async tx => {
      const row = await tx.classifiedBrand.update({
        where: { id: current.id },
        data: {
          ...words,
          ...(input.color !== undefined ? { color: input.color?.toUpperCase() ?? null } : {}),
          ...(input.logo_url !== undefined ? { logoUrl: input.logo_url } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      });
      if (categories) await this.setCategories(tx, row.id, categories);
      return row.enabled ? this.adopt(tx, row, words.matchKeys, actorId) : { listings_renamed: 0, suggestions_answered: 0 };
    });
    this.forget();
    const after = await this.adminGet(slug);
    await this.audit.record({ actorId, action: 'classifieds.brand_changed', targetType: 'classified_brand', targetId: current.id, before, after: { ...after, ...adopted } });
    return { ...after, ...adopted };
  }

  /** Brands sellers typed that the registry lacks, one row per brand, most sellers first. */
  async suggestions() {
    const rows = await this.prisma.classifiedBrandSuggestion.findMany({ where: { status: 'open' }, include: { category: { select: { id: true, slug: true, name: true } } }, orderBy: { createdAt: 'asc' }, take: 2000 });
    const groups = new Map<string, { name_key: string; name: string; sellers: number; categories: Map<string, { id: string; slug: string; name: string }>; first_at: Date; last_at: Date }>();
    for (const row of rows) {
      const group = groups.get(row.nameKey) ?? { name_key: row.nameKey, name: row.name, sellers: 0, categories: new Map(), first_at: row.createdAt, last_at: row.createdAt };
      group.sellers += 1;
      group.name = row.name;
      group.last_at = row.createdAt;
      if (row.category) group.categories.set(row.category.id, row.category);
      groups.set(row.nameKey, group);
    }
    const data = [...groups.values()]
      .sort((a, b) => b.sellers - a.sellers || b.last_at.getTime() - a.last_at.getTime())
      .map(group => ({ object: 'classified_brand_suggestion_group' as const, name_key: group.name_key, name: group.name, sellers: group.sellers, categories: [...group.categories.values()].map(presentCategory), first_at: group.first_at.toISOString(), last_at: group.last_at.toISOString() }));
    return { object: 'list' as const, data };
  }

  async dismiss(actorId: string | null, nameKey: string) {
    const key = brandKey(nameKey);
    const dismissed = await this.prisma.classifiedBrandSuggestion.updateMany({ where: { nameKey: key, status: 'open' }, data: { status: 'dismissed', decidedById: actorId, decidedAt: new Date() } });
    if (!dismissed.count) throw notFound('suggestion');
    await this.audit.record({ actorId, action: 'classifieds.brand_suggestion_dismissed', targetType: 'classified_brand_suggestion', targetId: key, before: { sellers: dismissed.count }, after: { status: 'dismissed' } });
    return { object: 'classified_brand_suggestion_group' as const, name_key: key, dismissed: dismissed.count };
  }
}

/** The brands the listing form suggests and the filters show (`GET /v1/classifieds/brands`), cached a minute. */
@ApiExcludeController()
@Public()
@Controller('classifieds')
@ProductOnly('udozo')
export class ClassifiedBrandsController {
  constructor(private readonly brands: ClassifiedBrandsService) {}

  @Get('brands')
  @Header('Cache-Control', 'public, max-age=60')
  list(@Query() query: BrandsQueryDto) {
    return this.brands.list(query);
  }
}

/** Admin Marketplace > Brand registry: the brands, their categories and logos, and sellers' new brands. Support reads. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/classifieds')
@ProductOnly('udozo')
export class AdminBrandsController {
  constructor(private readonly brands: ClassifiedBrandsService) {}

  @Get('brands')
  list(@Query() query: AdminBrandsQueryDto) {
    return this.brands.adminList(query);
  }

  @Get('brands/:slug')
  get(@Param('slug') slug: string) {
    return this.brands.adminGet(slug);
  }

  @Post('brands')
  @AdminRoles('operations')
  create(@CurrentCaller() caller: Caller, @Body() body: CreateBrandDto) {
    return this.brands.create(adminId(caller), body);
  }

  @Patch('brands/:slug')
  @AdminRoles('operations')
  update(@CurrentCaller() caller: Caller, @Param('slug') slug: string, @Body() body: BrandFieldsDto) {
    return this.brands.update(adminId(caller), slug, body);
  }

  @Get('brand-suggestions')
  suggestions() {
    return this.brands.suggestions();
  }

  @Post('brand-suggestions/dismiss')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  dismiss(@CurrentCaller() caller: Caller, @Body() body: DismissBrandDto) {
    return this.brands.dismiss(adminId(caller), body.name_key);
  }
}
