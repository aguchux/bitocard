import { Brand } from "@bitocard/ui/brand";
import { brand as verifyBrand } from "@/lib/brand";

/** The product's logo: BitoCard's lockup, or Afrippa's mark with "Afri" in ink and "ppa" in the accent. */
function Logo() {
  if (verifyBrand.key === "bitocard") return <Brand />;
  const [first, second] = verifyBrand.wordmark;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static mark */}
      <img src={verifyBrand.mark} alt="" className="h-[1.1em] w-auto" />
      <span>
        <span className="text-navy-900">{first}</span>
        <span className="text-brand-500">{second}</span>
      </span>
    </>
  );
}

/**
 * Verify's header: the product's logo (BitoCard's or Afrippa's), and for a store's customers the store they are
 * verifying for (its name and logo), so they know why they are here.
 */
export function VerifyHeader({ brand }: { brand?: { name: string; logo_url: string | null } | null }) {
  const store = brand && brand.name !== verifyBrand.name ? brand : null;
  return (
    <header className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 pt-5 sm:pt-8">
      <span className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink" aria-label={verifyBrand.product}>
        <span className="flex items-center gap-[0.3em]" aria-hidden="true">
          <Logo />
        </span>
        <span className="rounded-full bg-navy-100 px-2 py-0.5 text-xs font-bold text-navy-900">Verify</span>
      </span>
      {store ? (
        <span className="flex min-w-0 items-center gap-2 text-right text-sm text-muted">
          <span className="min-w-0">
            <span className="block text-xs">Verifying for</span>
            <span className="block truncate font-semibold text-ink">{store.name}</span>
          </span>
          {store.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- the store's own logo, from its uploaded address
            <img src={store.logo_url} alt="" className="size-9 shrink-0 rounded-lg border border-line bg-white object-contain" />
          ) : null}
        </span>
      ) : null}
    </header>
  );
}

export function VerifyFooter() {
  return <footer className="mx-auto max-w-xl px-4 pb-8 pt-6 text-center text-xs text-subtle">{`${verifyBrand.product} · A Golojan Ltd venture`}</footer>;
}
