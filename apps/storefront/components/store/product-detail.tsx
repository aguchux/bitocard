import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { formatFace, type StorePaymentMethods, type StoreProductDetail } from "@bitocard/api-client/storefront";
import { BuyForm } from "@/components/store/buy-form";
import { BrandArt, ProductCard, priceLabel } from "@/components/store/product-card";
import { FeatureIcons } from "@/components/store/features";
import { CategoryIcon, categoryArt } from "@/components/store/category-icon";
import { categoryTheme } from "@/components/store/theme";
import { storeNavigation } from "@/lib/navigation";
import { query, storeApi } from "@/lib/api";
import { currentCustomer } from "@/lib/customer";
import { currentStore } from "@/lib/store";
import { currentMarket } from "@/lib/market";

/** How the customer receives it, by what it is delivered to. */
const delivery: Record<string, string> = {
  none: "Delivered digitally as a code with instructions, straight after payment.",
  phone: "Sent straight to the mobile number you enter at checkout.",
  smartcard: "Paid to the smartcard or IUC number you enter; we show the account name to confirm before you pay.",
  meter: "Paid to the meter number you enter; we show the account name to confirm before you pay.",
};

export function loadProduct(key: string) {
  return storeApi<StoreProductDetail>(`/v1/store/products/${encodeURIComponent(key)}`);
}

/** A product page's title and description; `base` is where its pages live (`/p` or `/account/p`). */
export async function productMetadata(key: string, base: string): Promise<Metadata> {
  const result = await loadProduct(key);
  if (!result.ok) return { title: "Product not found", robots: { index: false } };
  const product = result.data;
  const description = product.description ?? `${product.name}: ${product.category_label.toLowerCase()} from ${product.brand.name}, delivered digitally. ${priceLabel(product)}.`;
  return { title: product.name, description, alternates: { canonical: `${base}/${encodeURIComponent(product.key)}` }, openGraph: { title: product.name, description } };
}

/**
 * A product: its art, what it is and can do, the buy form, how it is delivered, and related products. In the store
 * (`/p/<key>`) with breadcrumbs; inside the customer's account app (`inApp`, `/account/p/<key>`) with a back link to
 * the catalogue, and related products staying in the app.
 */
