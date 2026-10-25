import "server-only";
import { cache } from "react";
import type { ShopState, ShopTopCategory } from "@bitocard/api-client/classifieds";
import { shopApi } from "./api";

type List<T> = { object: "list"; data: T[] };

/** A country's open categories, top categories with their subcategories. Empty while the API is unreachable. */
export const categoriesOf = cache(async (country: string): Promise<ShopTopCategory[]> => {
  const result = await shopApi<List<ShopTopCategory>>(`/v1/classifieds/categories?country=${country.toUpperCase()}`);
  return result.ok ? result.data.data : [];
});

/** A country's states, each with its cities and areas. */
export const areasOf = cache(async (country: string): Promise<ShopState[]> => {
  const result = await shopApi<List<ShopState>>(`/v1/classifieds/areas?country=${country.toUpperCase()}`);
  return result.ok ? result.data.data : [];
});
