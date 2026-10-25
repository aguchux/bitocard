import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { ClassifiedFeature } from '../generated/prisma/client.js';
import { ListingsService } from './listings.service.js';

/** How a registry entry reads in the API: everything the seller's value field needs. */
export function presentFeature(feature: ClassifiedFeature) {
  return {
    object: 'classified_feature' as const,
    key: feature.key,
    name: feature.name,
    icon: feature.icon,
    data_type: feature.dataType,
    unit: feature.unit,
    choices: feature.choices,
    default_value: feature.defaultValue,
    placeholder: feature.placeholder,
    min: feature.min,
    max: feature.max,
    synonyms: feature.synonyms,
    filterable: feature.filterable,
  };
}

/**
 * BitoCard Shop's public reference data: the feature registry (searched by name, key and search words), each open
 * country's categories with what they suggest and their safety checklists, and its states and areas.
 */
@Injectable()
export class ClassifiedReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
  ) {}

  /** Every enabled key, or those matching what the seller types (typing "ram" finds Memory). */
  async features(q?: string) {
    const words = q?.trim().toLowerCase();
    const rows = await this.prisma.classifiedFeature.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } });
    const score = (feature: ClassifiedFeature) => {
      if (!words) return 1;
      const name = feature.name.toLowerCase();
      if (name === words || feature.key === words || feature.synonyms.includes(words)) return 4;
      if (name.startsWith(words) || feature.synonyms.some(word => word.startsWith(words))) return 3;
      if (name.includes(words) || feature.key.includes(words.replace(/\s+/g, '_')) || feature.synonyms.some(word => word.includes(words))) return 2;
      return 0;
    };
    const matches = rows.map(feature => ({ feature, score: score(feature) })).filter(row => row.score > 0);
    matches.sort((a, b) => b.score - a.score || a.feature.name.localeCompare(b.feature.name));
    return { object: 'list' as const, data: matches.map(row => presentFeature(row.feature)) };
  }

  /** The country's open categories, top categories first with their subcategories, each with its suggested keys in order. */
  async categories(country: string) {
    await this.listings.requireOpen(country);
    const rows = await this.prisma.classifiedCategory.findMany({
      where: { enabled: true, countries: { some: { country, enabled: true } } },
      include: { features: { include: { feature: true }, orderBy: { position: 'asc' } } },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    const present = (category: (typeof rows)[number], checklist: string[]) => ({
      object: 'classified_category' as const,
      id: category.id,
      slug: category.slug,
      name: category.name,
      icon: category.icon,
      b2b: category.b2b,
      safety_checklist: category.safetyChecklist.length ? category.safetyChecklist : checklist,
      features: category.features
        .filter(link => link.feature.enabled)
        .map(link => ({ ...presentFeature(link.feature), filter: link.filter, default_value: link.defaultValue ?? link.feature.defaultValue, placeholder: link.placeholder ?? link.feature.placeholder })),
    });
    const data = rows
      .filter(row => !row.parentId)
      .map(top => ({ ...present(top, []), children: rows.filter(row => row.parentId === top.id).map(child => present(child, top.safetyChecklist)) }))
      .filter(top => top.children.length);
    return { object: 'list' as const, data };
  }

  /** The country's states, each with its cities and areas and their centre points. */
  async areas(country: string) {
    await this.listings.requireOpen(country);
    const rows = await this.prisma.classifiedArea.findMany({ where: { country, enabled: true }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
    const point = (row: (typeof rows)[number]) => ({ latitude: Number(row.latitude), longitude: Number(row.longitude) });
    const data = rows
      .filter(row => row.kind === 'state')
      .map(state => ({
        object: 'classified_area' as const,
        id: state.id,
        slug: state.slug,
        name: state.name,
        kind: 'state' as const,
        ...point(state),
        areas: rows.filter(row => row.parentId === state.id).map(area => ({ object: 'classified_area' as const, id: area.id, slug: area.slug, name: area.name, kind: 'area' as const, ...point(area) })),
      }));
    return { object: 'list' as const, data };
  }
}