export async function ProductDetail({ product, inApp = false }: { product: StoreProductDetail; inApp?: boolean }) {
  const base = inApp ? "/account/p" : "/p";
  const theme = categoryTheme[product.category];
  const [navigation, customer, market, { store }] = await Promise.all([storeNavigation(), currentCustomer(), currentMarket(), currentStore()]);
  const art = categoryArt(navigation.groups);
  const values = product.denominations ?? [];
  // Where the customer pays from: their chosen market, else the product's own country (worldwide products ask).
  // A reseller's store sells in its own country only.
  const country = store?.country ? store.country : market && market !== "global" ? market : product.global ? null : product.country;
  const methods = country ? await storeApi<StorePaymentMethods>(`/v1/store/payment-methods${query({ country })}`, { fresh: true }) : null;

  return (
    <div className="space-y-8 sm:space-y-12">
      {inApp ? (
        <Link href={`/account/catalog?group=${encodeURIComponent(navigation.groups.find(group => group.categories.some(item => item.category === product.category))?.key ?? "")}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-[#070f4c]">
          <ChevronLeft className="size-4" aria-hidden="true" /> {product.category_label}
        </Link>
      ) : (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
            <li>
              <Link href="/" className="hover:text-[#070f4c]">
                Home
              </Link>
            </li>
            <ChevronRight className="size-3.5" aria-hidden="true" />
            <li>
              <Link href={`/catalogs/${product.category}`} className="hover:text-[#070f4c]">
                {product.category_label}
              </Link>
            </li>
            <ChevronRight className="size-3.5" aria-hidden="true" />
            <li aria-current="page" className="font-semibold text-[#070f4c]">
              {product.name}
            </li>
          </ol>
        </nav>
      )}

      <div className="grid gap-6 sm:gap-8 lg:grid-cols-2 lg:gap-12">
        <div className="aspect-[16/10] overflow-hidden rounded-2xl shadow-lg sm:rounded-3xl">
          <BrandArt brand={product.brand} product={product} className="text-4xl" />
        </div>
        <div>
          <p className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${theme.tile} ${theme.ink}`}>
            <CategoryIcon category={product.category} iconUrl={art.get(product.category)?.icon} className="size-7" />
            {product.category_label}
            {product.global ? " · Usable anywhere" : ` · ${product.country_name}`}
          </p>
          <h1 className="font-display mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{product.name}</h1>
          <p className="mt-1 text-slate-500">
            {product.brand.name}
            {product.brand.company ? ` · ${product.brand.company}` : ""}
          </p>
          {product.description ? <p className="mt-4 text-lg text-slate-700">{product.description}</p> : null}
          {product.features?.length ? (
            <section aria-labelledby="features" className="mt-6">
              <h2 id="features" className="font-display text-lg font-bold">
                What this {product.category === "virtual_numbers" ? "number" : "product"} can do
              </h2>
              <div className="mt-3">
                <FeatureIcons features={product.features} />
              </div>
              {product.features.includes("app_codes") ? (
                <p className="mt-3 text-sm text-slate-500">Receives SMS codes from apps and services. Some apps do not accept virtual numbers, so check before you rely on one.</p>
              ) : null}
            </section>
          ) : null}

          {/* Signed in, the buy form lists the values itself. */}
          {customer ? null : (
            <section aria-labelledby="values-heading" className="mt-6">
              <h2 id="values-heading" className="font-semibold">
                {values.length ? "Choose a value" : "Value"}
              </h2>
              {values.length ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {values.map(value => (
                    <li key={value} className="rounded-xl border border-slate-200 bg-white px-4 py-2 font-display font-bold">
                      {formatFace(value, product.face_currency)}
                    </li>
                  ))}
                </ul>
              ) : product.range ? (
                <p className="mt-2 font-display text-lg font-bold">
                  Any amount from {formatFace(product.range.min, product.face_currency)} to {formatFace(product.range.max, product.face_currency)}
                </p>
              ) : null}
            </section>
          )}

          <BuyForm
            product={product}
            countries={navigation.countries}
            country={country}
            lockCountry={Boolean(store?.country)}
            methods={methods?.ok ? methods.data.data : []}
            signedIn={Boolean(customer)}
            back={`${base}/${encodeURIComponent(product.key)}`}
            sandbox={methods?.ok ? methods.data.mode === "test" : false}
          />
          <p className="mt-2 text-sm text-slate-500">Values shown are what the product is worth; your price is confirmed on the payment page.</p>

          <div className="mt-6 flex gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
            <Info className="mt-0.5 size-5 shrink-0 text-slate-500" aria-hidden="true" />
            <div>
              <p>{delivery[product.recipient_type] ?? delivery.none}</p>
              {product.redeem_instructions ? <p className="mt-2 whitespace-pre-line">{product.redeem_instructions}</p> : null}
            </div>
          </div>
        </div>
      </div>

      {product.other_countries.length ? (
        <section aria-labelledby="countries-heading">
          <h2 id="countries-heading" className="font-display mb-3 text-[22px] font-extrabold sm:mb-4 sm:text-2xl">
            {product.brand.name} in other countries
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {product.other_countries.map(item => (
              <li key={item.id}>
                <ProductCard product={item} base={base} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {product.related.length ? (
        <section aria-labelledby="related-heading">
          <h2 id="related-heading" className="font-display mb-3 text-[22px] font-extrabold sm:mb-4 sm:text-2xl">
            More {product.category_label.toLowerCase()}
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {product.related.map(item => (
              <li key={item.id}>
                <ProductCard product={item} base={base} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
