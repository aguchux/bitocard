import type { Metadata } from "next";
import { Problem } from "@/components/centre-ui";
import { CentreShelves } from "@/components/centre-shelves";
import { readCentre, readShelves } from "@/lib/centre-data";

export const metadata: Metadata = { title: "Storage places" };

export default async function CentreShelvesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [centre, shelves] = await Promise.all([readCentre(id), readShelves(id)]);
  if (!centre.ok) return null;
  if (!shelves.ok) return <Problem message={shelves.message} />;
  return <CentreShelves centre={centre.data} shelves={shelves.data.data} />;
}
