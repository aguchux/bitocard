import { brandInitials, brandInk, brandTint } from "@bitocard/api-client/classifieds";

const sizes = { sm: "size-6 rounded-md text-[9px]", md: "size-8 rounded-lg text-[11px]", lg: "size-11 rounded-xl text-sm" } as const;

/**
 * A brand's logo on a white tile (its own colours), or its initials on its colour when it has none. Decorative: the
 * brand's name is always written beside it.
 */
export function BrandLogo({ brand, size = "md" }: { brand: { slug: string; name: string; logo_url: string | null; color: string | null }; size?: keyof typeof sizes }) {
  if (brand.logo_url) {
    return (
      <span className={`grid shrink-0 place-items-center border border-navy-100 bg-white p-1 ${sizes[size]}`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- small logos from Udozo's registry, any host */}
        <img src={brand.logo_url} alt="" loading="lazy" decoding="async" className="size-full object-contain" />
      </span>
    );
  }
  const tint = brandTint(brand);
  return (
    <span className={`grid shrink-0 place-items-center font-bold ${sizes[size]}`} style={{ background: tint, color: brandInk(tint) }} aria-hidden="true">
      {brandInitials(brand.name)}
    </span>
  );
}
