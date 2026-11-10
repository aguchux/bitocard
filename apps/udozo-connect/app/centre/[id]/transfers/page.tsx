import type { Metadata } from "next";
import { Problem } from "@/components/centre-ui";
import { TransfersList } from "@/components/centre-transfers";
import { readCentre, readShelves, readTransfers } from "@/lib/centre-data";

export const metadata: Metadata = { title: "Transfers" };

/** Items moving between Connect places: sent on from here, coming here, and here for someone to collect. */
export default async function TransfersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [centre, transfers, shelves] = await Promise.all([readCentre(id), readTransfers(id), readShelves(id)]);
  if (!centre.ok) return null;
  return (
    <div className="grid gap-4">
      <p className="text-slate-600">A seller may have their return sent on to a centre near them. Send only to the Connect Centre named, never to a home or office.</p>
      {transfers.ok ? <TransfersList centre={id} rows={transfers.data.data} shelves={shelves.ok ? shelves.data.data : []} /> : <Problem message={transfers.message} />}
    </div>
  );
}
