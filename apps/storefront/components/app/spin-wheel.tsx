"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { History, Loader2, Lock, Sparkles } from "lucide-react";
import { formatCrypto, type StoreSpin, type StoreSpinAllowance, type StoreSpinRewardBalance, type StoreSpinRewards, type StoreSpinWin } from "@bitocard/api-client/storefront";
import { CoinBurst, Confetti, WinPlaque } from "@/components/app/spin/celebration";
import { CoinToken } from "@/components/app/spin/coin-token";
import { RewardsPanel } from "@/components/app/spin/rewards-panel";
import styles from "@/components/app/spin/spin.module.css";
import type { SpinSound } from "@/components/app/spin/use-spin-sound";
import { Pointer, WheelDisc, WheelFrame } from "@/components/app/spin/wheel";
import { spinRewards, spinWheel } from "@/lib/spin-actions";
import { landingAngle, restingAngle, segmentAt, spinBlocks, todayLights, usd } from "@/lib/spin";

/** Long, smooth slow-down after a fast start, as a casino wheel. */
const easing = "cubic-bezier(0.12, 0.8, 0.12, 1)";
const spinMs = 5000;
const reducedSpinMs = 600;

const nextTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const winDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Whether the customer can spin now. */
function canSpin(enabled: boolean, allowance: StoreSpinAllowance | null) {
  return enabled && (!allowance || (!allowance.finished && allowance.today_left > 0));
}

/** Today's spins as a row of bulbs, lit for each still to spin. */
function TodayLights({ lit, total }: { lit: number; total: number }) {
  return (
    <span className="flex flex-wrap gap-1.5" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < lit ? `${styles.light} ${styles.lightOn}` : styles.light} />
      ))}
    </span>
  );
}

/**
 * Spin and win. The server decides each spin's outcome and pays it at once; the wheel only shows it: it waits for the
 * answer (the hub shows it is working, the bulbs chase), then turns 6 to 8 full turns and slows to a stop with the
 * pointer inside the won segment, never before; only then do the wedge light up, the coins and confetti fly and the
 * prize count up. The angle only ever grows, so the wheel never snaps back between spins. `sound` clicks at each peg
 * and plays the landing (when the customer has turned it on).
 */
