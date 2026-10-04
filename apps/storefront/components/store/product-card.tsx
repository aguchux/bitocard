import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatFace, type StoreBrand, type StoreProduct } from "@bitocard/api-client/storefront";
import { categoryTheme } from "./theme";

export const productHref = (product: Pick<StoreProduct, "key">) => `/p/${encodeURIComponent(product.key)}`;

/** "From $10", or "$10" when there is one value. */
export function priceLabel(product: StoreProduct) {
  if (!product.from) return "";
  const from = formatFace(product.from, product.face_currency);
  return product.to > product.from ? `From ${from}` : from;
}

/** The brand's card art, or its colour (or the category's) with its logo or name. */
export function BrandArt({ brand, product, className = "" }: { brand: StoreBrand; product?: StoreProduct; className?: string }) {
  const theme = product ? categoryTheme[product.category] : categoryTheme.gift_cards;
  if (brand.image_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- brand art is an admin-set https address on any host
      <img src={brand.image_url} alt="" className={`h-full w-full object-cover ${className}`} loading="lazy" />
    );
  }
  return (
    <div
      className={`flex h-full w-full items-center justify-center bg-gradient-to-br p-4 ${brand.color ? "" : theme.card} ${className}`}
      style={brand.color ? { backgroundColor: brand.color } : undefined}
    >
      {brand.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- brand logos are admin-set https addresses on any host
        <img src={brand.logo_url} alt="" className="max-h-[60%] max-w-[70%] object-contain" loading="lazy" />
      ) : (
        <span className="text-center text-2xl font-extrabold tracking-tight text-white drop-shadow-sm">{brand.name}</span>
      )}
    </div>
  );
}

/** A product in a rail or a grid: art, name, what it is, and its face value. */
export function ProductCard({ product }: { product: StoreProduct }) {
  return (
    <Link
      href={productHref(product)}
      className="group flex h-full flex-col rounded-2xl border border-slate-100 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="aspect-[16/9] overflow-hidden rounded-xl">
        <BrandArt brand={product.brand} product={product} />
      </div>
      <div className="flex flex-1 flex-col px-1 pt-3">
        <h3 className="font-display text-lg font-bold leading-snug text-[#070f4c]">{product.name}</h3>
        <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{product.description ?? `${product.category_label}${product.global ? "" : ` · ${product.country_name}`}`}</p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <p className="text-sm text-slate-500">
            <span className="font-display text-lg font-extrabold text-[#070f4c]">{priceLabel(product)}</span>
          </p>
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-pink-50 text-[#ff2382] transition group-hover:bg-[#ff2382] group-hover:text-white">
            <ArrowRight className="size-5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

/** The same product as a row: compact art on the left. */
export function ProductRow({ product }: { product: StoreProduct }) {
  return (
    <Link href={productHref(product)} className="group flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm transition hover:shadow-md">
      <div className="aspect-[16/10] w-28 shrink-0 overflow-hidden rounded-xl sm:w-36">
        <BrandArt brand={product.brand} product={product} className="text-base" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-display truncate text-base font-bold text-[#070f4c] sm:text-lg">{product.name}</h3>
        <p className="truncate text-sm text-slate-500">{product.description ?? `${product.category_label} · ${product.country_name}`}</p>
        <p className="mt-1 font-display text-base font-extrabold text-[#070f4c]">{priceLabel(product)}</p>
      </div>
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-pink-50 text-[#ff2382] transition group-hover:bg-[#ff2382] group-hover:text-white">
        <ArrowRight className="size-5" />
      </span>
    </Link>
  );
}
