import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ClassifiedFeature, Prisma } from '../generated/prisma/client.js';
import { ListingsService } from './listings.service.js';
import { presentFeature } from './reference.service.js';
import { checkFeatureValue, invalid, linkPattern, onShopWhere, slugify } from './rules.js';
import { ProductOnly } from '../products/product.js';

const dataTypes = ['text', 'number', 'choice', 'boolean'] as const;
type DataType = (typeof dataTypes)[number];
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);

/** A seller may ask for this many keys a day. */
export const suggestionsPerDay = 10;
/** "Refresh  RATE" and "refresh rate" are one suggestion. */
export const suggestionKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

class FeatureFieldsDto {
  @IsOptional() @IsString() @Length(2, 40)
  name?: string;

  /** A lucide icon name (`memory-stick`); the admin app offers only icons it can draw. */
  @IsOptional() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @Length(1, 40)
  icon?: string;

  /** Numbers only. */
  @IsOptional() @IsString() @Length(1, 12)
  unit?: string | null;

  /** Choices only: the values offered, in order. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Length(1, 40, { each: true })
  choices?: string[];

  @IsOptional() @IsString() @Length(1, 80)
  default_value?: string | null;

  @IsOptional() @IsString() @Length(1, 40)
  placeholder?: string | null;

  @IsOptional() @IsNumber()
  min?: number | null;

  @IsOptional() @IsNumber()
  max?: number | null;

  /** Search words that find it (RAM finds Memory). */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Length(1, 40, { each: true })
  synonyms?: string[];

  @IsOptional() @IsBoolean()
  filterable?: boolean;

  @IsOptional() @IsBoolean()
  enabled?: boolean;
}

class CreateFeatureDto extends FeatureFieldsDto {
  @Matches(/^[a-z][a-z0-9_]{1,39}$/)
  key: string;

  @IsString() @Length(2, 40)
  override name: string = '';

  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @Length(1, 40)
  override icon: string = '';

  @IsIn(dataTypes)
  data_type: DataType;

  /** The sellers' suggestion it answers (`name_key`): those sellers' suggestions are marked added. */
  @IsOptional() @IsString() @Length(2, 40)
  suggestion?: string;
}

class FeaturesQueryDto {
  @IsOptional() @IsString() @Length(1, 60)
  q?: string;
}

class DismissDto {
  @IsString() @Length(2, 40)
  name_key: string;
}

class SuggestDto {
  @IsString() @Length(2, 40)
  name: string;

  @IsOptional() @IsUUID()
  category_id?: string;
}

class AreasQueryDto {
  @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country: string;
}

class CreateAreaDto {
  @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country: string;

  /** The state it is in; none adds a state. */
  @IsOptional() @IsUUID()
  state_id?: string;

  @IsString() @Length(2, 60)
  name: string;

  @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  latitude: number;

  @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  longitude: number;
}

class UpdateAreaDto {
  /** The name shown; its address (slug) stays the same, so links keep working. */
  @IsOptional() @IsString() @Length(2, 60)
  name?: string;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  latitude?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  longitude?: number;

  @IsOptional() @IsBoolean()
  enabled?: boolean;
}

/**
 * BitoCard Shop's reference data as admins run it: the feature registry (new keys and changes; a key and its data type
 * never change once made, so stored values stay valid), the keys sellers ask for, and each market's states and areas
 * (names and centre points corrected, areas added or switched off). Every change is audited.
 */
