"use client";

import { Volume2, VolumeX } from "lucide-react";
import type { StorePublicSpinRewards, StoreSpinRewards } from "@bitocard/api-client/storefront";
import { SpinWheel } from "@/components/app/spin-wheel";
import styles from "@/components/app/spin/spin.module.css";
import { useSpinSound } from "@/components/app/spin/use-spin-sound";

/** The indexed Customer Catcher landing page, using the same accessible wheel as the account promotion. */
export function PublicSpinPage({ rewards, visitor }: { rewards: StorePublicSpinRewards | StoreSpinRewards; visitor: boolean }) {
  const sound = useSpinSound();
  return (
    <div className={`${styles.backdrop} -mx-4 min-h-[calc(100svh-8rem)] px-4 py-8 text-white sm:-mx-6 sm:px-8 lg:-mx-8`}>
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-gold-400 uppercase">BitoCard Customer Catcher</p>
            <h1 className={`font-display mt-1 text-4xl font-black tracking-tight sm:text-5xl ${styles.goldText}`}>Spin and win</h1>
            <p className="mt-2 max-w-2xl text-white/70">{visitor ? "Take six free spins. Your wins stay saved in this browser until you create an account and add them to your wallet." : "You are signed in, so these spins use your account's daily Spin and win allowance."}</p>
          </div>
          <button type="button" onClick={sound.toggle} aria-pressed={sound.on} aria-label="Sound" className={`grid size-11 shrink-0 place-items-center rounded-full ${sound.on ? "bg-gold-400 text-navy-900" : "bg-white/10 text-white"}`}>
            {sound.on ? <Volume2 className="size-5" aria-hidden="true" /> : <VolumeX className="size-5" aria-hidden="true" />}
          </button>
        </header>
        <SpinWheel initial={rewards} sound={sound} visitor={visitor} />
        <p className="mx-auto mt-8 max-w-xl text-center text-xs text-white/50">Free entry. Wins are promotional store credit, cannot be withdrawn, and are subject to the Spin and win terms.</p>
      </div>
    </div>
  );
}
