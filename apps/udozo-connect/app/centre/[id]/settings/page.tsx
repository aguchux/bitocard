import type { Metadata } from "next";
import { CentreSettings } from "@/components/centre-settings";
import { readCentre } from "@/lib/centre-data";

export const metadata: Metadata = { title: "Your centre's details" };

export default async function CentreSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const read = await readCentre(id);
  if (!read.ok) return null;
  return <CentreSettings key={`${read.data.status}:${read.data.hours}:${read.data.phone}`} centre={read.data} />;
}
