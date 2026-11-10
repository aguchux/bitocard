import type { Metadata } from "next";
import { Problem } from "@/components/centre-ui";
import { ReturnsList } from "@/components/centre-returns";
import { readCentre, readReturns } from "@/lib/centre-data";

export const metadata: Metadata = { title: "Returns" };

/** Items going back to their sellers: waiting for an answer, then handed back against the seller's return code. */
export default async function ReturnsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [centre, returns] = await Promise.all([readCentre(id), readReturns(id)]);
  if (!centre.ok) return null;
  return (
    <div className="grid gap-4">
      <p className="text-slate-600">Ask for a return on the item&apos;s own page. Keep each item safe until its seller collects it.</p>
      {returns.ok ? <ReturnsList centre={id} country={centre.data.country} returns={returns.data.data} /> : <Problem message={returns.message} />}
    </div>
  );
}
