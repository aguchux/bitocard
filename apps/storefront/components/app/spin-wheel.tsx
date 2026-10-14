"use client";

import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { formatCrypto, type StoreSpin, type StoreSpinAllowance, type StoreSpinRewards, type StoreSpinSegment, type StoreSpinWin } from "@bitocard/api-client/storefront";
import { spinWheel } from "@/lib/spin-actions";
import { landingAngle, restingAngle, segmentAt, spinBlocks, usd, wonPercent } from "@/lib/spin";

const navy = "#070f4c";
const pink = "#e8116d";
/** Long, smooth slow-down after a fast start, as a casino wheel. */
const easing = "cubic-bezier(0.12, 0.8, 0.12, 1)";
const spinMs = 5000;
const reducedSpinMs = 600;

const size = 400;
const centre = size / 2;
const radius = 182;

/** A point on the wheel `degrees` clockwise from the top, `r` from the centre. */
function point(degrees: number, r: number) {
  const rad = (degrees * Math.PI) / 180;
  return `${(centre + r * Math.sin(rad)).toFixed(2)} ${(centre - r * Math.cos(rad)).toFixed(2)}`;
}

const nextTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const winDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Whether the customer can spin now. */
function canSpin(enabled: boolean, allowance: StoreSpinAllowance | null) {
  return enabled && (!allowance || (!allowance.finished && allowance.spins_left > 0 && allowance.today_left > 0));
}

/** The wheel's face: one wedge per segment, alternating navy and pink, each with its value and coin. */
function WheelFace({ segments }: { segments: StoreSpinSegment[] }) {
  const width = 360 / segments.length;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="block size-full" aria-hidden="true">
      <circle cx={centre} cy={centre} r={198} fill={navy} />
      {segments.map((segment, i) => {
        const start = i * width;
        const end = start + width;
        const mid = start + width / 2;
        return (
          <g key={segment.index}>
            <path d={`M ${centre} ${centre} L ${point(start, radius)} A ${radius} ${radius} 0 0 1 ${point(end, radius)} Z`} fill={i % 2 ? pink : navy} stroke="#ffffff" strokeOpacity={0.55} strokeWidth={1.5} />
            <g transform={`rotate(${mid} ${centre} ${centre})`}>
              <text x={centre} y={centre - radius * 0.76} textAnchor="middle" dominantBaseline="middle" fill="#ffffff" fontSize={21} fontWeight={800} fontFamily="Arial, Helvetica, sans-serif">
                {usd(segment.usd)}
              </text>
              <rect x={centre - 22} y={centre - radius * 0.57 - 10} width={44} height={20} rx={10} fill="#ffffff" fillOpacity={i % 2 ? 0.95 : 0.16} />
              <text x={centre} y={centre - radius * 0.57} textAnchor="middle" dominantBaseline="middle" fill={i % 2 ? pink : "#ffffff"} fontSize={11} fontWeight={800} fontFamily="Arial, Helvetica, sans-serif">
                {segment.asset}
              </text>
            </g>
          </g>
        );
      })}
      {/* The rim's lights. */}
      {Array.from({ length: 24 }, (_, i) => {
        const [x, y] = point(i * 15 + 7.5, 191).split(" ");
        return <circle key={i} cx={x} cy={y} r={3.2} fill={i % 2 ? "#ff8fc0" : "#ffffff"} />;
      })}
      <circle cx={centre} cy={centre} r={radius} fill="none" stroke="#ffffff" strokeOpacity={0.8} strokeWidth={2} />
    </svg>
  );
}

/** A small burst of dots from the centre when the wheel lands (CSS only; none with reduced motion). */
function Burst() {
  return (
    <span className="spin-burst" aria-hidden="true">
      {Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2;
        const distance = 120 + (i % 3) * 30;
        return (
          <span
            key={i}
            style={{ "--x": `${Math.round(Math.cos(angle) * distance)}px`, "--y": `${Math.round(Math.sin(angle) * distance)}px`, background: i % 2 ? "#ff2382" : "#ffd23f", animationDelay: `${(i % 4) * 40}ms` } as CSSProperties}
          />
        );
      })}
    </span>
  );
}