@Injectable()
export class ClassifiedRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly listings: ListingsService,
  ) {}

  // ---- The feature registry ----

  /** Every key, switched off ones too, with the categories that suggest it and how many listings use it. */
  async features(q?: string) {
    const words = q?.trim().toLowerCase();
    const rows = await this.prisma.classifiedFeature.findMany({
      where: words ? { OR: [{ name: { contains: words, mode: 'insensitive' } }, { key: { contains: words.replace(/\s+/g, '_') } }, { synonyms: { has: words } }] } : {},
      include: { categories: { include: { category: { select: { name: true } } } } },
      orderBy: { name: 'asc' },
    });
    const used = await this.prisma.classifiedListingFeature.groupBy({ by: ['featureId'], where: { featureId: { in: rows.map(row => row.id) } }, _count: { _all: true } });
    const counts = new Map(used.map(row => [row.featureId, row._count._all]));
    return { object: 'list' as const, data: rows.map(row => this.presentAdmin(row, row.categories.map(link => link.category.name), counts.get(row.id) ?? 0)) };
  }

  private presentAdmin(row: ClassifiedFeature, categories: string[], listings: number) {
    return { ...presentFeature(row), id: row.id, enabled: row.enabled, categories, listings, updated_at: row.updatedAt.toISOString() };
  }

  async createFeature(actorId: string | null, input: CreateFeatureDto) {
    const data = this.checkFields(input.data_type, input, null);
    let row: ClassifiedFeature;
    try {
      row = await this.prisma.classifiedFeature.create({ data: { key: input.key, name: input.name.trim(), icon: input.icon, dataType: input.data_type, ...data } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('feature_exists', 'A feature with this key already exists.', 'key');
      throw error;
    }
    let answered = 0;
    if (input.suggestion) {
      const marked = await this.prisma.classifiedFeatureSuggestion.updateMany({ where: { nameKey: suggestionKey(input.suggestion), status: 'open' }, data: { status: 'added', featureId: row.id, decidedById: actorId, decidedAt: new Date() } });
      answered = marked.count;
    }
    await this.audit.record({ actorId, action: 'classifieds.feature_created', targetType: 'classified_feature', targetId: row.id, before: null, after: { ...presentFeature(row), enabled: row.enabled, suggestions_answered: answered } });
    return this.presentAdmin(row, [], 0);
  }

  async updateFeature(actorId: string | null, key: string, input: FeatureFieldsDto) {
    const current = await this.prisma.classifiedFeature.findUnique({ where: { key } });
    if (!current) throw notFound('feature');
    const data = this.checkFields(current.dataType as DataType, input, current);
    if (current.dataType === 'choice' && input.choices) {
      // A choice a listing still uses cannot be taken away (its value would stop being valid).
      const kept = new Set(input.choices.map(choice => choice.toLowerCase()));
      const removed = current.choices.filter(choice => !kept.has(choice.toLowerCase()));
      if (removed.length && (await this.prisma.classifiedListingFeature.count({ where: { featureId: current.id, valueText: { in: removed } } }))) {
        throw invalid('parameter_invalid', `Listings still use ${removed.join(', ')}: keep ${removed.length > 1 ? 'them' : 'it'}.`, 'choices');
      }
    }
    const row = await this.prisma.classifiedFeature.update({
      where: { key },
      data: { ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.icon !== undefined ? { icon: input.icon } : {}), ...data, ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) },
      include: { categories: { include: { category: { select: { name: true } } } } },
    });
    await this.audit.record({ actorId, action: 'classifieds.feature_changed', targetType: 'classified_feature', targetId: row.id, before: { ...presentFeature(current), enabled: current.enabled }, after: { ...presentFeature(row), enabled: row.enabled } });
    return this.presentAdmin(row, row.categories.map(link => link.category.name), await this.prisma.classifiedListingFeature.count({ where: { featureId: row.id } }));
  }

  /** The type-specific fields, checked against the data type: units and limits for numbers, choices for choices. */
  private checkFields(dataType: DataType, input: FeatureFieldsDto, current: ClassifiedFeature | null) {
    const number = dataType === 'number';
    if (!number && ((input.unit ?? null) !== null || (input.min ?? null) !== null || (input.max ?? null) !== null)) throw invalid('parameter_invalid', 'Only numbers have a unit and limits.', 'unit');
    if (dataType !== 'choice' && input.choices?.length) throw invalid('parameter_invalid', 'Only choices have choices.', 'choices');
    const choices = input.choices ? [...new Map(input.choices.map(choice => [choice.trim().toLowerCase(), choice.trim()])).values()].filter(Boolean) : undefined;
    if (dataType === 'choice' && (choices ?? current?.choices ?? []).length === 0) throw invalid('parameter_missing', 'Add the choices sellers pick from.', 'choices');
    const min = input.min !== undefined ? input.min : (current?.min ?? null);
    const max = input.max !== undefined ? input.max : (current?.max ?? null);
    if (min !== null && max !== null && min > max) throw invalid('parameter_invalid', 'The smallest value cannot be above the largest.', 'max');
    for (const text of [input.name, input.placeholder, ...(input.synonyms ?? []), ...(choices ?? [])]) {
      if (text && linkPattern.test(text)) throw invalid('parameter_invalid', 'Links, web addresses and HTML are not allowed.', 'name');
    }
    let defaultValue = input.default_value;
    if (defaultValue !== undefined && defaultValue !== null) {
      // The default must be a value a seller could enter.
      const probe = { id: '', key: '', name: 'Default', dataType, unit: input.unit ?? current?.unit ?? null, choices: choices ?? current?.choices ?? [], min, max, enabled: true };
      const value = checkFeatureValue(probe, defaultValue, 'default_value');
      defaultValue = value.valueText ?? String(value.valueNumber);
    }
    return {
      ...(input.unit !== undefined ? { unit: input.unit?.trim() || null } : {}),
      ...(choices !== undefined ? { choices } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(input.placeholder !== undefined ? { placeholder: input.placeholder?.trim() || null } : {}),
      ...(input.min !== undefined ? { min: input.min } : {}),
      ...(input.max !== undefined ? { max: input.max } : {}),
      ...(input.synonyms !== undefined ? { synonyms: [...new Set(input.synonyms.map(word => word.trim().toLowerCase()).filter(Boolean))] } : {}),
      ...(input.filterable !== undefined ? { filterable: input.filterable } : {}),
    };
  }

  // ---- Keys sellers ask for ----

  /** A seller asks for a key the registry lacks; asking again for the same name is the same suggestion. */
  async suggest(caller: CustomerCaller, input: SuggestDto) {
    await this.listings.sellerCountry(caller.customer);
    const name = input.name.replace(/\s+/g, ' ').trim();
    const nameKey = suggestionKey(name);
    if (nameKey.length < 2 || linkPattern.test(name)) throw invalid('parameter_invalid', 'Name the feature in 2 to 40 characters, without links.', 'name');
    const existing = await this.prisma.classifiedFeature.findFirst({ where: { enabled: true, OR: [{ name: { equals: name, mode: 'insensitive' } }, { synonyms: { has: nameKey } }, { key: nameKey.replace(/[^a-z0-9]+/g, '_') }] } });
    if (existing) throw conflict('feature_exists', `${existing.name} is already a feature: search for it.`, 'name');
    if (input.category_id && !(await this.prisma.classifiedCategory.findUnique({ where: { id: input.category_id } }))) throw invalid('parameter_invalid', 'No such category.', 'category_id');
    const open = await this.prisma.classifiedFeatureSuggestion.findFirst({ where: { customerId: caller.customer.id, nameKey, status: 'open' } });
    if (open) return this.presentSuggestion(open);
    const today = await this.prisma.classifiedFeatureSuggestion.count({ where: { customerId: caller.customer.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    if (today >= suggestionsPerDay) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'suggestion_limit', 'You have suggested enough features for today. Thank you: we look at every one.');
    try {
      return this.presentSuggestion(await this.prisma.classifiedFeatureSuggestion.create({ data: { customerId: caller.customer.id, name, nameKey, categoryId: input.category_id ?? null } }));
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return this.presentSuggestion(await this.prisma.classifiedFeatureSuggestion.findFirstOrThrow({ where: { customerId: caller.customer.id, nameKey, status: 'open' } }));
    }
  }

  private presentSuggestion(row: { id: string; name: string; status: string; createdAt: Date }) {
    return { object: 'classified_feature_suggestion' as const, id: row.id, name: row.name, status: row.status, created_at: row.createdAt.toISOString() };
  }

  /** Open suggestions, one row per name, most-asked first. */
  async suggestions() {
    const rows = await this.prisma.classifiedFeatureSuggestion.findMany({ where: { status: 'open' }, include: { category: { select: { name: true } } }, orderBy: { createdAt: 'asc' }, take: 2000 });
    const groups = new Map<string, { name_key: string; name: string; sellers: number; categories: Set<string>; first_at: Date; last_at: Date }>();
    for (const row of rows) {
      const group = groups.get(row.nameKey) ?? { name_key: row.nameKey, name: row.name, sellers: 0, categories: new Set<string>(), first_at: row.createdAt, last_at: row.createdAt };
      group.sellers += 1;
      group.last_at = row.createdAt;
      if (row.category) group.categories.add(row.category.name);
      groups.set(row.nameKey, group);
    }
    const data = [...groups.values()]
      .sort((a, b) => b.sellers - a.sellers || b.last_at.getTime() - a.last_at.getTime())
      .map(group => ({ object: 'classified_feature_suggestion_group' as const, name_key: group.name_key, name: group.name, sellers: group.sellers, categories: [...group.categories], first_at: group.first_at.toISOString(), last_at: group.last_at.toISOString() }));
    return { object: 'list' as const, data };
  }

  async dismissSuggestion(actorId: string | null, nameKey: string) {
    const key = suggestionKey(nameKey);
    const dismissed = await this.prisma.classifiedFeatureSuggestion.updateMany({ where: { nameKey: key, status: 'open' }, data: { status: 'dismissed', decidedById: actorId, decidedAt: new Date() } });
    if (!dismissed.count) throw notFound('suggestion');
    await this.audit.record({ actorId, action: 'classifieds.feature_suggestion_dismissed', targetType: 'classified_feature_suggestion', targetId: key, before: { sellers: dismissed.count }, after: { status: 'dismissed' } });
    return { object: 'classified_feature_suggestion_group' as const, name_key: key, dismissed: dismissed.count };
  }

  // ---- States and areas ----

  /** A market's states (switched off ones too), each with its cities and areas and how many live ads are there. */
  async areas(country: string) {
    if (!(await this.prisma.country.findUnique({ where: { code: country } }))) throw notFound('country');
    const [rows, inAreas, inStates] = await Promise.all([
      this.prisma.classifiedArea.findMany({ where: { country }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
      this.prisma.classifiedListing.groupBy({ by: ['areaId'], where: { country, ...onShopWhere }, _count: { _all: true } }),
      this.prisma.classifiedListing.groupBy({ by: ['stateId'], where: { country, ...onShopWhere }, _count: { _all: true } }),
    ]);
    const areaCounts = new Map(inAreas.map(row => [row.areaId, row._count._all]));
    const stateCounts = new Map(inStates.map(row => [row.stateId, row._count._all]));
    const present = (row: (typeof rows)[number], live: number) => this.presentArea(row, live);
    const data = rows
      .filter(row => row.kind === 'state')
      .map(state => ({ ...present(state, stateCounts.get(state.id) ?? 0), areas: rows.filter(row => row.parentId === state.id).map(area => present(area, areaCounts.get(area.id) ?? 0)) }));
    return { object: 'list' as const, country, data };
  }

  private presentArea(row: { id: string; country: string; kind: string; slug: string; name: string; latitude: Prisma.Decimal; longitude: Prisma.Decimal; enabled: boolean; parentId: string | null }, live: number) {
    return { object: 'classified_admin_area' as const, id: row.id, country: row.country, kind: row.kind as 'state' | 'area', state_id: row.parentId, slug: row.slug, name: row.name, latitude: Number(row.latitude), longitude: Number(row.longitude), enabled: row.enabled, active_listings: live };
  }

  /** Adds a state, or a city or area in a state; its address part comes from the name and never changes. */
  async createArea(actorId: string | null, input: CreateAreaDto) {
    if (!(await this.prisma.country.findUnique({ where: { code: input.country } }))) throw notFound('country');
    let state = null;
    if (input.state_id) {
      state = await this.prisma.classifiedArea.findUnique({ where: { id: input.state_id } });
      if (!state || state.kind !== 'state' || state.country !== input.country) throw invalid('parameter_invalid', 'Choose a state in this market.', 'state_id');
    }
    const name = input.name.replace(/\s+/g, ' ').trim();
    const slug = slugify(name);
    const last = await this.prisma.classifiedArea.findFirst({ where: { country: input.country, parentId: state?.id ?? null }, orderBy: { position: 'desc' }, select: { position: true } });
    let row;
    try {
      row = await this.prisma.classifiedArea.create({ data: { country: input.country, parentId: state?.id ?? null, kind: state ? 'area' : 'state', slug, name, latitude: input.latitude, longitude: input.longitude, position: (last?.position ?? 0) + 1 } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('area_exists', state ? `${state.name} already has ${name}.` : `This market already has ${name}.`, 'name');
      throw error;
    }
    await this.audit.record({ actorId, action: 'classifieds.area_created', targetType: 'classified_area', targetId: row.id, before: null, after: this.presentArea(row, 0) });
    return this.presentArea(row, 0);
  }

  /** Corrects a name or centre point, or switches an area off (no new ads there; live ones keep it). */
  async updateArea(actorId: string | null, id: string, input: UpdateAreaDto) {
    const current = await this.prisma.classifiedArea.findUnique({ where: { id } });
    if (!current) throw notFound('area');
    const row = await this.prisma.classifiedArea.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.replace(/\s+/g, ' ').trim() } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });
    const live = await this.prisma.classifiedListing.count({ where: { status: 'active', ...(row.kind === 'state' ? { stateId: id } : { areaId: id }) } });
    await this.audit.record({ actorId, action: 'classifieds.area_changed', targetType: 'classified_area', targetId: id, before: this.presentArea(current, live), after: this.presentArea(row, live) });
    return this.presentArea(row, live);
  }
}

/** Admin Classifieds: the feature registry, sellers' suggested keys, and states and areas. Support reads; operations change. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/classifieds')
@ProductOnly('udozo')
export class AdminRegistryController {
  constructor(private readonly registry: ClassifiedRegistryService) {}

  @Get('features')
  features(@Query() query: FeaturesQueryDto) {
    return this.registry.features(query.q);
  }

  @Post('features')
  @AdminRoles('operations')
  createFeature(@CurrentCaller() caller: Caller, @Body() body: CreateFeatureDto) {
    return this.registry.createFeature(adminId(caller), body);
  }

  @Patch('features/:key')
  @AdminRoles('operations')
  updateFeature(@CurrentCaller() caller: Caller, @Param('key') key: string, @Body() body: FeatureFieldsDto) {
    return this.registry.updateFeature(adminId(caller), key, body);
  }

  @Get('feature-suggestions')
  suggestions() {
    return this.registry.suggestions();
  }

  @Post('feature-suggestions/dismiss')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  dismiss(@CurrentCaller() caller: Caller, @Body() body: DismissDto) {
    return this.registry.dismissSuggestion(adminId(caller), body.name_key);
  }

  @Get('areas')
  areas(@Query() query: AreasQueryDto) {
    return this.registry.areas(query.country);
  }

  @Post('areas')
  @AdminRoles('operations')
  createArea(@CurrentCaller() caller: Caller, @Body() body: CreateAreaDto) {
    return this.registry.createArea(adminId(caller), body);
  }

  @Patch('areas/:id')
  @AdminRoles('operations')
  updateArea(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateAreaDto) {
    return this.registry.updateArea(adminId(caller), id, body);
  }
}

/** Sellers ask for a feature key the registry lacks (`POST /v1/classifieds/feature-suggestions`). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds')
@ProductOnly('udozo')
export class ClassifiedSuggestionsController {
  constructor(private readonly registry: ClassifiedRegistryService) {}

  @Post('feature-suggestions')
  suggest(@CurrentCustomer() caller: CustomerCaller, @Body() body: SuggestDto) {
    return this.registry.suggest(caller, body);
  }
}
