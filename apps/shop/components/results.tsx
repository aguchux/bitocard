import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { conditionLabels, shopMoney, sortLabels, type ShopCategory, type ShopCondition, type ShopResult, type ShopSearch, type ShopSort, type ShopTier } from "@bitocard/api-client/classifieds";
import { featureFilter, filterCount, filtersHref, maxOffset, perPage, type ShopFilters } from "@/lib/search";
import { ListingRow } from "./listing-card";

/** Where each tier sits from the buyer's place outwards. */
export function tierHeading(tier: ShopTier, place: { area?: string | null; state?: string | null; country: string }) {
  if (tier === "area") return `In ${place.area ?? "your area"}`;
  if (tier === "nearby") return "Nearby";
  if (tier === "state") return `More in ${place.state ?? "the state"}`;
  return `Across ${place.country}`;
}

/** Consecutive results of the same tier, in order (the API sorts by tier first). */
export function groupByTier(rows: ShopResult[]) {
  const groups: { tier: ShopTier | null; rows: ShopResult[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last && last.tier === row.tier) last.rows.push(row);
    else groups.push({ tier: row.tier, rows: [row] });
  }
  return groups;
}

const conditions: ShopCondition[] = ["new", "used", "untested", "parts"];
const sorts: ShopSort[] = ["relevant", "newest", "price_asc", "price_desc"];
const field = "h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[15px] focus:border-navy-500 focus:ring-2 focus:ring-brand-500/30";

/**
 * The filters, as a plain GET form that works without script: price, condition, the category's feature filters and the
 * sort. Words and the buyer's place are kept as they are.
 */
