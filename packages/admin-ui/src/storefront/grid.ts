/**
 * Pure helpers for the Storefront Manager's home page editor: reordering, sizing, adding and removing sections, and
 * placing them on the editor's grid. They mirror the API's layout rules (`apps/api/src/storefront/layout.ts`): desktop
 * has 12 columns, tablet 6, phones 1 (every section full width, in order).
 */
import { categoryLabels, type Section, type SectionSpan, type SectionType } from '@bitocard/api-client/storefront';

export type Breakpoint = 'lg' | 'md' | 'sm';
export type SpanBreakpoint = 'lg' | 'md';

/** Widths a section may take, in columns. */
export const lgSpans: ReadonlyArray<SectionSpan['lg']> = [3, 4, 6, 8, 9, 12];
export const mdSpans: ReadonlyArray<SectionSpan['md']> = [3, 6];
export const rowOptions: ReadonlyArray<SectionSpan['rows']> = [1, 2];
export const spanOptions = { lg: lgSpans, md: mdSpans } as const;
export const gridColumns: Record<Breakpoint, number> = { lg: 12, md: 6, sm: 1 };

/** The six section types, in the order the "Add section" menu lists them. */
export const sectionTypes: ReadonlyArray<{ type: SectionType; label: string; description: string }> = [
  { type: 'hero', label: 'Hero', description: 'The headline, with the search box and category shortcuts.' },
  { type: 'product_rail', label: 'Product rail', description: 'Products: trending, top selling, new, featured, by category or brand, or hand-picked.' },
  { type: 'category_grid', label: 'Category grid', description: 'Tiles linking to each category on sale.' },
  { type: 'brand_grid', label: 'Brand grid', description: 'Brand logos: featured brands, or brands with a tag.' },
  { type: 'promo', label: 'Promo card', description: 'A coloured card with a message, bullets, a button and an image or illustration.' },
  { type: 'trust_bar', label: 'Trust bar', description: 'Up to four short reassurances, such as secure checkout.' },
];

export const sectionTypeLabel = (type: SectionType) => sectionTypes.find(item => item.type === type)?.label ?? type;

/** A short random id (8 characters, like the API's), different from every id given. */
export function uniqueId(taken: Iterable<string>, random: () => string = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0')) {
  const used = new Set(taken);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const id = random();
    if (id && !used.has(id)) return id;
  }
  let counter = used.size + 1;
  while (used.has(`section-${counter}`)) counter += 1;
  return `section-${counter}`;
}

