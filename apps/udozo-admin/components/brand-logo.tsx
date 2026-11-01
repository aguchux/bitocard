import { brandInitials, brandInk, brandTint } from "@bitocard/api-client/classifieds";

/** A marketplace brand's logo on a white tile, or its initials on its colour when it has none (as udozo.com draws it). */
export function BrandLogo({ brand, size = "md" }: { brand: { slug: string; name: string; logo_url: string | null; color: string | null }; size?: "md" | "lg" }) {
  const box = size === "lg" ? "size-14 rounded-xl text-base" : "size-9 rounded-lg text-xs";
  if (brand.logo_url) {
    return (
      <span className={`flex shrink-0 items-center justify-center border border-line bg-white p-1.5 ${box}`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- logos from the registry, any host */}
        <img src={brand.logo_url} alt="" className="size-full object-contain" />
      </span>
    );
  }
  const tint = brandTint(brand);
  return (
    <span className={`flex shrink-0 items-center justify-center font-bold ${box}`} style={{ background: tint, color: brandInk(tint) }} aria-hidden="true">
      {brandInitials(brand.name)}
    </span>
  );
}