export function SpinWheel({ initial, onChange, sound }: { initial: StoreSpinRewards; onChange?: () => void; sound?: Pick<SpinSound, "tick" | "win"> }) {
  const segments = [...initial.segments].sort((a, b) => a.index - b.index);
  const count = segments.length;
  const [allowance, setAllowance] = useState<StoreSpinAllowance | null>(initial.allowance);
  const [recent, setRecent] = useState<StoreSpinWin[]>(initial.recent);
  const [rewards, setRewards] = useState<StoreSpinRewardBalance>(initial.rewards);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [blocked, setBlocked] = useState<string | null>(initial.enabled ? null : (initial.reason ?? "not_enabled"));
  const [angle, setAngle] = useState(() => restingAngle(count || 12));
  const [duration, setDuration] = useState(0);
  const [phase, setPhase] = useState<"idle" | "pending" | "spinning">("idle");
  const [win, setWin] = useState<StoreSpin | null>(null);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);

  const wheel = useRef<HTMLDivElement>(null);
  const pointer = useRef<HTMLDivElement>(null);
  const angleRef = useRef(angle);
  const landing = useRef<{ spin: StoreSpin; timer: number; frame: number } | null>(null);

  useEffect(
    () => () => {
      if (landing.current) {
        window.clearTimeout(landing.current.timer);
        window.cancelAnimationFrame(landing.current.frame);
      }
    },
    [],
  );

  /** The wheel has stopped: only now is the win shown and the figures moved on. */
  function land() {
    const done = landing.current;
    if (!done) return;
    landing.current = null;
    window.clearTimeout(done.timer);
    window.cancelAnimationFrame(done.frame);
    const { spin } = done;
    setAllowance(spin.allowance);
    setRecent(list => [{ id: spin.id, number: spin.number, asset: spin.asset, amount: spin.amount, usd: spin.usd, segment: spin.segment, created_at: new Date().toISOString() }, ...list.filter(item => item.id !== spin.id)].slice(0, 10));
    setWin(spin);
    setPhase("idle");
    sound?.win();
    void refreshRewards();
  }

  /** The rewards as the server holds them now (after a win or an exchange). */
  async function refreshRewards() {
    const now = await spinRewards().catch(() => null);
    if (now) setRewards(now.rewards);
    onChange?.();
  }

  /** The pointer flicks (and clicks) each time a peg passes under it, so the ticks slow down with the wheel. */
  function tick(previous: number) {
    const el = wheel.current;
    const current = landing.current;
    if (!el || !current) return;
    const matrix = getComputedStyle(el).transform;
    const values = /matrix\(([^)]+)\)/.exec(matrix)?.[1].split(",").map(Number);
    let under = previous;
    if (values && values.length >= 2) {
      under = segmentAt((Math.atan2(values[1], values[0]) * 180) / Math.PI, count);
      if (under !== previous && previous !== -1) {
        pointer.current?.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(-18deg)" }, { transform: "rotate(0deg)" }], { duration: 120, easing: "ease-out" });
        sound?.tick();
      }
    }
    current.frame = window.requestAnimationFrame(() => tick(under));
  }

  async function spin() {
    if (phase !== "idle" || !canSpin(enabled, allowance) || !count) return;
    setPhase("pending");
    setError(null);
    setWin(null);
    let result;
    try {
      result = await spinWheel(crypto.randomUUID());
    } catch {
      result = { ok: false as const, code: null, message: "We could not reach the store. Try again shortly." };
    }
    // A redirect (signed out) leaves nothing to show.
    if (!result) {
      setPhase("idle");
      return;
    }
    if (!result.ok) {
      if (result.allowance) setAllowance(result.allowance);
      if (result.code && spinBlocks[result.code]) {
        setEnabled(false);
        setBlocked(result.code);
      }
      setError({ code: result.code, message: result.message });
      setPhase("idle");
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const turns = reduced ? 1 : 6 + Math.floor(Math.random() * 3);
    const ms = reduced ? reducedSpinMs : spinMs;
    const next = landingAngle({ current: angleRef.current, segment: result.spin.segment, count, turns, offset: (Math.random() - 0.5) * 0.7 });
    angleRef.current = next;
    // Should the transition's end never arrive (a background tab), the wheel still lands.
    landing.current = { spin: result.spin, timer: window.setTimeout(land, ms + 400), frame: 0 };
    setDuration(ms);
    setAngle(next);
    setPhase("spinning");
    if (!reduced) landing.current.frame = window.requestAnimationFrame(() => tick(-1));
  }

  const ready = canSpin(enabled, allowance);
  const busy = phase !== "idle";
  const won = !busy && win ? win : null;
  const stage = busy ? phase : won ? "won" : "idle";
  const block = blocked ? spinBlocks[blocked] : null;
  const lights = todayLights(allowance, initial.daily_limit);

  return (
    <div className="grid gap-6 text-white lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start lg:gap-12">
      <section aria-labelledby="wheel" className="lg:sticky lg:top-2">
        <h2 id="wheel" className="sr-only">
          The wheel
        </h2>
        <div className="mx-auto w-full max-w-[500px] px-3 pt-4 sm:px-6">
          <div className={styles.stage} data-phase={stage}>
            <span className={styles.halo} aria-hidden="true" />
            <WheelFrame />
            <div
              ref={wheel}
              className={styles.disc}
              style={{ transform: `rotate(${angle}deg)`, transition: duration ? `transform ${duration}ms ${easing}` : undefined }}
              onTransitionEnd={event => {
                if (event.target === wheel.current && event.propertyName === "transform") land();
              }}
            >
              {count ? <WheelDisc segments={segments} won={won ? won.segment : null} /> : null}
            </div>
            <span className={styles.sheen} aria-hidden="true" />
            <Pointer ref={pointer} />
            {/* The hub stays still while the wheel turns under it. */}
            {enabled ? (
              <button type="button" onClick={spin} disabled={busy || !ready} aria-busy={busy} data-ready={ready && !busy ? "" : undefined} className={styles.hub}>
                <span className={`${styles.hubFace} font-display text-base font-black tracking-[0.12em] uppercase sm:text-xl`}>
                  {phase === "pending" ? <Loader2 className="size-7 animate-spin" aria-label="Spinning" /> : phase === "spinning" ? <Sparkles className="size-7" aria-label="Spinning" /> : "Spin"}
                </span>
              </button>
            ) : (
              <span className={styles.hub}>
                <span className={styles.hubFace}>
                  <Lock className="size-7 text-white/80" aria-label="Closed" />
                </span>
              </span>
            )}
            {won ? <CoinBurst key={won.id} /> : null}
          </div>
        </div>
        {won ? <Confetti key={`confetti-${won.id}`} /> : null}

        <div className="mt-6 flex min-h-24 items-center justify-center text-center" aria-live="polite">
          {won ? (
            <WinPlaque key={won.id} win={won} />
          ) : phase === "pending" ? (
            <p className={`${styles.status} text-white/85`}>Spinning…</p>
          ) : phase === "spinning" ? (
            <p className={`${styles.status} text-white/85`}>
              <Sparkles className="size-4 text-gold-400" aria-hidden="true" />
              Good luck…
            </p>
          ) : ready ? (
            <p className={`${styles.status} text-white/85`}>Tap Spin to play.</p>
          ) : allowance?.finished ? (
            <p className={`${styles.status} font-semibold`}>You have had all your spins. Thank you for playing.</p>
          ) : enabled && allowance && allowance.today_left === 0 ? (
            <p className={`${styles.status} font-semibold`}>
              That is today&apos;s spins done.
              {allowance.next_spin_at ? <span suppressHydrationWarning>{` Spin again from ${nextTime(allowance.next_spin_at)}.`}</span> : null}
            </p>
          ) : null}
        </div>

        <dl className="mx-auto mt-5 grid max-w-[500px] grid-cols-2 gap-3">
          <div className={`${styles.panel} p-4`}>
            <dt className="text-[11px] font-semibold tracking-[0.16em] text-white/55 uppercase">Won so far</dt>
            <dd className={`mt-1 font-display text-2xl font-black tabular-nums ${styles.goldText}`}>{usd(allowance?.won_usd ?? "0.00")}</dd>
          </div>
          <div className={`${styles.panel} p-4`}>
            <dt className="text-[11px] font-semibold tracking-[0.16em] text-white/55 uppercase">Spins today</dt>
            <dd className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <TodayLights lit={lights.lit} total={lights.total} />
              <span className="text-sm font-bold" suppressHydrationWarning>
                {allowance?.finished ? "All done" : allowance ? `${allowance.today_left} left` : `${initial.daily_limit} a day`}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      <div className="space-y-5">
        {error && !(error.code && spinBlocks[error.code]) ? (
          <p role="alert" className="rounded-2xl bg-red-500/15 p-4 text-sm text-red-100 ring-1 ring-red-400/40">
            {error.message}
            {error.code === "spin_limit_today" && allowance?.next_spin_at ? <span suppressHydrationWarning>{` You can spin again from ${nextTime(allowance.next_spin_at)}.`}</span> : null}
          </p>
        ) : null}

        {block ? (
          <div className={`${styles.panel} p-5`} role={error ? "alert" : undefined}>
            <p className="flex items-center gap-2 font-semibold">
              <Lock className="size-4 text-gold-400" aria-hidden="true" />
              {block.title}
            </p>
            <p className="mt-1 text-sm text-white/70">{block.text}</p>
            {block.link ? (
              <Link href={block.link.href} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
                {block.link.label}
              </Link>
            ) : null}
          </div>
        ) : null}

        <RewardsPanel rewards={rewards} onExchanged={refreshRewards} />

        <section aria-labelledby="wins" className={`${styles.panel} p-5 sm:p-6`}>
          <h2 id="wins" className="mb-1 flex items-center gap-2 text-lg font-bold">
            <History className="size-5 text-gold-400" aria-hidden="true" />
            Your wins
          </h2>
          {recent.length ? (
            <ul className="divide-y divide-white/10">
              {recent.map(item => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <CoinToken asset={item.asset} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{formatCrypto(item.amount, item.asset)}</span>
                    <span className="block truncate text-sm text-white/55" suppressHydrationWarning>
                      Spin {item.number} · {winDate(item.created_at)}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-emerald-400/10 px-2.5 py-1 text-sm font-bold text-emerald-300 tabular-nums ring-1 ring-emerald-400/25">+{usd(item.usd)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-white/65">Your wins show here.</p>
          )}
        </section>
      </div>
    </div>
  );
}
