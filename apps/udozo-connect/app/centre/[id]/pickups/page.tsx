import type { Metadata } from "next";
import { FraPanel, PickupCard } from "@/components/centre-pickups";
import { Problem } from "@/components/centre-ui";
import { readPickups } from "@/lib/centre-data";

export const metadata: Metadata = { title: "Pickups" };

/** Udozo's pickups of the centre's abandoned items to its Final Return Address, handed over against the collector's code. */
export default async function PickupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pickups = await readPickups(id);
  if (!pickups.ok) return <Problem message={pickups.message} />;
  const { data, final_return_address } = pickups.data;
  return (
    <div className="grid gap-4">
      <FraPanel fra={final_return_address} />
      {data.length ? data.map(pickup => <PickupCard key={pickup.id} centre={id} pickup={pickup} />) : <p className="text-slate-600">No pickups yet. Udozo schedules one when items here are abandoned.</p>}
    </div>
  );
}