/**
 * Spin and win. The server decides each spin's outcome and pays it at once; the wheel only shows it: it waits for the
 * answer (the hub shows it is working), then turns 6 to 8 full turns and slows to a stop with the pointer inside the
 * won segment, never before. The angle only ever grows, so the wheel never snaps back between spins.
 */
export function SpinWheel({ initial }: { initial: StoreSpinRewards }) {
  const segments = [...initial.segments].sort((a, b) => a.index - b.index);
  const count = segments.length;
  const [allowance, setAllowance] = useState<StoreSpinAllowance | null>(initial.allowance);
  const [recent, setRecent] = useState<StoreSpinWin[]>(initial.recent);
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
  }

  /** The pointer flicks each time a segment line passes under it, so the ticks slow down with the wheel. */
  function tick(previous: number) {
    const el = wheel.current;
    const current = landing.current;
    if (!el || !current) return;
    const matrix = getComputedStyle(el).transform;
    const values = /matrix\(([^)]+)\)/.exec(matrix)?.[1].split(",").map(Number);
    let under = previous;
    if (values && values.length >= 2) {
      under = segmentAt((Math.atan2(values[1], values[0]) * 180) / Math.PI, count);
      if (under !== previous && previous !== -1) pointer.current?.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(-16deg)" }, { transform: "rotate(0deg)" }], { duration: 110, easing: "ease-out" });
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
  const block = blocked ? spinBlocks[blocked] : null;
  const total = allowance?.total_usd ?? "1.00";
  const won = allowance?.won_usd ?? "0.00";

  return (
    <div className="space-y-5">
      <section aria-labelledby="wheel" className="overflow-hidden rounded-3xl bg-gradient-to-b from-[#070f4c] to-[#1a1f6b] p-4 text-white sm:p-6">
        <h2 id="wheel" className="sr-only">
          The wheel
        </h2>
        <div className="relative mx-auto w-full max-w-[420px]">
          {/* The fixed pointer at the top. */}
          <div ref={pointer} className="absolute top-[-6px] left-1/2 z-10 -ml-[18px] origin-[50%_20%]" aria-hidden="true">
            <svg width="36" height="46" viewBox="0 0 36 46">
              <path d="M18 44 L3 10 A15 15 0 1 1 33 10 Z" fill="#ff2382" stroke="#ffffff" strokeWidth="3" strokeLinejoin="round" />
              <circle cx="18" cy="14" r="5" fill="#ffffff" />
            </svg>
          </div>
          <div className="relative aspect-square w-full">
            <div
              ref={wheel}
              className="size-full rounded-full shadow-[0_18px_50px_rgba(0,0,0,0.35)] will-change-transform"
              style={{ transform: `rotate(${angle}deg)`, transition: duration ? `transform ${duration}ms ${easing}` : undefined }}
              onTransitionEnd={event => {
                if (event.target === wheel.current && event.propertyName === "transform") land();
              }}
            >
              {count ? <WheelFace segments={segments} /> : null}
            </div>
            {/* The hub stays still while the wheel turns under it. */}
            <div className="absolute inset-0 grid place-items-center">
              {enabled ? (
                <button
                  type="button"
                  onClick={spin}
                  disabled={busy || !ready}
                  aria-busy={busy}
                  className="grid size-[26%] place-items-center rounded-full bg-white text-lg font-extrabold text-[#070f4c] shadow-lg ring-4 ring-[#ff2382] transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-90 disabled:hover:scale-100 sm:text-xl"
                >
                  {phase === "pending" ? <Loader2 className="size-7 animate-spin text-[#ff2382]" aria-label="Spinning" /> : phase === "spinning" ? <span aria-label="Spinning">…</span> : "Spin"}
                </button>
              ) : (
                <span className="grid size-[26%] place-items-center rounded-full bg-white text-[#070f4c] shadow-lg ring-4 ring-slate-300">
                  <Lock className="size-7" aria-label="Closed" />
                </span>
              )}
            </div>
            {win && phase === "idle" ? <Burst key={win.id} /> : null}
          </div>
        </div>

        <div className="mt-4 min-h-14 text-center" aria-live="polite">
          {win && phase === "idle" ? (
            <p key={win.id} className="spin-pop inline-block rounded-2xl bg-white px-4 py-2.5 font-display text-lg font-extrabold text-[#070f4c]">
              You won {formatCrypto(win.amount, win.asset)} ({usd(win.usd)})
            </p>
          ) : phase === "pending" ? (
            <p className="py-2.5 text-white/80">Spinning…</p>
          ) : phase === "spinning" ? (
            <p className="py-2.5 text-white/80">Good luck…</p>
          ) : ready ? (
            <p className="py-2.5 text-white/80">Tap Spin to play.</p>
          ) : allowance?.finished ? (
            <p className="py-2.5 font-semibold">You have collected your whole {usd(total)}. Thank you for playing.</p>
          ) : enabled && allowance && allowance.today_left === 0 ? (
            <p className="py-2.5 font-semibold">
              That is today&apos;s spins done.
              {allowance.next_spin_at ? (
                <span suppressHydrationWarning>{` Spin again from ${nextTime(allowance.next_spin_at)}.`}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      </section>

      {error && !(error.code && spinBlocks[error.code]) ? (
        <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-900 ring-1 ring-red-200">
          {error.message}
          {error.code === "spin_limit_today" && allowance?.next_spin_at ? <span suppressHydrationWarning>{` You can spin again from ${nextTime(allowance.next_spin_at)}.`}</span> : null}
        </p>
      ) : null}

      {block ? (
        <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/70" role={error ? "alert" : undefined}>
          <p className="font-semibold">{block.title}</p>
          <p className="mt-1 text-sm text-slate-600">{block.text}</p>
          {block.link ? (
            <Link href={block.link.href} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#ff2382] px-4 font-semibold text-white hover:bg-[#e8116d]">
              {block.link.label}
            </Link>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="progress" className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/70">
        <h2 id="progress" className="text-lg font-bold">
          Your {usd(total)}
        </h2>
        <div className="mt-3 flex items-baseline justify-between gap-3 text-sm">
          <span className="font-semibold">{usd(won)} won</span>
          <span className="text-slate-500">of {usd(total)}</span>
        </div>
        <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Won so far" aria-valuemin={0} aria-valuemax={Number(total)} aria-valuenow={Number(won)} aria-valuetext={`${usd(won)} of ${usd(total)}`}>
          <div className="h-full origin-left rounded-full bg-gradient-to-r from-[#ff2382] to-[#e8116d] transition-transform duration-700 ease-out" style={{ transform: `scaleX(${wonPercent(won, total) / 100})` }} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 p-3">
            <dt className="text-xs text-slate-500">Spins used</dt>
            <dd className="font-bold">{allowance ? `${allowance.spins_used} of ${allowance.spins_total}` : "0 of 50–100"}</dd>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3">
            <dt className="text-xs text-slate-500">Left today</dt>
            <dd className="font-bold">{allowance ? `${allowance.today_left} of ${allowance.daily_limit}` : "5 a day"}</dd>
          </div>
          <div className="col-span-2 rounded-2xl bg-slate-50 p-3 sm:col-span-1">
            <dt className="text-xs text-slate-500">Next spin</dt>
            <dd className="font-bold" suppressHydrationWarning>
              {allowance?.finished ? "All done" : allowance?.next_spin_at && allowance.today_left === 0 ? nextTime(allowance.next_spin_at) : ready ? "Now" : "—"}
            </dd>
          </div>
        </dl>
        {!allowance ? <p className="mt-3 text-xs text-slate-500">Your $1 is shared over 50 to 100 spins, set when you first spin. Each spin wins between $0.01 and $0.10.</p> : null}
      </section>

      <section aria-labelledby="wins" className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/70">
        <h2 id="wins" className="mb-1 text-lg font-bold">
          Your wins
        </h2>
        {recent.length ? (
          <ul className="divide-y divide-slate-100">
            {recent.map(item => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-pink-50 text-xs font-extrabold text-[#e8116d]">#{item.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{formatCrypto(item.amount, item.asset)}</span>
                  <span className="block truncate text-sm text-slate-500" suppressHydrationWarning>
                    Spin {item.number} · {winDate(item.created_at)}
                  </span>
                </span>
                <span className="shrink-0 font-semibold text-emerald-700">+{usd(item.usd)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-600">Your wins show here.</p>
        )}
      </section>
    </div>
  );
}
