import { describe, expect, test } from 'vitest';
import type { Section, SectionType } from '@bitocard/api-client/storefront';
import {
  addSection,
  cleanForSave,
  duplicateSection,
  gridPlacement,
  lgSpans,
  mdSpans,
  moveSection,
  newSection,
  nextSpan,
  removeSection,
  rowOptions,
  sectionIndexFromParam,
  sectionSummary,
  sectionTitle,
  sectionTypeLabel,
  sectionTypes,
  setRows,
  setSpan,
  toggleHidden,
  uniqueId,
} from '../src/storefront';

const layout = (): Section[] => [
  newSection('hero', 'a'),
  { ...newSection('product_rail', 'b'), span: { lg: 8, md: 6, rows: 2 } } as Section,
  newSection('promo', 'c'),
  { ...newSection('promo', 'd'), hidden: true },
];
const ids = (sections: Section[]) => sections.map(section => section.id);

describe('moving sections', () => {
  test('moves forwards and backwards, clamping the target', () => {
    expect(ids(moveSection(layout(), 0, 2))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(moveSection(layout(), 3, 1))).toEqual(['a', 'd', 'b', 'c']);
    expect(ids(moveSection(layout(), 1, 99))).toEqual(['a', 'c', 'd', 'b']);
    expect(ids(moveSection(layout(), 2, -5))).toEqual(['c', 'a', 'b', 'd']);
  });
  test('returns the same list when nothing moves', () => {
    const sections = layout();
    expect(moveSection(sections, 1, 1)).toBe(sections);
    expect(moveSection(sections, 7, 0)).toBe(sections);
    expect(moveSection(sections, -1, 0)).toBe(sections);
  });
  test('never changes the list it was given', () => {
    const sections = layout();
    moveSection(sections, 0, 3);
    expect(ids(sections)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('sizing sections', () => {
  test('allowed widths per breakpoint', () => {
    expect(lgSpans).toEqual([3, 4, 6, 8, 9, 12]);
    expect(mdSpans).toEqual([3, 6]);
    expect(rowOptions).toEqual([1, 2]);
  });
  test('sets a width only to an allowed value, keeping the other breakpoint', () => {
    const sections = layout();
    const wider = setSpan(sections, 'c', 'lg', 6);
    expect(wider[2].span).toEqual({ lg: 6, md: 3, rows: 1 });
    expect(sections[2].span.lg).toBe(4);
    expect(setSpan(sections, 'c', 'md', 6)[2].span).toEqual({ lg: 4, md: 6, rows: 1 });
    expect(setSpan(sections, 'c', 'lg', 5)).toBe(sections);
    expect(setSpan(sections, 'c', 'md', 4)).toBe(sections);
    expect(setSpan(sections, 'missing', 'lg', 6)).toBe(sections);
  });
  test('sets rows to 1 or 2 only', () => {
    const sections = layout();
    expect(setRows(sections, 'a', 2)[0].span.rows).toBe(2);
    expect(setRows(sections, 'b', 1)[1].span.rows).toBe(1);
    expect(setRows(sections, 'a', 3)).toBe(sections);
  });
  test('the next width wraps round', () => {
    expect(nextSpan('lg', 3)).toBe(4);
    expect(nextSpan('lg', 9)).toBe(12);
    expect(nextSpan('lg', 12)).toBe(3);
    expect(nextSpan('md', 3)).toBe(6);
    expect(nextSpan('md', 6)).toBe(3);
    expect(nextSpan('lg', 7)).toBe(3);
  });
});

describe('hiding, duplicating and removing', () => {
  test('toggles hidden', () => {
    const sections = layout();
    expect(toggleHidden(sections, 'a')[0].hidden).toBe(true);
    expect(toggleHidden(sections, 'd')[3].hidden).toBe(false);
    expect(sections[0].hidden).toBe(false);
    expect(toggleHidden(sections, 'missing')).toBe(sections);
  });
  test('duplicates just after the original, with a new id and a deep copy', () => {
    const sections = [{ ...newSection('promo', 'p'), bullets: ['One'] } as Section];
    const copied = duplicateSection(sections, 'p', () => 'p2');
    expect(ids(copied)).toEqual(['p', 'p2']);
    expect(copied[1]).toEqual({ ...sections[0], id: 'p2' });
    (copied[1] as Extract<Section, { type: 'promo' }>).bullets.push('Two');
    expect((sections[0] as Extract<Section, { type: 'promo' }>).bullets).toEqual(['One']);
    expect(ids(duplicateSection(layout(), 'b', () => 'x'))).toEqual(['a', 'b', 'x', 'c', 'd']);
    expect(duplicateSection(sections, 'missing')).toBe(sections);
  });
  test('duplicate ids are always unique by default', () => {
    const copied = duplicateSection(layout(), 'a');
    expect(new Set(ids(copied)).size).toBe(5);
  });
  test('removes a section', () => {
    const sections = layout();
    expect(ids(removeSection(sections, 'b'))).toEqual(['a', 'c', 'd']);
    expect(removeSection(sections, 'missing')).toBe(sections);
  });
  test('unique ids avoid the taken ones', () => {
    const values = ['a', 'a', 'b'];
    expect(uniqueId(['a'], () => values.shift() ?? 'z')).toBe('b');
    expect(uniqueId(['same'], () => 'same')).toBe('section-2');
    expect(uniqueId([])).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe('new sections', () => {
  test('every type has a valid default matching the API', () => {
    expect(sectionTypes.map(item => item.type)).toEqual(['hero', 'product_rail', 'category_grid', 'brand_grid', 'promo', 'trust_bar']);
    for (const { type } of sectionTypes) {
      const section = newSection(type, 'n');
      expect(section.type).toBe(type);
      expect(section.id).toBe('n');
      expect(section.hidden).toBe(false);
      expect(lgSpans).toContain(section.span.lg);
      expect(mdSpans).toContain(section.span.md);
      expect(section.span.rows).toBe(1);
      expect(sectionTitle(section).length).toBeGreaterThan(0);
    }
    expect(newSection('product_rail', 'n')).toMatchObject({ source: 'trending', span: { lg: 12, md: 6, rows: 1 }, limit: 6, filters: false, layout: 'cards', productKeys: [] });
    expect(newSection('brand_grid', 'n')).toMatchObject({ tag: '', limit: 12 });
    expect(newSection('promo', 'n')).toMatchObject({ theme: 'pink', illustration: 'none', bullets: [], span: { lg: 4, md: 3 } });
    expect(newSection('hero', 'n')).toMatchObject({ search: true, categoryChips: true });
    expect(newSection('category_grid', 'n')).toMatchObject({ categories: [] });
    expect((newSection('trust_bar', 'n') as Extract<Section, { type: 'trust_bar' }>).items).toHaveLength(1);
  });
  test('adds at the end with a new id', () => {
    const { sections, id } = addSection(layout(), 'brand_grid', () => 'new');
    expect(id).toBe('new');
    expect(ids(sections)).toEqual(['a', 'b', 'c', 'd', 'new']);
    expect(sections[4].type).toBe('brand_grid');
  });
  test('type labels', () => {
    expect(sectionTypeLabel('trust_bar')).toBe('Trust bar');
    expect(sectionTypeLabel('unknown' as SectionType)).toBe('unknown');
  });
});

describe('grid placement', () => {
  test('desktop uses the lg span and rows on a 12-column grid, leaving hidden sections out', () => {
    expect(gridPlacement(layout(), 'lg')).toEqual([
      { id: 'a', index: 0, columns: 12, colSpan: 12, rowSpan: 1, hidden: false },
      { id: 'b', index: 1, columns: 12, colSpan: 8, rowSpan: 2, hidden: false },
      { id: 'c', index: 2, columns: 12, colSpan: 4, rowSpan: 1, hidden: false },
    ]);
  });
  test('tablet uses the md span on a 6-column grid', () => {
    expect(gridPlacement(layout(), 'md').map(item => [item.id, item.colSpan, item.rowSpan, item.columns])).toEqual([
      ['a', 6, 1, 6],
      ['b', 6, 2, 6],
      ['c', 3, 1, 6],
    ]);
  });
  test('phones are full width, one row each, in order', () => {
    expect(gridPlacement(layout(), 'sm', { includeHidden: true }).map(item => [item.id, item.colSpan, item.rowSpan, item.hidden])).toEqual([
      ['a', 1, 1, false],
      ['b', 1, 1, false],
      ['c', 1, 1, false],
      ['d', 1, 1, true],
    ]);
  });
  test('index is the position in the full list', () => {
    const sections = toggleHidden(layout(), 'a');
    expect(gridPlacement(sections, 'lg').map(item => item.index)).toEqual([1, 2]);
  });
});

describe('errors and summaries', () => {
  test('finds the section index in a validation param', () => {
    expect(sectionIndexFromParam('sections[2].cta.href')).toBe(2);
    expect(sectionIndexFromParam('sections[10]')).toBe(10);
    expect(sectionIndexFromParam('sections')).toBeNull();
    expect(sectionIndexFromParam(undefined)).toBeNull();
  });
  test('summaries describe what each section shows', () => {
    const rail = newSection('product_rail', 'r') as Extract<Section, { type: 'product_rail' }>;
    expect(sectionSummary(rail)).toBe('Trending · 6 products · cards');
    expect(sectionSummary({ ...rail, source: 'category', category: 'esim', layout: 'list', limit: 1 })).toBe('eSIMs · 1 product · list');
    expect(sectionSummary({ ...rail, source: 'brand', brand: 'amazon' })).toBe('Brand: amazon · 6 products · cards');
    expect(sectionSummary({ ...rail, source: 'manual', productKeys: ['x', 'y'] })).toBe('Hand-picked · 2 products · cards');
    expect(sectionSummary(newSection('hero', 'h'))).toBe('Search · category chips');
    expect(sectionSummary(newSection('category_grid', 'c'))).toBe('Every category on sale');
    expect(sectionSummary({ ...newSection('category_grid', 'c'), categories: ['airtime', 'data'] } as Section)).toBe('Airtime, Data');
    expect(sectionSummary(newSection('brand_grid', 'b'))).toBe('Featured first · up to 12');
    expect(sectionSummary({ ...newSection('promo', 'p'), cta: { label: 'Go', href: '/' } } as Section)).toBe('pink theme · button: Go');
    expect(sectionSummary(newSection('trust_bar', 't'))).toBe('1 item');
    expect(sectionTitle(newSection('trust_bar', 't'))).toBe('Secure checkout');
  });
});

describe('saving', () => {
  test('blank promo bullets are left out, everything else is kept as it is', () => {
    const promo = { ...newSection('promo', 'p'), bullets: ['One', ' ', ''] } as Section;
    const sections = [newSection('hero', 'h'), promo];
    const cleaned = cleanForSave(sections);
    expect(cleaned[0]).toBe(sections[0]);
    expect((cleaned[1] as Extract<Section, { type: 'promo' }>).bullets).toEqual(['One']);
    expect((sections[1] as Extract<Section, { type: 'promo' }>).bullets).toHaveLength(3);
    const tidy = [newSection('promo', 'q')];
    expect(cleanForSave(tidy)[0]).toBe(tidy[0]);
  });
});
