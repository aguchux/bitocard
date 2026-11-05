"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { shopMoney, type ShopBuyOrder } from "@bitocard/api-client/classifieds";
import { acceptedBuyOrders, buyOrderStep } from "@/lib/buy-order-actions";
import type { ListingAction } from "@/lib/shop";
import { type ConfirmOptions, useConfirm } from "@/components/confirm-dialog";
import { listingAction } from "@/lib/shop-actions";

const questions: Partial<Record<ListingAction, ConfirmOptions>> = {
  sold: { title: "Mark it sold?", body: "It leaves the market and shows as sold for 30 days.", action: "Mark sold" },
  delete: { title: "Delete this listing for good?", body: "Its photos and video go too. This cannot be undone.", action: "Delete listing", dismiss: "Keep it", tone: "danger" },
};

/** A listing's buttons on My listings: edit, mark sold, renew, open its public page, delete. */
export function ListingButtons({ id, actions, publicHref, improve = null }: { id: string; actions: ListingAction[]; publicHref: string | null; improve?: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();
  const [buyers, setBuyers] = useState<ShopBuyOrder[]>([]);
  const soldTo = useRef<HTMLDialogElement>(null);
  const run = async (action: "renew" | "sold" | "delete") => {
    // Sold to a buyer who sent a buy order you accepted? Mark it sold to them, so the sale is recorded with them.
    if (action === "sold") {
      const accepted = await acceptedBuyOrders(id);
      if (accepted.length) {
        setBuyers(accepted);
        soldTo.current?.showModal();
        return;
      }
    }
    const question = questions[action];
    if (question && !(await confirm(question))) return;
    setError(null);
    start(async () => {
      const result = await listingAction(id, action);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };
  const sellTo = (order: ShopBuyOrder | null) => {
    soldTo.current?.close();
    setError(null);
    start(async () => {
      const result = order ? await buyOrderStep(order.id, "complete") : await listingAction(id, "sold");
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };
  const button = "flex h-9 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-semibold text-navy-900 hover:border-slate-400 disabled:opacity-60";
  return (
    <div className="grid gap-2">
      {confirmDialog}
      <dialog ref={soldTo} aria-label="Who bought it?" className="sheet m-0 mt-auto w-full max-w-none rounded-t-3xl bg-white p-0 text-navy-900 sm:m-auto sm:max-w-md sm:rounded-3xl" onClick={event => event.target === event.currentTarget && event.currentTarget.close()}>
        <div className="grid gap-3 p-5">
          <h2 className="text-lg font-bold">Who bought it?</h2>
          <p className="text-sm text-slate-600">Mark it sold to the buyer, only once they have paid you and have it. The sale is recorded with them.</p>
          {buyers.map(order => (
            <button key={order.id} type="button" disabled={pending} onClick={() => sellTo(order)} className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-navy-900 px-4 text-left text-sm font-bold hover:bg-navy-50">
              <span>Sold to {order.with.name}</span>
              <span>{shopMoney(order.price, order.currency)}</span>
            </button>
          ))}
          <button type="button" disabled={pending} onClick={() => sellTo(null)} className="min-h-12 rounded-2xl border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50">
            Sold to someone else
          </button>
          <button type="button" onClick={() => soldTo.current?.close()} className="min-h-11 text-sm font-semibold text-slate-600 hover:underline">
            Cancel
          </button>
        </div>
      </dialog>
      <div className="flex gap-2">
        {actions.map(action => {
          if (action === "edit") {
            return (
              <Link key={action} href={`/account/listings/${id}`} className={button}>
                Edit
              </Link>
            );
          }
          if (action === "view") {
            return publicHref ? (
              <a key={action} href={publicHref} className={button}>
                View
              </a>
            ) : null;
          }
          if (action === "submit") return null;
          return (
            <button key={action} type="button" disabled={pending} onClick={() => run(action)} className={`${button} ${action === "delete" ? "text-brand-700" : ""}`}>
              {action === "sold" ? "Mark sold" : action === "renew" ? "Renew" : "Delete"}
            </button>
          );
        })}
      </div>
      {improve ? (
        <Link href={`/account/listings/${id}#improve`} className="text-[13px] font-semibold text-brand-700 hover:underline">
          Improve this listing with {improve}
        </Link>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
