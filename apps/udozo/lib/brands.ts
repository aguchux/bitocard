import { brandFeatureKey, type ShopBrand, type ShopCategory, type ShopModel } from "@bitocard/api-client/classifieds";
import { query, shopApi } from "./api";
import { featureFilter, type ShopFilters } from "./search";

/** Whether buyers filter a category's listings by brand: it asks for one as a filter, or (a top category) one of its own does. */
export function filtersByBrand(category: ShopCategory, children: ShopCategory[] = []) {
  return [category, ...children].some(item => item.features.some(feature => feature.key === brandFeatureKey && feature.filter));
}

/**
 * The brands a results page offers as filters, from Udozo's brand registry: the category's (a top category's: its
 * subcategories'), with their live listings across the country when `country` is given. None when it is not a brand
 * category, or the API cannot say.
 */
export async function brandFilters(category: ShopCategory | null, children: ShopCategory[], country?: string): Promise<ShopBrand[]> {
  if (!category || !filtersByBrand(category, children)) return [];
  const result = await shopApi<{ data: ShopBrand[] }>(`/v1/classifieds/brands${query({ category: category.slug, country, limit: 120 })}`);
  return result.ok ? result.data.data : [];
}

/**
 * The models a results page offers as filters, once buyers have narrowed to one brand: that brand's in the category with
 * live listings in the country, most listed first. None with no brand or several, or when the API cannot say.
 */
export async function modelFilters(category: ShopCategory | null, filters: ShopFilters, country: string): Promise<ShopModel[]> {
  const chosen = featureFilter(filters, brandFeatureKey)?.values ?? [];
  if (!category || chosen.length !== 1) return [];
  const result = await shopApi<{ data: ShopModel[] }>(`/v1/classifieds/models${query({ category: category.slug, brand: chosen[0], country, limit: 200 })}`);
  return result.ok ? result.data.data.filter(model => model.listings) : [];
}
