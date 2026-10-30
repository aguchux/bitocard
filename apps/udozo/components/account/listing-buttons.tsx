"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ListingAction } from "@/lib/shop";
import { listingAction } from "@/lib/shop-actions";

const confirmText: Partial<Record<ListingAction, string>> = {
  sold: "Mark it sold? It leaves the market and shows as sold for 30 days.",
  delete: "Delete this listing for good? Its photos go too.",
};

/** A listing's buttons on My listings: edit, mark sold, renew, open its public page, delete. */
export function ListingButtons({ id, actions, publicHref, improve = null }: { id: string; actions: ListingAction[]; publicHref: string | null; improve?: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (action: "renew" | "sold" | "delete") => {
    const question = confirmText[action];
    if (question && !window.confirm(question)) return;
    setError(null);
    start(async () => {
      const result = await listingAction(id, action);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };
  const button = "flex h-9 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-semibold text-navy-900 hover:border-slate-400 disabled:opacity-60";
  return (
    <div className="grid gap-2">
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