function FiltersForm({ path, filters, category, currency }: { path: string; filters: ShopFilters; category: ShopCategory | null; currency: string }) {
  const count = filterCount(filters);
  const filterable = (category?.features ?? []).filter(feature => feature.filter);
  const symbol = shopMoney(0, currency).replace(/[\d.,\s]/g, "");
  return (
    <details className="group rounded-2xl border border-navy-200 bg-white" open={false}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal className="size-4" aria-hidden="true" /> Filters
        {count ? <span className="grid size-5 place-items-center rounded-full bg-brand-700 text-xs text-white">{count}</span> : null}
        <span className="ml-auto text-xs font-medium text-navy-500 group-open:hidden">Price, condition{filterable.length ? ", features" : ""}</span>
      </summary>
      <form action={path} method="get" className="grid gap-4 border-t border-navy-100 p-3.5 sm:grid-cols-2">
        {filters.q ? <input type="hidden" name="q" value={filters.q} /> : null}
        {filters.area ? <input type="hidden" name="area" value={filters.area} /> : null}
        {filters.state ? <input type="hidden" name="state" value={filters.state} /> : null}
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm font-semibold">Price ({symbol})</legend>
          <div className="flex items-center gap-2">
            <input name="min" inputMode="numeric" placeholder="Lowest" defaultValue={filters.priceMin ?? ""} aria-label="Lowest price" className={field} />
            <span aria-hidden="true">–</span>
            <input name="max" inputMode="numeric" placeholder="Highest" defaultValue={filters.priceMax ?? ""} aria-label="Highest price" className={field} />
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">Condition</legend>
          <div className="flex flex-wrap gap-2">
            {conditions.map(condition => (
              <label key={condition} className="flex min-h-10 items-center gap-2 rounded-full border border-navy-200 px-3 text-sm has-checked:border-navy-900 has-checked:bg-navy-900 has-checked:text-white">
                <input type="checkbox" name="condition" value={condition} defaultChecked={filters.condition.includes(condition)} className="sr-only" />
                {conditionLabels[condition]}
              </label>
            ))}
          </div>
        </fieldset>
        {filterable.map(feature => {
          const current = featureFilter(filters, feature.key);
          if (feature.data_type === "number") {
            return (
              <fieldset key={feature.key} className="grid gap-1.5">
                <legend className="mb-1.5 text-sm font-semibold">
                  {feature.name}
                  {feature.unit ? ` (${feature.unit})` : ""}
                </legend>
                <div className="flex items-center gap-2">
                  <input name={`f.${feature.key}.min`} inputMode="decimal" placeholder="From" defaultValue={current?.min ?? ""} aria-label={`${feature.name} from`} className={field} />
                  <span aria-hidden="true">–</span>
                  <input name={`f.${feature.key}.max`} inputMode="decimal" placeholder="To" defaultValue={current?.max ?? ""} aria-label={`${feature.name} to`} className={field} />
                </div>
              </fieldset>
            );
          }
          if (feature.data_type === "choice" && feature.choices.length) {
            return (
              <fieldset key={feature.key}>
                <legend className="mb-1.5 text-sm font-semibold">{feature.name}</legend>
                <div className="flex flex-wrap gap-2">
                  {feature.choices.map(choice => (
                    <label key={choice} className="flex min-h-10 items-center rounded-full border border-navy-200 px-3 text-sm has-checked:border-navy-900 has-checked:bg-navy-900 has-checked:text-white">
                      <input type="checkbox" name={`f.${feature.key}`} value={choice} defaultChecked={current?.values.includes(choice.toLowerCase()) || current?.values.includes(choice)} className="sr-only" />
                      {choice}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          }
          if (feature.data_type === "boolean") {
            return (
              <label key={feature.key} className="flex min-h-11 items-center gap-2.5 text-sm font-semibold">
                <input type="checkbox" name={`f.${feature.key}`} value="yes" defaultChecked={current?.values.includes("yes")} className="size-5 accent-navy-900" />
                {feature.name}
              </label>
            );
          }
          return (
            <label key={feature.key} className="grid gap-1.5 text-sm font-semibold">
              {feature.name}
              <input name={`f.${feature.key}`} placeholder={feature.placeholder ?? ""} defaultValue={current?.values.join(", ") ?? ""} className={field} />
            </label>
          );
        })}
        <label className="grid gap-1.5 text-sm font-semibold">
          Sort by
          <select name="sort" defaultValue={filters.sort ?? (filters.q ? "relevant" : "newest")} className={field}>
            {sorts.map(sort => (
              <option key={sort} value={sort}>
                {sortLabels[sort]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2 sm:col-span-2">
          <button type="submit" className="h-11 flex-1 rounded-xl bg-navy-900 px-5 font-bold text-white hover:bg-navy-800 sm:flex-none">
            Show results
          </button>
          {count || filters.sort ? (
            <Link href={filtersHref(path, filters, { priceMin: null, priceMax: null, condition: [], features: [], sort: null })} className="flex h-11 items-center rounded-xl px-4 font-semibold text-brand-700 hover:underline">
              Clear
            </Link>
          ) : null}
        </div>
      </form>
    </details>
  );
}

/**
 * A page of results: the filters, the count, the results in their tiers (from the buyer's place outwards) and the
 * pages. Empty results say so and offer to widen the search.
 */
export function Results({
  result,
  filters,
  path,
  category,
  place,
  currency,
}: {
  result: ShopSearch;
  filters: ShopFilters;
  path: string;
  category: ShopCategory | null;
  place: { area?: string | null; state?: string | null; country: string };
  currency: string;
}) {
  const pages = Math.min(Math.ceil(result.total / perPage), Math.floor(maxOffset / perPage) + 1);
  return (
    <div className="grid gap-4">
      <FiltersForm path={path} filters={filters} category={category} currency={currency} />
      <p className="text-sm text-navy-600" aria-live="polite">
        {result.total === 0 ? "No listings match yet." : `${result.total.toLocaleString("en-GB")} listing${result.total === 1 ? "" : "s"}`}
        {result.total ? ` · ${sortLabels[result.sort]}` : ""}
      </p>
      {result.total === 0 && (filterCount(filters) || filters.q) ? (
        <p className="rounded-2xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-600">
          Try fewer filters or other words.{" "}
          <Link href={path} className="font-semibold text-brand-700 hover:underline">
            See everything here
          </Link>
        </p>
      ) : null}
      {groupByTier(result.data).map((group, index) => (
        <section key={`${group.tier ?? "all"}-${index}`} className="grid gap-2.5">
          {group.tier ? (
            <h2 className="flex items-baseline gap-2 text-base font-bold">
              {tierHeading(group.tier, place)}
              {result.tiers ? <span className="text-sm font-medium text-navy-500">{result.tiers[group.tier].toLocaleString("en-GB")}</span> : null}
            </h2>
          ) : null}
          <div className="grid gap-2.5 lg:grid-cols-2">
            {group.rows.map(row => (
              <ListingRow key={row.id} card={row} />
            ))}
          </div>
        </section>
      ))}
      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-center gap-2 pt-2">
          {filters.page > 1 ? (
            <Link href={filtersHref(path, filters, { page: filters.page - 1 })} rel="prev" className="flex h-11 items-center rounded-xl border border-navy-200 px-4 font-semibold hover:border-navy-400">
              Previous
            </Link>
          ) : null}
          <span className="px-2 text-sm text-navy-600">
            Page {filters.page} of {pages}
          </span>
          {filters.page < pages ? (
            <Link href={filtersHref(path, filters, { page: filters.page + 1 })} rel="next" className="flex h-11 items-center rounded-xl border border-navy-200 px-4 font-semibold hover:border-navy-400">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
