import type { Metadata } from "next";
import type { StoreHome } from "@bitocard/api-client/storefront";
import { HomeSections } from "@/components/store/sections";
import { notFound } from "next/navigation";
import { storeApi } from "@/lib/api";
import { onResellerStore } from "@/lib/store";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The draft home page, from a Storefront Manager preview link (valid for 30 minutes). */
export default async function Preview({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  // bitocard.com's Storefront Manager previews only.
  if (await onResellerStore()) notFound();
  const { token } = await searchParams;
  const home = token ? await storeApi<StoreHome>(`/v1/store/home?preview=${encodeURIComponent(token)}`, { fresh: true }) : null;
  return (
    <>
      <p role="status" className="mb-6 rounded-2xl bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-900">
        Preview of the draft home page. Visitors do not see these changes until they are published.
      </p>
      {home?.ok ? (
        <HomeSections sections={home.data.sections} groups={home.data.navigation} countries={home.data.countries} />
      ) : (
        <p className="rounded-2xl border border-slate-200 p-8 text-center text-slate-600">This preview link has expired or is not valid. Open a new one from the Storefront Manager.</p>
      )}
    </>
  );
}
