import { Body, Controller, Get, Header, HttpCode, HttpStatus, Injectable, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { ProductOnly } from '../products/product.js';
import { brandKeySql, ClassifiedBrandsService } from './brands.service.js';
import { brandFeatureKey, brandKey, invalid, linkPattern, modelFeatureKey } from './rules.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);

/** A model this many different sellers typed joins the list by itself (admins can still turn it off). */
export const modelLearnFrom = 3;
/** A seller's new models are noted at most this many times a day (the rest are still saved, just not counted). */
export const modelSuggestionsPerDay = 20;
/** The most words a model's name runs to in a title ("Land Cruiser Prado", "iPhone 15 Pro Max"). */
const longestModel = 6;
/** A title's one plain word names a model on its own only among the brand's this many most bought. */
const namedAlone = 10;
/** How long each instance keeps a category's models (changes clear it at once on their instance). */
const cacheMs = 60_000;

class ModelsQueryDto {
  /** A subcategory or a top category (all its subcategories), by slug or id. */
  @IsString() @Length(1, 80)
  category: string;

  /** The brand, as a seller or the registry writes it. */
  @IsOptional() @IsString() @Length(1, 60)
  brand?: string;

  /** What was typed. Without a brand it finds models of every brand in the category, each with its brand. */
  @IsOptional() @IsString() @Length(1, 60)
  q?: string;

  /** Counts each model's live listings there. */
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  limit?: number;
}

class DetectQueryDto {
  @IsString() @Length(1, 120)
  title: string;

  @IsString() @Length(1, 80)
  category: string;
}

class AdminModelsQueryDto {
  @IsOptional() @IsString() @Length(1, 60)
  q?: string;

  @IsOptional() @IsString() @Length(1, 80)
  category?: string;

  @IsOptional() @IsIn(['registry', 'admin', 'sellers'])
  source?: 'registry' | 'admin' | 'sellers';

  @IsOptional() @IsIn(['enabled', 'disabled'])
  status?: 'enabled' | 'disabled';

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000)
  offset?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

class ModelWordsDto {
  @IsString() @Length(1, 60)
  name: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Length(1, 40, { each: true })
  aliases?: string[];
}

class CreateModelDto extends ModelWordsDto {
  @IsUUID()
  category_id: string;
}

class ImportModelsDto {
  @IsUUID()
  category_id: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ModelWordsDto)
  models: ModelWordsDto[];
}

class ChangeModelDto {
  @IsOptional() @IsString() @Length(1, 60)
  name?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Length(1, 40, { each: true })
  aliases?: string[];

  @IsOptional() @IsBoolean()
  enabled?: boolean;
}

class DismissModelDto {
  @IsUUID()
  brand_id: string;

  @IsUUID()
  category_id: string;

  @IsString() @Length(1, 60)
  name_key: string;
}

type Entry = { id: string; brandId: string; categoryId: string; name: string; nameKey: string; matchKeys: string[]; position: number };
type Shelf = { at: number; rows: Entry[]; byKey: Map<string, Entry[]> };
type Words = { name: string; nameKey: string; aliases: string[]; matchKeys: string[] };

/**
 * The models of the brand registry's brands, each in its category: what sellers pick for the `model` feature once they
 * have chosen a brand, keeping listings' values in the registry's words, reading a brand and model out of a title, and
 * the models sellers typed that it lacks, which join by themselves once enough different sellers typed one.
 */
