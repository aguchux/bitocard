"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { formatCrypto, type StoreSpin } from "@bitocard/api-client/storefront";
import { colors } from "@bitocard/ui/tokens";
import { usd } from "@/lib/spin";
import { CoinToken } from "./coin-token";
import styles from "./spin.module.css";

const confettiColours = [colors.brand500, colors.gold400, colors.gold200, colors.azure500, colors.mint500, colors.brand300];

/** A spread between 0 and 1 from the piece's index, so confetti renders the same every time (no randomness in render). */
const spread = (i: number, salt: number) => (((i + 1) * 9301 + salt * 49297) % 233280) / 233280;

/** Confetti falling over the whole screen when the wheel lands (none with reduced motion). */
export function Confetti() {
  return (
    <div className={styles.confetti} aria-hidden="true">
      {Array.from({ length: 42 }, (_, i) => (
        <span
          key={i}
          className={i % 3 === 0 ? styles.confettiRound : undefined}
          style={
            {
              "--left": `${(spread(i, 1) * 100).toFixed(1)}%`,
              "--drift": `${Math.round((spread(i, 2) - 0.5) * 180)}px`,
              "--spin": `${Math.round(360 + spread(i, 3) * 900)}deg`,
              "--duration": `${(1.9 + spread(i, 4) * 1.4).toFixed(2)}s`,
              "--delay": `${Math.round(spread(i, 5) * 500)}ms`,
              background: confettiColours[i % confettiColours.length],
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Gold coins flying out of the hub. */
export function CoinBurst() {
  return (
    <span className={styles.burst} aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2 + 0.26;
        const distance = 34 + (i % 3) * 8;
        return (
          <span
            key={i}
            style={
              {
                "--x": `${(Math.cos(angle) * distance).toFixed(1)}cqw`,
                "--y": `${(Math.sin(angle) * distance).toFixed(1)}cqw`,
                "--turn": `${(i % 2 ? 1 : -1) * 180}deg`,
                animationDelay: `${(i % 4) * 45}ms`,
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

/** Counts up to `target` over `ms` with an ease-out (at once with reduced motion). Every update runs in a frame. */
function useCountUp(target: number, ms = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = reduced ? 1 : Math.min(1, (now - start) / ms);
      setValue(target * (1 - (1 - t) ** 3));
      if (t < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

/**
 * The prize plaque once the wheel has stopped: the dollar value counting up and the coin won. Screen readers get the
 * sentence once (the counting figures are hidden from them).
 */
export function WinPlaque({ win }: { win: StoreSpin }) {
  const shown = useCountUp(Number(win.usd));
  return (
    <div className={styles.plaque}>
      <p className="sr-only">
        You won {formatCrypto(win.amount, win.asset)} ({usd(win.usd)})
      </p>
      <span aria-hidden="true" className="text-[11px] font-bold tracking-[0.3em] text-gold-200 uppercase">
        You won
      </span>
      <span aria-hidden="true" className={`font-display text-5xl leading-tight font-black tabular-nums ${styles.goldText}`}>
        {usd(String(shown))}
      </span>
      <span aria-hidden="true" className="mt-0.5 inline-flex items-center gap-2 text-sm font-semibold text-white/85">
        <CoinToken asset={win.asset} size="sm" />
        {formatCrypto(win.amount, win.asset)}
      </span>
    </div>
  );
}