/** Moves the section at `from` to `to` (both clamped to the list). Returns the same list when nothing moves. */
export function moveSection(sections: Section[], from: number, to: number): Section[] {
  if (from < 0 || from >= sections.length) return sections;
  const target = Math.max(0, Math.min(sections.length - 1, to));
  if (target === from) return sections;
  const next = sections.slice();
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

const update = (sections: Section[], id: string, change: (section: Section) => Section) => {
  const index = sections.findIndex(section => section.id === id);
  if (index < 0) return sections;
  const next = sections.slice();
  next[index] = change(sections[index]);
  return next;
};

const allowed = (breakpoint: SpanBreakpoint, value: number) => (spanOptions[breakpoint] as readonly number[]).includes(value);

/** Sets a section's width at one breakpoint; widths the grid does not allow are ignored. */
export function setSpan(sections: Section[], id: string, breakpoint: SpanBreakpoint, value: number): Section[] {
  if (!allowed(breakpoint, value)) return sections;
  return update(sections, id, section => ({ ...section, span: { ...section.span, [breakpoint]: value } }) as Section);
}

/** Sets how many rows a section spans (1 or 2) on desktop and tablet. */
export function setRows(sections: Section[], id: string, rows: number): Section[] {
  if (rows !== 1 && rows !== 2) return sections;
  return update(sections, id, section => ({ ...section, span: { ...section.span, rows } }) as Section);
}

/** The next allowed width after `current`, wrapping round to the narrowest. */
export function nextSpan(breakpoint: SpanBreakpoint, current: number): number {
  const options = spanOptions[breakpoint] as readonly number[];
  const index = options.indexOf(current);
  return options[(index + 1) % options.length];
}

export function toggleHidden(sections: Section[], id: string): Section[] {
  return update(sections, id, section => ({ ...section, hidden: !section.hidden }));
}

/** Copies a section just after itself, with a new id. */
export function duplicateSection(sections: Section[], id: string, makeId: (taken: string[]) => string = taken => uniqueId(taken)): Section[] {
  const index = sections.findIndex(section => section.id === id);
  if (index < 0) return sections;
  const copy = structuredClone(sections[index]);
  copy.id = makeId(sections.map(section => section.id));
  const next = sections.slice();
  next.splice(index + 1, 0, copy);
  return next;
}

export function removeSection(sections: Section[], id: string): Section[] {
  const next = sections.filter(section => section.id !== id);
  return next.length === sections.length ? sections : next;
}

/** A valid new section of a type, with the API's defaults. */
export function newSection(type: SectionType, id: string): Section {
  const full: SectionSpan = { lg: 12, md: 6, rows: 1 };
  switch (type) {
    case 'hero':
      return { id, type, span: full, hidden: false, title: 'New headline', accent: '', subtitle: '', search: true, categoryChips: true };
    case 'product_rail':
      return { id, type, span: full, hidden: false, title: 'Trending now', subtitle: '', source: 'trending', productKeys: [], limit: 6, filters: false, layout: 'cards' };
    case 'category_grid':
      return { id, type, span: full, hidden: false, title: 'Shop by category', subtitle: '', categories: [] };
    case 'brand_grid':
      return { id, type, span: full, hidden: false, title: 'Popular brands', subtitle: '', tag: '', limit: 12 };
    case 'promo':
      return { id, type, span: { lg: 4, md: 3, rows: 1 }, hidden: false, title: 'New promotion', subtitle: '', body: '', bullets: [], theme: 'pink', illustration: 'none' };
    case 'trust_bar':
      return { id, type, span: full, hidden: false, items: [{ icon: 'lock', title: 'Secure checkout', body: '' }] };
  }
}

/** Adds a new section of a type at the end. */
export function addSection(sections: Section[], type: SectionType, makeId: (taken: string[]) => string = taken => uniqueId(taken)): { sections: Section[]; id: string } {
  const id = makeId(sections.map(section => section.id));
  return { sections: [...sections, newSection(type, id)], id };
}

export type Placement = { id: string; index: number; columns: number; colSpan: number; rowSpan: number; hidden: boolean };

/**
 * Where each section sits at a breakpoint: its column span on that grid (12 on desktop, 6 on tablet, 1 on phones) and
 * row span (2 only on desktop and tablet). Hidden sections are left out unless `includeHidden` (the editor shows them
 * dimmed); `index` is always the section's position in the full list.
 */
export function gridPlacement(sections: Section[], breakpoint: Breakpoint, { includeHidden = false }: { includeHidden?: boolean } = {}): Placement[] {
  const columns = gridColumns[breakpoint];
  return sections.flatMap((section, index) => {
    if (section.hidden && !includeHidden) return [];
    const colSpan = breakpoint === 'sm' ? 1 : Math.min(columns, section.span[breakpoint]);
    const rowSpan = breakpoint === 'sm' ? 1 : section.span.rows === 2 ? 2 : 1;
    return [{ id: section.id, index, columns, colSpan, rowSpan, hidden: section.hidden }];
  });
}

/** The section index in a validation error's `param` (`sections[2].cta.href` gives 2), or null. */
export function sectionIndexFromParam(param: string | null | undefined): number | null {
  const match = /^sections\[(\d+)\]/.exec(param ?? '');
  return match ? Number(match[1]) : null;
}

const sourceLabels: Record<string, string> = { trending: 'Trending', top_selling: 'Top selling', new: 'New', featured: 'Featured brands', category: 'Category', brand: 'Brand', manual: 'Hand-picked' };

/** A one-line description of what a section shows, for the editor's cards. */
export function sectionSummary(section: Section): string {
  switch (section.type) {
    case 'hero':
      return [section.search ? 'Search' : 'No search', section.categoryChips ? 'category chips' : 'no chips'].join(' · ');
    case 'product_rail': {
      const source =
        section.source === 'category' && section.category
          ? categoryLabels[section.category]
          : section.source === 'brand' && section.brand
            ? `Brand: ${section.brand}`
            : sourceLabels[section.source];
      const count = section.source === 'manual' ? section.productKeys.length : section.limit;
      return [source, `${count} product${count === 1 ? '' : 's'}`, section.layout].join(' · ');
    }
    case 'category_grid':
      return section.categories.length ? section.categories.map(category => categoryLabels[category]).join(', ') : 'Every category on sale';
    case 'brand_grid':
      return [section.tag ? `Tag: ${section.tag}` : 'Featured first', `up to ${section.limit}`].join(' · ');
    case 'promo':
      return [`${section.theme} theme`, section.cta ? `button: ${section.cta.label}` : 'no button'].join(' · ');
    case 'trust_bar':
      return `${section.items.length} item${section.items.length === 1 ? '' : 's'}`;
  }
}

/** The section's heading as the editor shows it. */
export const sectionTitle = (section: Section) => (section.type === 'trust_bar' ? section.items.map(item => item.title).join(' · ') : section.title);

/**
 * The layout as it is sent to the API: blank promo bullets (just added, not typed yet) are left out, so an
 * unfinished bullet does not stop the draft saving. Section order is unchanged, so error indexes still match.
 */
export function cleanForSave(sections: Section[]): Section[] {
  return sections.map(section => (section.type === 'promo' && section.bullets.some(bullet => !bullet.trim()) ? { ...section, bullets: section.bullets.filter(bullet => bullet.trim()) } : section));
}
