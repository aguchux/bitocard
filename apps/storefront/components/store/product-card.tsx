import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatFace, type StoreBrand, type StoreProduct } from "@bitocard/api-client/storefront";
import { BrandImage } from "./brand-image";
import { FeatureIcons } from "./features";
import { Flag } from "./flag";
import { categoryTheme } from "./theme";

export const productHref = (product: Pick<StoreProduct, "key">) => `/p/${encodeURIComponent(product.key)}`;

/** "From $10", or "$10" when there is one value. */
export function priceLabel(product: StoreProduct) {
  if (!product.from) return "";
  const from = formatFace(product.from, product.face_currency);
  return product.to > product.from ? `From ${from}` : from;
}

/** Dark text on light brand colours (MTN yellow), white on dark ones. */
function inkOn(color: string | null) {
  const hex = color?.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#070f4c" : "#ffffff";
}

/** The brand's initials, when it has no logo (or its logo fails to load). */
function Initials({ brand }: { brand: StoreBrand }) {
  return (
    <span className="font-display text-center text-[2.2em] leading-none font-extrabold tracking-tight drop-shadow-sm" style={{ color: inkOn(brand.color) }} aria-label={brand.name}>
      {brand.initials ?? brand.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

/**
 * The brand's card art; else its colour (or the category's) with its logo on a white tile (so a logo in the brand's
 * own colour still shows); else with its initials. Logos and art come from the brand's settings, the brand registry
 * or its bundled icons; a failed image falls back the same way.
 */
export function BrandArt({ brand, product, className = "" }: { brand: StoreBrand; product?: StoreProduct; className?: string }) {
  const theme = product ? categoryTheme[product.category] : categoryTheme.gift_cards;
  const plate = (
    <div
      className={`flex h-full w-full items-center justify-center bg-gradient-to-br p-4 ${brand.color ? "" : theme.card} ${className}`}
      style={brand.color ? { backgroundColor: brand.color } : undefined}
    >
      {product?.category === "virtual_numbers" && !brand.logo_url ? (
        // A number shows its country's flag, not the initials of its type ("local", "mobile").
        <span className="flex flex-col items-center gap-2">
          <Flag code={product.country} className="h-14 w-20 rounded-md shadow-lg sm:h-16 sm:w-24" />
          <span className="rounded-full bg-white/90 px-2.5 py-0.5 text-[0.55em] font-bold tracking-wide text-[#070f4c] uppercase">{brand.name} number</span>
        </span>
      ) : brand.logo_url ? (
        <BrandImage
          src={brand.logo_url}
          frame="flex aspect-square h-[64%] max-h-32 items-center justify-center rounded-[22%] bg-white p-[9%] shadow-md ring-1 ring-black/5"
          className="h-full w-full object-contain"
          fallback={<Initials brand={brand} />}
        />
      ) : (
        <Initials brand={brand} />
      )}
    </div>
  );
  if (brand.image_url) return <BrandImage src={brand.image_url} className={`h-full w-full object-cover ${className}`} fallback={plate} />;
  return plate;
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
        {product.features?.length ? (
          <div className="mt-2.5">
            <FeatureIcons features={product.features} compact />
          </div>
        ) : null}
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
        {product.features?.length ? (
          <div className="mt-1.5">
            <FeatureIcons features={product.features} compact />
          </div>
        ) : null}
        <p className="mt-1 font-display text-base font-extrabold text-[#070f4c]">{priceLabel(product)}</p>
      </div>
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-pink-50 text-[#ff2382] transition group-hover:bg-[#ff2382] group-hover:text-white">
        <ArrowRight className="size-5" />
      </span>
    </Link>
  );
}
