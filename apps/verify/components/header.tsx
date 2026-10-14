import { Brand } from "@bitocard/ui/brand";

/**
 * BitoCard Verify's header: the BitoCard logo, and for a store's customers the store they are verifying for (its
 * name and logo), so they know why they are here.
 */
export function VerifyHeader({ brand }: { brand?: { name: string; logo_url: string | null } | null }) {
  const store = brand && brand.name !== "BitoCard" ? brand : null;
  return (
    <header className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 pt-5 sm:pt-8">
      <span className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink" aria-label="BitoCard Verify">
        <span className="flex items-center gap-[0.3em]" aria-hidden="true">
          <Brand />
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
  return <footer className="mx-auto max-w-xl px-4 pb-8 pt-6 text-center text-xs text-subtle">BitoCard Verify · A Golojan Ltd venture</footer>;
}
