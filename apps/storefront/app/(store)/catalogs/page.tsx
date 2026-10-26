import type { Metadata } from "next";
import { CatalogueView, loadCatalogue, readParams } from "@/components/store/catalogue";
import { storeNavigation } from "@/lib/navigation";
import { redirect } from "next/navigation";
import { resaleStore } from "@/lib/resale";

export const metadata: Metadata = {
  title: "Catalogue",
  description: "Gift cards, airtime, data, bills, eSIMs, software and more: everything in the store.",
  alternates: { canonical: "/catalogs" },
};

export default async function Catalogue({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // A Resale shop's whole range is its listings.
  if (await resaleStore()) redirect("/listings");
  const params = readParams(await searchParams);
  const [{ groups, countries }, { page, result }] = await Promise.all([storeNavigation(), loadCatalogue({}, params)]);
  return <CatalogueView path="/catalogs" title="Everything in store" description="Gift cards, mobile top-ups, bills and digital essentials." params={params} groups={groups} countries={countries} page={page} result={result} />;
}