@Injectable()
export class ClassifiedModelsService {
  private shelves = new Map<string, Shelf>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly brands: ClassifiedBrandsService,
  ) {}

  /** A category's enabled models, and each by its keys; kept a minute. */
  private async shelf(categoryId: string) {
    const kept = this.shelves.get(categoryId);
    if (kept && Date.now() - kept.at < cacheMs) return kept;
    const rows = await this.prisma.classifiedBrandModel.findMany({
      where: { categoryId, enabled: true },
      select: { id: true, brandId: true, categoryId: true, name: true, nameKey: true, matchKeys: true, position: true },
      orderBy: { position: 'asc' },
    });
    const byKey = new Map<string, Entry[]>();
    for (const row of rows) for (const key of row.matchKeys) byKey.set(key, [...(byKey.get(key) ?? []), row]);
    const shelf = { at: Date.now(), rows, byKey };
    this.shelves.set(categoryId, shelf);
    return shelf;
  }

  private forget(categoryId: string) {
    this.shelves.delete(categoryId);
  }

  /** The keys a seller's words could be: as typed, then without the brand in front ("Samsung Galaxy A14"). */
  private keysOf(value: string, brandKeys: string[]) {
    const key = brandKey(value);
    const bare = brandKeys.filter(brand => key.startsWith(brand) && key.length > brand.length).map(brand => key.slice(brand.length));
    return [...new Set([key, ...bare])].filter(Boolean);
  }

  /** The registry's model a seller's value names, for that brand and category, if any. */
  async match(brandValue: string, categoryId: string, value: string) {
    const brand = await this.brands.match(brandValue);
    if (!brand) return null;
    const { byKey } = await this.shelf(categoryId);
    for (const key of this.keysOf(value, brand.matchKeys)) {
      const found = byKey.get(key)?.find(row => row.brandId === brand.id);
      if (found) return found;
    }
    return null;
  }

  /** A seller's value in the registry's words, or as typed when the registry lacks it. */
  async canonical(brandValue: string, categoryId: string, value: string) {
    return (await this.match(brandValue, categoryId, value))?.name ?? value;
  }

  /**
   * Notes a model the registry lacks, once per seller (it is saved on the listing all the same), for brands the registry
   * has. Once enough different sellers typed it, it joins the list. One admins dismissed or turned off stays out. Never throws.
   */
  async note(customerId: string, brandValue: string, categoryId: string, value: string) {
    try {
      const brand = await this.brands.match(brandValue);
      const name = value.replace(/\s+/g, ' ').trim().slice(0, 60);
      const nameKey = brandKey(name);
      if (!brand || nameKey.length < 2 || (await this.match(brandValue, categoryId, name))) return;
      const place = { brandId: brand.id, categoryId, nameKey };
      if (await this.prisma.classifiedBrandModel.findFirst({ where: { brandId: brand.id, categoryId, matchKeys: { has: nameKey } }, select: { id: true } })) return;
      if (await this.prisma.classifiedModelSuggestion.findFirst({ where: { ...place, status: 'dismissed' }, select: { id: true } })) return;
      if (await this.prisma.classifiedModelSuggestion.findFirst({ where: { ...place, customerId, status: 'open' }, select: { id: true } })) return;
      const today = await this.prisma.classifiedModelSuggestion.count({ where: { customerId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
      if (today >= modelSuggestionsPerDay) return;
      await this.prisma.classifiedModelSuggestion.create({ data: { ...place, customerId, name } });
      await this.learn(brand, categoryId, nameKey);
    } catch {
      // A parallel save noted it first, or the category went: nothing to do.
    }
  }

  /** Whether words may appear in the list unchecked by a person: no links, and none of the refused words. */
  private async publishable(name: string) {
    if (linkPattern.test(name)) return false;
    const text = ` ${name.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ' ')} `;
    const words = await this.prisma.classifiedProhibitedWord.findMany({ where: { platform: 'bitocard' }, select: { phrase: true } });
    return !words.some(word => text.includes(` ${word.phrase.replace(/[^\p{L}\p{N}-]+/gu, ' ')} `));
  }

  /** Enough different sellers typed this model: it joins the list, as most of them wrote it, and their ads read as it. */
  private async learn(brand: { id: string; name: string }, categoryId: string, nameKey: string) {
    const rows = await this.prisma.classifiedModelSuggestion.findMany({ where: { brandId: brand.id, categoryId, nameKey, status: 'open' }, select: { name: true } });
    if (rows.length < modelLearnFrom) return;
    const spellings = new Map<string, number>();
    for (const row of rows) spellings.set(row.name, (spellings.get(row.name) ?? 0) + 1);
    const name = [...spellings.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    if (!(await this.publishable(name))) return;
    const model = await this.prisma.$transaction(async tx => {
      const row = await this.insert(tx, brand.id, categoryId, { name, nameKey, aliases: [], matchKeys: [nameKey] }, 'sellers');
      await this.adopt(tx, brand, row, null);
      return row;
    });
    this.forget(categoryId);
    await this.audit.record({ actorId: null, action: 'classifieds.model_learned', targetType: 'classified_brand_model', targetId: model.id, before: null, after: { brand: brand.name, name, sellers: rows.length } });
  }

  private async insert(tx: Prisma.TransactionClient, brandId: string, categoryId: string, words: Words, source: 'admin' | 'sellers') {
    const last = await tx.classifiedBrandModel.aggregate({ where: { brandId, categoryId }, _max: { position: true } });
    return tx.classifiedBrandModel.create({ data: { brandId, categoryId, ...words, source, position: (last._max.position ?? -1) + 1 } });
  }

  /** Ads of this brand in the model's category that name it read as the model, and sellers' open suggestions are answered. */
  private async adopt(tx: Prisma.TransactionClient, brand: { id: string; name: string }, model: { id: string; categoryId: string; name: string; matchKeys: string[] }, actorId: string | null) {
    const renamed = await tx.$executeRaw`
      UPDATE "classified_listing_features" lf SET "value_text" = ${model.name}
      FROM "classified_listings" l
      WHERE l."id" = lf."listing_id" AND l."category_id" = ${model.categoryId}::uuid
        AND lf."feature_id" = (SELECT "id" FROM "classified_features" WHERE "key" = ${modelFeatureKey})
        AND ${brandKeySql(Prisma.sql`lf."value_text"`)} = ANY(${model.matchKeys}::text[])
        AND lf."value_text" <> ${model.name}
        AND EXISTS (
          SELECT 1 FROM "classified_listing_features" b
          WHERE b."listing_id" = l."id" AND b."value_text" = ${brand.name}
            AND b."feature_id" = (SELECT "id" FROM "classified_features" WHERE "key" = ${brandFeatureKey})
        )`;
    const answered = await tx.classifiedModelSuggestion.updateMany({ where: { status: 'open', brandId: brand.id, categoryId: model.categoryId, nameKey: { in: model.matchKeys } }, data: { status: 'added', modelId: model.id, decidedById: actorId, decidedAt: new Date() } });
    return { listings_renamed: renamed, suggestions_answered: answered.count };
  }

  /** Live listings per brand and model in a country, as `<brand id>|<model key>`. */
  private async counts(country: string, categoryIds: string[]) {
    const rows = await this.prisma.$queryRaw<{ brand: string; model: string; n: number }[]>`
      SELECT b."value_text" AS "brand", m."value_text" AS "model", count(*)::int AS "n"
      FROM "classified_listing_features" m
      JOIN "classified_features" fm ON fm."id" = m."feature_id" AND fm."key" = ${modelFeatureKey}
      JOIN "classified_listings" l ON l."id" = m."listing_id"
      JOIN "classified_listing_features" b ON b."listing_id" = l."id"
      JOIN "classified_features" fb ON fb."id" = b."feature_id" AND fb."key" = ${brandFeatureKey}
      WHERE l."country" = ${country} AND l."status" = 'active' AND l."on_shop" = true AND l."category_id" = ANY(${categoryIds}::uuid[])
        AND m."value_text" IS NOT NULL AND b."value_text" IS NOT NULL
      GROUP BY 1, 2`;
    const counts = new Map<string, number>();
    for (const row of rows) {
      const brand = await this.brands.match(row.brand);
      if (!brand) continue;
      const key = `${brand.id}|${brandKey(row.model)}`;
      counts.set(key, (counts.get(key) ?? 0) + row.n);
    }
    return counts;
  }

  /**
   * Models for the listing form and the filters: a brand's in a category (most listed in the country first, then the
   * registry's order), narrowed by what was typed; or, with no brand, every brand's matching models, each with its brand.
   */
  async list(input: ModelsQueryDto) {
    const typed = input.q?.trim() ?? '';
    if (!input.brand && !typed) throw invalid('parameter_missing', 'Give a brand or some words.', 'brand');
    const ids = await this.brands.categoryIds(input.category);
    const brand = input.brand ? await this.brands.match(input.brand) : null;
    if (input.brand && !brand) return { object: 'list' as const, data: [] };
    const shelves = await Promise.all(ids.map(id => this.shelf(id)));
    // The same model in two subcategories of a top category shows once.
    const unique = new Map<string, Entry>();
    for (const shelf of shelves) for (const row of shelf.rows) if ((!brand || row.brandId === brand.id) && !unique.has(`${row.brandId}|${row.nameKey}`)) unique.set(`${row.brandId}|${row.nameKey}`, row);
    const counts = input.country ? await this.counts(input.country, ids) : null;
    const count = (row: Entry) => counts?.get(`${row.brandId}|${row.nameKey}`) ?? 0;
    const words = brand ? this.keysOf(typed, brand.matchKeys) : [brandKey(typed)].filter(Boolean);
    const score = (row: Entry) => {
      let best = 0;
      for (const key of words) best = Math.max(best, row.nameKey === key ? 5 : row.matchKeys.includes(key) ? 4 : row.nameKey.startsWith(key) ? 3 : row.matchKeys.some(item => item.startsWith(key)) ? 2 : key.length >= 2 && row.matchKeys.some(item => item.includes(key)) ? 1 : 0);
      return best;
    };
    const rows = typed && words.length ? [...unique.values()].map(row => ({ row, score: score(row) })).filter(item => item.score > 0) : [...unique.values()].map(row => ({ row, score: 0 }));
    const picked = rows
      .sort((a, b) => b.score - a.score || count(b.row) - count(a.row) || a.row.position - b.row.position || a.row.name.localeCompare(b.row.name))
      .slice(0, input.limit ?? (typed ? 30 : 200))
      .map(item => item.row);
    const data = [];
    for (const row of picked) {
      const owner = brand ? null : await this.brands.card(row.brandId);
      if (!brand && !owner) continue;
      data.push({ object: 'classified_model' as const, name: row.name, ...(owner ? { brand: owner } : {}), ...(counts ? { listings: count(row) } : {}) });
    }
    return { object: 'list' as const, data };
  }

  /**
   * The brand and model a listing's title names, for the form to offer: the longest words that are a model of the brand
   * the title names, else a model only one brand in the category has. A title that could be several brands' model names
   * no model; nothing here is ever saved without the seller choosing it.
   */
  async detect(input: DetectQueryDto) {
    const ids = await this.brands.categoryIds(input.category);
    const sold = new Set(await this.brands.inCategories(ids));
    const shelves = await Promise.all(ids.map(id => this.shelf(id)));
    const hits = (key: string) => shelves.flatMap(shelf => shelf.byKey.get(key) ?? []);
    const tokens = input.title.split(/[^\p{L}\p{N}]+/u).map(brandKey).filter(Boolean).slice(0, 16);
    const grams: { key: string; words: number }[] = [];
    for (let start = 0; start < tokens.length; start += 1) for (let size = 1; size <= longestModel && start + size <= tokens.length; size += 1) grams.push({ key: tokens.slice(start, start + size).join(''), words: size });
    grams.sort((a, b) => b.key.length - a.key.length);

    let brand: { id: string } | null = null;
    for (const { key } of grams) {
      const found = await this.brands.match(key);
      if (found && sold.has(found.id)) {
        brand = found;
        break;
      }
    }
    const answer = async (brandId: string | null, model: string | null) => ({ object: 'classified_model_match' as const, brand: brandId ? await this.brands.card(brandId) : null, model });
    if (brand) {
      for (const { key } of grams) {
        const row = hits(key).find(item => item.brandId === brand.id);
        if (row) return answer(brand.id, row.name);
      }
      return answer(brand.id, null);
    }
    for (const { key, words } of grams) {
      // Without a brand in the title, short or digit-only words name too much ("406", "S7"), and one plain word counts
      // only as one of a brand's most bought ("Highlander", never SsangYong's "Family" in "a clean family saloon").
      if (key.length < 4 || !/[a-z]/.test(key)) continue;
      const rows = hits(key).filter(row => words > 1 || row.position < namedAlone);
      if (rows.length && new Set(rows.map(row => row.brandId)).size === 1) return answer(rows[0]!.brandId, rows[0]!.name);
      if (rows.length) break;
    }
    return answer(null, null);
  }

  // ---- Admins ----

  private async owned(slug: string) {
    const brand = await this.prisma.classifiedBrand.findUnique({ where: { slug }, include: { categories: { select: { categoryId: true } } } });
    if (!brand) throw notFound('brand');
    return brand;
  }

  /** The name and aliases checked and keyed; no other model of the brand in the category may own any of the keys. */
  private async checkWords(brandId: string, categoryId: string, name: string, aliases: string[], currentId: string | null): Promise<Words> {
    const clean = name.replace(/\s+/g, ' ').trim();
    const nameKey = brandKey(clean);
    if (!nameKey) throw invalid('parameter_invalid', 'Name the model with letters or digits.', 'name');
    for (const text of [clean, ...aliases]) if (linkPattern.test(text)) throw invalid('parameter_invalid', 'Links, web addresses and HTML are not allowed.', text === clean ? 'name' : 'aliases');
    const words = [...new Map(aliases.map(alias => alias.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean).map(alias => [brandKey(alias), alias] as const)).entries()].filter(([aliasKey]) => aliasKey && aliasKey !== nameKey);
    const matchKeys = [nameKey, ...words.map(([aliasKey]) => aliasKey)];
    const taken = await this.prisma.classifiedBrandModel.findMany({ where: { brandId, categoryId, id: currentId ? { not: currentId } : undefined, matchKeys: { hasSome: matchKeys } }, select: { name: true, nameKey: true, matchKeys: true } });
    for (const other of taken) {
      if (other.matchKeys.includes(nameKey)) throw conflict('model_exists', `${other.name} is already in the list${other.nameKey === nameKey ? '' : ' under this name'}.`, 'name');
      const clash = words.find(([aliasKey]) => other.matchKeys.includes(aliasKey));
      if (clash) throw conflict('model_alias_taken', `“${clash[1]}” already finds ${other.name}.`, 'aliases');
    }
    return { name: clean, nameKey, aliases: words.map(([, alias]) => alias), matchKeys };
  }

  private inBrand(brand: { categories: { categoryId: string }[] }, categoryId: string) {
    if (!brand.categories.some(link => link.categoryId === categoryId)) throw invalid('parameter_invalid', 'Choose a category this brand sells in.', 'category_id');
  }

  /** Live ads per model of a brand everywhere (admins' "Used by"), as `<category>|<model key>`. */
  private async adminCounts(brandName: string) {
    const rows = await this.prisma.$queryRaw<{ category: string; model: string; n: number }[]>`
      SELECT l."category_id" AS "category", m."value_text" AS "model", count(*)::int AS "n"
      FROM "classified_listing_features" m
      JOIN "classified_features" fm ON fm."id" = m."feature_id" AND fm."key" = ${modelFeatureKey}
      JOIN "classified_listings" l ON l."id" = m."listing_id"
      JOIN "classified_listing_features" b ON b."listing_id" = l."id" AND b."value_text" = ${brandName}
      JOIN "classified_features" fb ON fb."id" = b."feature_id" AND fb."key" = ${brandFeatureKey}
      WHERE l."status" = 'active' AND m."value_text" IS NOT NULL
      GROUP BY 1, 2`;
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(`${row.category}|${brandKey(row.model)}`, (counts.get(`${row.category}|${brandKey(row.model)}`) ?? 0) + row.n);
    return counts;
  }

  private presentAdmin(row: { id: string; name: string; nameKey: string; aliases: string[]; position: number; source: string; enabled: boolean; updatedAt: Date; categoryId: string; category: { id: string; slug: string; name: string } }, listings: number) {
    return { object: 'classified_brand_model' as const, id: row.id, name: row.name, aliases: row.aliases, category: row.category, position: row.position, source: row.source, enabled: row.enabled, listings, updated_at: row.updatedAt.toISOString() };
  }

  /** A brand's models a page at a time, in the list's order, with how many it has in each of its categories. */
  async adminList(slug: string, input: AdminModelsQueryDto) {
    const brand = await this.owned(slug);
    const words = input.q?.trim();
    const key = brandKey(words ?? '');
    const ids = input.category ? await this.brands.categoryIds(input.category) : null;
    const where: Prisma.ClassifiedBrandModelWhereInput = {
      brandId: brand.id,
      ...(ids ? { categoryId: { in: ids } } : {}),
      ...(words ? { OR: [{ name: { contains: words, mode: 'insensitive' } }, ...(key ? [{ nameKey: { contains: key } }, { matchKeys: { has: key } }] : [])] } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.status ? { enabled: input.status === 'enabled' } : {}),
    };
    const limit = input.limit ?? 50;
    const [rows, total, counts, perCategory, categories] = await Promise.all([
      this.prisma.classifiedBrandModel.findMany({ where, include: { category: { select: { id: true, slug: true, name: true } } }, orderBy: [{ categoryId: 'asc' }, { position: 'asc' }, { name: 'asc' }], skip: input.offset ?? 0, take: limit }),
      this.prisma.classifiedBrandModel.count({ where }),
      this.adminCounts(brand.name),
      this.prisma.classifiedBrandModel.groupBy({ by: ['categoryId'], where: { brandId: brand.id }, _count: { _all: true } }),
      this.prisma.classifiedCategory.findMany({ where: { id: { in: brand.categories.map(link => link.categoryId) } }, select: { id: true, slug: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const models = new Map(perCategory.map(row => [row.categoryId, row._count._all]));
    return {
      object: 'list' as const,
      data: rows.map(row => this.presentAdmin(row, counts.get(`${row.categoryId}|${row.nameKey}`) ?? 0)),
      total,
      offset: input.offset ?? 0,
      limit,
      brand: { slug: brand.slug, name: brand.name },
      categories: categories.map(category => ({ ...category, models: models.get(category.id) ?? 0 })),
    };
  }

  private async one(id: string) {
    const row = await this.prisma.classifiedBrandModel.findUnique({ where: { id }, include: { category: { select: { id: true, slug: true, name: true } }, brand: { select: { id: true, name: true } } } });
    if (!row) throw notFound('model');
    return row;
  }

  async create(actorId: string | null, slug: string, input: CreateModelDto) {
    const brand = await this.owned(slug);
    this.inBrand(brand, input.category_id);
    const words = await this.checkWords(brand.id, input.category_id, input.name, input.aliases ?? [], null);
    const result = await this.prisma.$transaction(async tx => {
      const row = await this.insert(tx, brand.id, input.category_id, words, 'admin');
      return { row, adopted: await this.adopt(tx, brand, row, actorId) };
    });
    this.forget(input.category_id);
    const saved = this.presentAdmin(await this.one(result.row.id), 0);
    await this.audit.record({ actorId, action: 'classifieds.model_created', targetType: 'classified_brand_model', targetId: result.row.id, before: null, after: { ...saved, ...result.adopted } });
    return { ...saved, ...result.adopted };
  }

  /** Many at once, as they came: those the list already has are skipped and counted, never refused. */
  async importMany(actorId: string | null, slug: string, input: ImportModelsDto) {
    const brand = await this.owned(slug);
    this.inBrand(brand, input.category_id);
    const added: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    let renamed = 0;
    for (const model of input.models) {
      try {
        const words = await this.checkWords(brand.id, input.category_id, model.name, model.aliases ?? [], null);
        renamed += await this.prisma.$transaction(async tx => {
          const row = await this.insert(tx, brand.id, input.category_id, words, 'admin');
          return (await this.adopt(tx, brand, row, actorId)).listings_renamed;
        });
        added.push(words.name);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        skipped.push({ name: model.name, reason: error.message });
      }
    }
    this.forget(input.category_id);
    await this.audit.record({ actorId, action: 'classifieds.models_imported', targetType: 'classified_brand', targetId: brand.id, before: null, after: { category_id: input.category_id, added: added.length, skipped: skipped.length, listings_renamed: renamed } });
    return { object: 'classified_model_import' as const, added: added.length, skipped, listings_renamed: renamed };
  }

  /** Changes a model. A new name keeps the old one as a search word, and ads follow it. */
  async update(actorId: string | null, id: string, input: ChangeModelDto) {
    const current = await this.one(id);
    const before = this.presentAdmin(current, 0);
    const renamed = input.name !== undefined && brandKey(input.name) !== current.nameKey;
    const aliases = [...(input.aliases ?? current.aliases), ...(renamed ? [current.name.toLowerCase()] : [])];
    const words = await this.checkWords(current.brandId, current.categoryId, input.name ?? current.name, aliases, current.id);
    const adopted = await this.prisma.$transaction(async tx => {
      const row = await tx.classifiedBrandModel.update({ where: { id }, data: { ...words, ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) } });
      return row.enabled ? this.adopt(tx, current.brand, row, actorId) : { listings_renamed: 0, suggestions_answered: 0 };
    });
    this.forget(current.categoryId);
    const after = this.presentAdmin(await this.one(id), 0);
    await this.audit.record({ actorId, action: 'classifieds.model_changed', targetType: 'classified_brand_model', targetId: id, before, after: { ...after, ...adopted } });
    return { ...after, ...adopted };
  }

  /** Models sellers typed that the list lacks, one row per model, most sellers first. */
  async suggestions() {
    const rows = await this.prisma.classifiedModelSuggestion.findMany({
      where: { status: 'open' },
      include: { category: { select: { id: true, slug: true, name: true } }, brand: { select: { id: true, slug: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    const groups = new Map<string, { brand: { id: string; slug: string; name: string }; category: { id: string; slug: string; name: string }; name_key: string; name: string; sellers: number; last_at: Date }>();
    for (const row of rows) {
      const key = `${row.brandId}|${row.categoryId}|${row.nameKey}`;
      const group = groups.get(key) ?? { brand: row.brand, category: row.category, name_key: row.nameKey, name: row.name, sellers: 0, last_at: row.createdAt };
      group.sellers += 1;
      group.name = row.name;
      group.last_at = row.createdAt;
      groups.set(key, group);
    }
    const data = [...groups.values()]
      .sort((a, b) => b.sellers - a.sellers || b.last_at.getTime() - a.last_at.getTime())
      .map(group => ({ object: 'classified_model_suggestion_group' as const, ...group, last_at: group.last_at.toISOString() }));
    return { object: 'list' as const, data, learn_from: modelLearnFrom };
  }

  /** Sellers' typing of this model is set aside, and stays out of the list however many type it. */
  async dismiss(actorId: string | null, input: DismissModelDto) {
    const key = brandKey(input.name_key);
    const dismissed = await this.prisma.classifiedModelSuggestion.updateMany({ where: { brandId: input.brand_id, categoryId: input.category_id, nameKey: key, status: 'open' }, data: { status: 'dismissed', decidedById: actorId, decidedAt: new Date() } });
    if (!dismissed.count) throw notFound('suggestion');
    await this.audit.record({ actorId, action: 'classifieds.model_suggestion_dismissed', targetType: 'classified_model_suggestion', targetId: key, before: { sellers: dismissed.count }, after: { status: 'dismissed' } });
    return { object: 'classified_model_suggestion_group' as const, name_key: key, dismissed: dismissed.count };
  }
}

/** The models the listing form suggests and the filters show (`GET /v1/classifieds/models`), cached a minute. */
@ApiExcludeController()
@Public()
@Controller('classifieds/models')
@ProductOnly('udozo')
export class ClassifiedModelsController {
  constructor(private readonly models: ClassifiedModelsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  list(@Query() query: ModelsQueryDto) {
    return this.models.list(query);
  }

  @Get('detect')
  @Header('Cache-Control', 'public, max-age=60')
  detect(@Query() query: DetectQueryDto) {
    return this.models.detect(query);
  }
}

/** Admin Marketplace > Brand registry > a brand's models, and the models sellers typed. Support reads. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/classifieds')
@ProductOnly('udozo')
export class AdminModelsController {
  constructor(private readonly models: ClassifiedModelsService) {}

  @Get('brands/:slug/models')
  list(@Param('slug') slug: string, @Query() query: AdminModelsQueryDto) {
    return this.models.adminList(slug, query);
  }

  @Post('brands/:slug/models')
  @AdminRoles('operations')
  create(@CurrentCaller() caller: Caller, @Param('slug') slug: string, @Body() body: CreateModelDto) {
    return this.models.create(adminId(caller), slug, body);
  }

  @Post('brands/:slug/models/import')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  importMany(@CurrentCaller() caller: Caller, @Param('slug') slug: string, @Body() body: ImportModelsDto) {
    return this.models.importMany(adminId(caller), slug, body);
  }

  @Patch('models/:id')
  @AdminRoles('operations')
  update(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body() body: ChangeModelDto) {
    return this.models.update(adminId(caller), id, body);
  }

  @Get('model-suggestions')
  suggestions() {
    return this.models.suggestions();
  }

  @Post('model-suggestions/dismiss')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  dismiss(@CurrentCaller() caller: Caller, @Body() body: DismissModelDto) {
    return this.models.dismiss(adminId(caller), body);
  }
}
