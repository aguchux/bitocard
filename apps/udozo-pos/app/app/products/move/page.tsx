import type { Metadata } from "next";
import Link from "next/link";
import { MoveStock, TransferRow } from "@/components/move-stock";
import { needs } from "@/lib/gates";
import type { PosStockTransfers } from "@/lib/pos";
import { posApi } from "@/lib/pos-api";
import { tillCatalogue } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Move stock", robots: { index: false, follow: false } };

/** Moving stock between shops, or between a shop and online, and the latest moves (several shops only). */
export default async function MoveStockPage() {
  await needs("stock_adjust");
  const [catalogue, transfers] = await Promise.all([tillCatalogue(), posApi<PosStockTransfers>("GET", "/stock-transfers?limit=20")]);
  if (!catalogue.ok) {
    return (
      <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
        {catalogue.message}
      </p>
    );
  }
  const shops = catalogue.data.shops ?? [];
  return (
    <div className="grid gap-6">
      <div>
        <Link href="/app/products" className="text-sm font-semibold">
          ← Products
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold text-pos-ink">Move stock</h1>
        <p className="mt-1 max-w-2xl text-pos-ink-2">Between your shops, or to and from online (stock in no shop, which udozo.com orders take first). Your total stock stays the same.</p>
      </div>
      {catalogue.data.split ? (
        <section className="rounded-[20px] bg-white p-5">
          <MoveStock shops={shops} products={catalogue.data.data} />
        </section>
      ) : (
        <p className="rounded-[20px] bg-white p-6 text-pos-ink-2">
          Stock moves between shops once you have more than one. Open another shop in{" "}
          <Link href="/app/setup" className="font-semibold">
            Shop and tills
          </Link>
          .
        </p>
      )}
      <section aria-labelledby="moves" className="rounded-[20px] bg-white p-5">
        <h2 id="moves" className="font-display text-xl font-bold text-pos-ink">
          Latest moves
        </h2>
        {transfers.ok && transfers.data.data.length ? (
          <ul className="mt-2 grid gap-2">
            {transfers.data.data.map(transfer => (
              <TransferRow key={transfer.id} transfer={transfer} canAct />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-pos-muted">{transfers.ok ? "No stock moved yet." : transfers.message}</p>
        )}
      </section>
    </div>
  );
}
