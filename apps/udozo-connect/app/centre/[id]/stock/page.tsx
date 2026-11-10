import type { Metadata } from "next";
import { Problem } from "@/components/centre-ui";
import { StockHistory, StockShelf } from "@/components/centre-stock";
import { readCentre, readStock, readStockChecks } from "@/lib/centre-data";

export const metadata: Metadata = { title: "Stock check" };

/** What should be on each storage place, ticked as it is found; anything missing is flagged to Udozo at once. */
export default async function StockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [centre, stock, checks] = await Promise.all([readCentre(id), readStock(id), readStockChecks(id)]);
  if (!centre.ok) return null;
  const { country } = centre.data;
  return (
    <div className="grid gap-4">
      <p className="text-slate-600">Go to each storage place and tick every item you find there, then save. Anything not ticked is reported to Udozo as missing.</p>
      {stock.ok ? (
        <>
          <p className="font-semibold text-navy-900">
            {stock.data.total === 1 ? "1 item" : `${stock.data.total} items`} should be at the centre
            {stock.data.missing ? <span className="text-red-700"> · {stock.data.missing} missing</span> : null}
          </p>
          {stock.data.groups.map(group => (
            <StockShelf key={group.shelf?.id ?? "none"} centre={id} country={country} group={group} />
          ))}
        </>
      ) : (
        <Problem message={stock.message} />
      )}
      <h2 className="mt-2 text-lg font-extrabold text-navy-900">Latest checks</h2>
      {checks.ok ? <StockHistory checks={checks.data.data} country={country} /> : <Problem message={checks.message} />}
    </div>
  );
}
