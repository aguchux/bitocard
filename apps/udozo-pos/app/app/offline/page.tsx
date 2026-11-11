import type { Metadata } from "next";
import { FlaggedSale, HeldSale, ImportUnsent } from "@/components/offline-review";
import { needs } from "@/lib/gates";
import { allows, saleTime } from "@/lib/pos";
import { offlineFlagged, offlineHeld, ownerDevices } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Offline sales", robots: { index: false, follow: false } };

/**
 * Selling with no internet (milestone 9): sales made offline with something to look at, sales an unlinked device
 * uploaded (the owner's to accept or reject), and when each linked till last synced.
 */
export default async function OfflinePage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const pos = await needs("all_sales", "stock_adjust");
  if (!pos.ok) return null;
  const view = pos.data;
  const owner = view.actor === "owner";
  const resolved = (await searchParams).show === "resolved";
  const [flagged, held, devices] = await Promise.all([offlineFlagged(resolved), owner ? offlineHeld() : null, owner ? ownerDevices() : null]);
  const linked = devices?.ok ? devices.data.data.filter(device => !device.revoked_at) : [];
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-pos-ink">Offline sales</h1>
        <p className="mt-1 max-w-2xl text-pos-ink-2">A linked till keeps selling with no internet for cash, card, transfers to your account and other recorded payments, then uploads every sale when it is back online. A sale is never undone; anything to check is listed here.</p>
      </div>

      <section aria-labelledby="flagged" className="grid gap-3 rounded-[20px] bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="flagged" className="font-display text-xl font-bold text-pos-ink">
            {resolved ? "Looked at" : "To look at"}
          </h2>
          <a href={resolved ? "/app/offline" : "/app/offline?show=resolved"} className="text-sm font-semibold">
            {resolved ? "Show what is still to look at" : "Show what was looked at"}
          </a>
        </div>
        {flagged.ok ? (
          flagged.data.data.length ? (
            <ul className="grid gap-2">
              {flagged.data.data.map(sale => (
                <FlaggedSale key={sale.id} sale={sale} canResolve={owner || allows(view.permissions, "stock_adjust")} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-pos-muted">{resolved ? "Nothing looked at yet." : "Nothing to look at: every offline sale went through cleanly."}</p>
          )
        ) : (
          <p role="alert" className="text-sm text-pos-error">
            {flagged.message}
          </p>
        )}
      </section>

      {owner && held ? (
        <section aria-labelledby="held" className="grid gap-3 rounded-[20px] bg-white p-5">
          <div>
            <h2 id="held" className="font-display text-xl font-bold text-pos-ink">
              From unlinked devices
            </h2>
            <p className="mt-1 text-sm text-pos-ink-2">A device you unlinked uploaded what it sold while it was linked. Nothing is applied until you accept it.</p>
          </div>
          {held.ok ? (
            held.data.data.length ? (
              <ul className="grid gap-2">
                {held.data.data.map(row => (
                  <HeldSale key={row.id} held={row} currency={held.data.currency} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-pos-muted">Nothing waiting.</p>
            )
          ) : (
            <p role="alert" className="text-sm text-pos-error">
              {held.message}
            </p>
          )}
        </section>
      ) : null}

      {owner ? (
        <section aria-labelledby="devices" className="grid gap-3 rounded-[20px] bg-white p-5">
          <h2 id="devices" className="font-display text-xl font-bold text-pos-ink">
            Linked tills
          </h2>
          {linked.length ? (
            <ul className="grid gap-2">
              {linked.map(device => (
                <li key={device.id} className="flex flex-wrap justify-between gap-2 border-t border-pos-line pt-2 text-sm">
                  <span className="font-semibold text-pos-ink">
                    {device.name ?? "A device"} · {device.till.name}
                  </span>
                  <span className="text-pos-muted">
                    {device.last_synced_at ? `Synced ${saleTime(device.last_synced_at)}` : "Never synced"}
                    {device.last_upload_at ? ` · uploaded ${saleTime(device.last_upload_at)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-pos-muted">
              No till is linked. Link one in{" "}
              <a href="/app/setup#devices" className="font-semibold">
                Shop and tills
              </a>{" "}
              to sell offline on it.
            </p>
          )}
        </section>
      ) : null}

      {owner ? (
        <section aria-labelledby="import" className="grid gap-3 rounded-[20px] bg-white p-5">
          <div>
            <h2 id="import" className="font-display text-xl font-bold text-pos-ink">
              Upload a till&apos;s file
            </h2>
            <p className="mt-1 text-sm text-pos-ink-2">A till that cannot get online saves what it sold to a file (Save unsent to a file on its offline screen). Bring the file here: Udozo checks it came from that till, and nothing is applied twice.</p>
          </div>
          <ImportUnsent />
        </section>
      ) : null}
    </div>
  );
}
