import type { ShopSort } from '@shared/classifieds';

export type SearchParams = {
  country: string;
  q?: string;
  category?: string;
  seller?: string;
  brand?: string;
  condition?: string[];
  sort?: ShopSort;
};

export const pageSize = 24;

/** The search's query: only what is set, conditions repeated as the API reads them (`GET /v1/classifieds/listings`). */
export function searchQuery(params: SearchParams, offset: number) {
  const query = new URLSearchParams({ country: params.country, offset: String(offset), limit: String(pageSize) });
  for (const key of ['q', 'category', 'seller', 'brand', 'sort'] as const) if (params[key]) query.set(key, params[key]!);
  for (const condition of params.condition ?? []) query.append('condition', condition);
  return query.toString();
}
