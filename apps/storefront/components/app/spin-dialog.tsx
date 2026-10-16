"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Gift, X } from "lucide-react";
import type { StoreSpinRewards } from "@bitocard/api-client/storefront";
import { appUrl } from "@bitocard/ui/site";
import { SpinWheel } from "@/components/app/spin-wheel";
import { usd } from "@/lib/spin";

/** What the card on Home says: what is won so far and today's spins, never a total. */
export function spinNote(rewards: StoreSpinRewards) {
  const allowance = rewards.allowance;
  if (!allowance) return "Spin the wheel and win crypto rewards to spend in the store.";
  const won = `${usd(allowance.won_usd)} won`;
  if (allowance.finished) return Number(rewards.rewards.usd) > 0 ? `${usd(rewards.rewards.usd)} of rewards to move to your wallet` : won;
  return allowance.today_left > 0 && rewards.enabled ? `${won} · ${allowance.today_left} ${allowance.today_left === 1 ? "spin" : "spins"} left today` : `${won} · come back tomorrow`;
}

/**
 * Spin and win over the whole screen: the card on Home opens a native modal dialog, dark from edge to edge, with the
 * wheel, the rewards and the latest wins (Escape or the close button shut it). `/account?spin=1` opens it on arrival
 * (older links and sign-in come back there), then takes `spin` out of the address. A win or an exchange refreshes Home
 * underneath, so the wallet's figure is right when the dialog closes.
 */
export function SpinDialog({ rewards, open: openOnArrival = false }: { rewards: StoreSpinRewards; open?: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(openOnArrival);

  useEffect(() => {
    if (!openOnArrival) return;
    dialog.current?.showModal();
    router.replace("/account", { scroll: false });
  }, [openOnArrival, router]);

  // The page underneath must not scroll while the dialog covers it.
  useEffect(() => {
    if (!open) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [open]);

  const show = () => {
    dialog.current?.showModal();
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="flex w-full items-center gap-4 rounded-3xl bg-gradient-to-r from-navy-900 to-plum-900 p-4 text-left text-white ring-1 ring-navy-900 hover:to-plum-800 sm:p-5"
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-500">
          <Gift className="size-6" aria-hidden="true" strokeWidth={2.25} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg font-extrabold">Spin and win{rewards.mode === "test" ? " (test)" : ""}</span>
          <span className="block text-sm text-white/80">{spinNote(rewards)}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 rounded-xl bg-white px-3 py-2 text-sm font-bold text-navy-900 sm:inline-flex">
          {rewards.enabled ? "Spin now" : "Open"} <ChevronRight className="size-4" aria-hidden="true" />
        </span>
        <ChevronRight className="size-5 shrink-0 sm:hidden" aria-hidden="true" />
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="spin-title"
        onClose={() => setOpen(false)}
        className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-navy-950 p-0 text-white backdrop:bg-black/90"
      >
        {open ? (
          <div className="flex h-full flex-col bg-[radial-gradient(ellipse_at_top,#1d1f6e_0%,#070f4c_45%,#040829_100%)]">
            <header className="flex shrink-0 items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2 sm:px-6">
              <h2 id="spin-title" className="font-display text-xl font-extrabold">
                Spin and win{rewards.mode === "test" ? " (test)" : ""}
              </h2>
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                className="grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="Close"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
              <div className="mx-auto max-w-xl">
                <SpinWheel initial={rewards} onChange={() => router.refresh()} />
                <p className="mt-5 text-center text-xs text-white/50">
                  A BitoCard promotion, {rewards.daily_limit === 1 ? "one spin" : `${rewards.daily_limit} spins`} a day. {rewards.mode === "test" ? "Test stores pay test rewards, which have no value. " : ""}Rewards are spent in the store and cannot be withdrawn.{" "}
                  <a href={appUrl("legals", "/documents/terms")} className="font-semibold text-white/70 underline hover:text-white">
                    Terms apply
                  </a>
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
