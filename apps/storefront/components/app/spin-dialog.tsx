"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Volume2, VolumeX, X } from "lucide-react";
import type { StoreSpinRewards } from "@bitocard/api-client/storefront";
import { appUrl } from "@bitocard/ui/site";
import { SpinWheel } from "@/components/app/spin-wheel";
import styles from "@/components/app/spin/spin.module.css";
import { useSpinSound } from "@/components/app/spin/use-spin-sound";
import { usd } from "@/lib/spin";

/** What the card on Home says: what is won so far and today's spins, never a total. */
export function spinNote(rewards: StoreSpinRewards) {
  const allowance = rewards.allowance;
  if (!allowance) return "Spin the wheel and win dollar rewards to spend in the store.";
  const won = `${usd(allowance.won_usd)} won`;
  if (allowance.finished) return Number(rewards.rewards.usd) > 0 ? `${usd(rewards.rewards.usd)} of rewards to move to your wallet` : won;
  return allowance.today_left > 0 && rewards.enabled ? `${won} · ${allowance.today_left} ${allowance.today_left === 1 ? "spin" : "spins"} left today` : `${won} · come back tomorrow`;
}

/**
 * Spin and win over the whole screen: the card on Home (a small wheel turning on a gold-edged card) opens a native
 * modal dialog, a dark casino room from edge to edge, with the wheel beside the rewards and the latest wins on desktops
 * and above them on phones (Escape or the close button shut it). Sound is off until turned on in the header.
 * `/account?spin=1` opens it on arrival (older links and sign-in come back there), then takes `spin` out of the
 * address. A win or an exchange refreshes Home underneath, so the wallet's figure is right when the dialog closes.
 */
export function SpinDialog({ rewards, open: openOnArrival = false }: { rewards: StoreSpinRewards; open?: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(openOnArrival);
  const sound = useSpinSound();
  const test = rewards.mode === "test";

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
      <button type="button" onClick={show} className={`${styles.launch} flex w-full items-center gap-4 rounded-3xl p-4 text-left text-white sm:p-5`}>
        <span className={styles.miniWheel} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-display text-lg font-extrabold">
            Spin and win
            {test ? <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-[11px] font-bold text-amber-200 ring-1 ring-amber-300/40">Test</span> : null}
          </span>
          <span className="block text-sm text-white/80">{spinNote(rewards)}</span>
        </span>
        <span className={`${styles.launchCta} hidden shrink-0 items-center gap-1 rounded-xl px-3.5 py-2 text-sm font-extrabold sm:inline-flex`}>
          {rewards.enabled ? "Spin now" : "Open"} <ChevronRight className="size-4" aria-hidden="true" />
        </span>
        <ChevronRight className="size-5 shrink-0 text-gold-400 sm:hidden" aria-hidden="true" />
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="spin-title"
        onClose={() => setOpen(false)}
        className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-navy-950 p-0 text-white backdrop:bg-black/90"
      >
        {open ? (
          <div className={`${styles.backdrop} ${styles.enter} flex h-full flex-col`}>
            <header className="flex shrink-0 items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2 sm:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <span className={`${styles.miniWheel} hidden sm:block`} aria-hidden="true" />
                <div className="min-w-0">
                  <h2 id="spin-title" className={`font-display text-2xl leading-tight font-black tracking-tight sm:text-3xl ${styles.goldText}`}>
                    Spin and win{test ? <span className="sr-only"> (test)</span> : null}
                  </h2>
                  <p className="truncate text-[11px] font-semibold tracking-[0.2em] text-white/55 uppercase">
                    Crypto rewards · {rewards.daily_limit === 1 ? "one spin" : `${rewards.daily_limit} spins`} a day
                  </p>
                </div>
                {test ? <span className="shrink-0 rounded-full bg-amber-300/15 px-2.5 py-1 text-xs font-bold text-amber-200 ring-1 ring-amber-300/40" aria-hidden="true">Test</span> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={sound.toggle}
                  aria-pressed={sound.on}
                  aria-label="Sound"
                  title={sound.on ? "Sound on" : "Sound off"}
                  className={`grid size-11 place-items-center rounded-full transition-colors ${sound.on ? "bg-gold-400 text-navy-900 hover:bg-gold-200" : "bg-white/10 text-white hover:bg-white/20"}`}
                >
                  {sound.on ? <Volume2 className="size-5" aria-hidden="true" /> : <VolumeX className="size-5" aria-hidden="true" />}
                </button>
                <button type="button" onClick={() => dialog.current?.close()} className="grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Close">
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8">
              <div className="mx-auto max-w-6xl">
                <SpinWheel initial={rewards} onChange={() => router.refresh()} sound={sound} />
                <p className="mx-auto mt-8 max-w-xl text-center text-xs text-white/45">
                  A BitoCard promotion, {rewards.daily_limit === 1 ? "one spin" : `${rewards.daily_limit} spins`} a day. {test ? "Test stores pay test rewards, which have no value. " : ""}Rewards are spent in the store and cannot be withdrawn.{" "}
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
