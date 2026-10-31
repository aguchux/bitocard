import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AreaPicker } from "@/components/area-picker";
import { marketFor } from "@/lib/api";
import { safeNext } from "@/lib/customer";
import { areasOf } from "@/lib/reference";

type Props = { params: Promise<{ cc: string }>; searchParams: Promise<{ next?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const market = await marketFor((await params).cc);
  return { title: `Choose your area in ${market?.name ?? "Udozo"}`, robots: { index: false, follow: true } };
}

/** Choose your area, for listings near you first: back to the search that asked, else the area's own page. */
export default async function AreasPage({ params, searchParams }: Props) {
  const { cc } = await params;
  const market = await marketFor(cc);
  // Pages render alongside the layout, so each checks the market itself.
  if (!market) notFound();
  const raw = (await searchParams).next;
  // Only back into this country's own pages.
  const next = raw && safeNext(raw, "").startsWith(`/${cc}/`) ? raw : null;
  return (
    <div className="mx-auto grid max-w-3xl gap-4 px-4 pt-5">
      <h1 className="text-2xl font-extrabold tracking-tight">Choose your area</h1>
      <p className="text-sm text-navy-600">We show listings in your area first, then nearby, then the rest of {market.name}.</p>
      <AreaPicker country={market.country} states={await areasOf(cc)} next={next} />
      {/* GeoNames' data is CC BY 4.0: credited where its places are listed. */}
      <p className="pb-6 text-xs text-navy-500">
        Places from{" "}
        <a href="https://www.geonames.org/" className="underline" rel="noopener" target="_blank">
          GeoNames
        </a>{" "}
        (
        <a href="https://creativecommons.org/licenses/by/4.0/" className="underline" rel="noopener license" target="_blank">
          CC BY 4.0
        </a>
        ), with changes.
      </p>
    </div>
  );
}
