"use client";

import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Loader2, Lock } from "lucide-react";
import { formatCrypto, formatPrice, type StoreSpin, type StoreSpinAllowance, type StoreSpinExchangePreview, type StoreSpinRewardBalance, type StoreSpinRewards, type StoreSpinSegment, type StoreSpinWin } from "@bitocard/api-client/storefront";
import { exchangeRewards, previewExchange, spinRewards, spinWheel } from "@/lib/spin-actions";
import { colors } from "@bitocard/ui/tokens";
import { landingAngle, restingAngle, segmentAt, spinBlocks, usd } from "@/lib/spin";

const navy = colors.navy900;
const pink = colors.brand600;
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
  return enabled && (!allowance || (!allowance.finished && allowance.today_left > 0));
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
        return <circle key={i} cx={x} cy={y} r={3.2} fill={i % 2 ? colors.brand300 : "#ffffff"} />;
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
            style={{ "--x": `${Math.round(Math.cos(angle) * distance)}px`, "--y": `${Math.round(Math.sin(angle) * distance)}px`, background: i % 2 ? colors.brand500 : colors.gold400, animationDelay: `${(i % 4) * 40}ms` } as CSSProperties}
          />
        );
      })}
    </span>
  );
}

/**
 * The customer's rewards and the way to use them: never withdrawn or traded, they are exchanged into the store wallet
 * (their country's currency or US dollars) to buy from the store. The amount is quoted first; exchanging refuses a
 * lower amount than the one shown.
 */
function RewardsPanel({ rewards, onExchanged }: { rewards: StoreSpinRewardBalance; onExchanged: () => void }) {
  const currencies = rewards.exchange_currencies;
  const [quote, setQuote] = useState<StoreSpinExchangePreview | null>(null);
  const [state, setState] = useState<"idle" | "quoting" | "exchanging">("idle");
  const [message, setMessage] = useState<{ tone: "error" | "done"; text: string } | null>(null);
  const has = Number(rewards.usd) > 0;

  async function quoteFor(code: string) {
    setMessage(null);
    setState("quoting");
    const result = await previewExchange(code);
    setState("idle");
    if (result.ok) setQuote(result.data);
    else {
      setQuote(null);
      setMessage({ tone: "error", text: result.message });
    }
  }

  async function exchange() {
    if (!quote) return;
    setState("exchanging");
    const result = await exchangeRewards(quote.currency, quote.amount, crypto.randomUUID());
    setState("idle");
    setQuote(null);
    if (result.ok) {
      setMessage({ tone: "done", text: `${formatPrice(result.data.amount, result.data.currency)} is in your wallet. Spend it on anything in the store.` });
      onExchanged();
    } else setMessage({ tone: "error", text: result.message });
  }

  return (
    <section aria-labelledby="rewards" className="rounded-3xl bg-white/[0.06] p-5 ring-1 ring-white/10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="rewards" className="text-lg font-bold">
          Your rewards
        </h2>
        <span className="font-display text-2xl font-extrabold text-gold-400">{usd(rewards.usd)}</span>
      </div>
      {rewards.coins.length ? (
        <ul className="mt-2 flex flex-wrap gap-2 text-sm">
          {rewards.coins.map(coin => (
            <li key={coin.asset} className="rounded-full bg-white/10 px-3 py-1">
              {formatCrypto(coin.amount, coin.asset)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-white/70">What you win collects here.</p>
      )}
      <p className="mt-3 text-sm text-white/70">Move your rewards into your wallet and spend them in the store. Rewards cannot be withdrawn or sent anywhere else.</p>

      {has ? (
        <div className="mt-4 space-y-3">
          <div role="group" aria-label="Wallet to move them to" className="flex gap-2">
            {currencies.map(code => (
              <button
                key={code}
                type="button"
                onClick={() => quoteFor(code)}
                disabled={state !== "idle"}
                aria-pressed={quote?.currency === code}
                className={`min-h-11 flex-1 rounded-xl px-3 text-sm font-bold ring-1 transition-colors ${quote?.currency === code ? "bg-white text-navy-900 ring-white" : "bg-white/5 text-white ring-white/25 hover:bg-white/10"}`}
              >
                {code === "USD" ? "US dollars" : `${code} wallet`}
              </button>
            ))}
          </div>
          {state === "quoting" ? <p className="text-sm text-white/70">Working out the rate…</p> : null}
          {quote ? (
            <div className="rounded-2xl bg-white p-4 text-navy-900">
              <p className="text-sm text-slate-600">You get</p>
              <p className="font-display text-2xl font-extrabold">{formatPrice(quote.amount, quote.currency)}</p>
              <p className="text-xs text-slate-500">
                {usd(quote.usd)}
                {quote.currency === "USD" ? "" : ` at ${Number(quote.rate).toLocaleString("en-GB", { maximumFractionDigits: 2 })} ${quote.currency} to the dollar`}
              </p>
              <button
                type="button"
                onClick={exchange}
                disabled={state !== "idle"}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 font-bold text-white hover:bg-brand-600 disabled:opacity-70"
              >
                {state === "exchanging" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRightLeft className="size-4" aria-hidden="true" />}
                Move to my wallet
              </button>
            </div>
          ) : state === "idle" && !message ? (
            <p className="text-sm text-white/70">Choose a wallet to see what you get.</p>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-2xl p-3 text-sm ${message.tone === "error" ? "bg-red-500/15 text-red-100 ring-1 ring-red-400/40" : "bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-400/40"}`}>
          {message.text}
          {message.tone === "done" ? (
            <Link href="/account/wallet" className="ml-1 font-semibold underline">
              See my wallet
            </Link>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Spin and win. The server decides each spin's outcome and pays it at once; the wheel only shows it: it waits for the
 * answer (the hub shows it is working), then turns 6 to 8 full turns and slows to a stop with the pointer inside the
 * won segment, never before. The angle only ever grows, so the wheel never snaps back between spins.
 */
export function SpinWheel({ initial, onChange }: { initial: StoreSpinRewards; onChange?: () => void }) {
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
    void refreshRewards();
  }

  /** The rewards as the server holds them now (after a win or an exchange). */
  async function refreshRewards() {
    const now = await spinRewards().catch(() => null);
    if (now) setRewards(now.rewards);
    onChange?.();
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
  return (
    <div className="space-y-5 text-white">
      <section aria-labelledby="wheel" className="overflow-hidden p-1 sm:p-2">
        <h2 id="wheel" className="sr-only">
          The wheel
        </h2>
        <div className="relative mx-auto w-full max-w-[420px]">
          {/* The fixed pointer at the top. */}
          <div ref={pointer} className="absolute top-[-6px] left-1/2 z-10 -ml-[18px] origin-[50%_20%]" aria-hidden="true">
            <svg width="36" height="46" viewBox="0 0 36 46">
              <path d="M18 44 L3 10 A15 15 0 1 1 33 10 Z" fill={colors.brand500} stroke="#ffffff" strokeWidth="3" strokeLinejoin="round" />
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
                  className="grid size-[26%] place-items-center rounded-full bg-white text-lg font-extrabold text-navy-900 shadow-lg ring-4 ring-brand-500 transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-90 disabled:hover:scale-100 sm:text-xl"
                >
                  {phase === "pending" ? <Loader2 className="size-7 animate-spin text-brand-500" aria-label="Spinning" /> : phase === "spinning" ? <span aria-label="Spinning">…</span> : "Spin"}
                </button>
              ) : (
                <span className="grid size-[26%] place-items-center rounded-full bg-white text-navy-900 shadow-lg ring-4 ring-slate-300">
                  <Lock className="size-7" aria-label="Closed" />
                </span>
              )}
            </div>
            {win && phase === "idle" ? <Burst key={win.id} /> : null}
          </div>
        </div>

        <div className="mt-4 min-h-14 text-center" aria-live="polite">
          {win && phase === "idle" ? (
            <p key={win.id} className="spin-pop inline-block rounded-2xl bg-white px-4 py-2.5 font-display text-lg font-extrabold text-navy-900">
              You won {formatCrypto(win.amount, win.asset)} ({usd(win.usd)})
            </p>
          ) : phase === "pending" ? (
            <p className="py-2.5 text-white/80">Spinning…</p>
          ) : phase === "spinning" ? (
            <p className="py-2.5 text-white/80">Good luck…</p>
          ) : ready ? (
            <p className="py-2.5 text-white/80">Tap Spin to play.</p>
          ) : allowance?.finished ? (
            <p className="py-2.5 font-semibold">You have had all your spins. Thank you for playing.</p>
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
        <p role="alert" className="rounded-2xl bg-red-500/15 p-4 text-sm text-red-100 ring-1 ring-red-400/40">
          {error.message}
          {error.code === "spin_limit_today" && allowance?.next_spin_at ? <span suppressHydrationWarning>{` You can spin again from ${nextTime(allowance.next_spin_at)}.`}</span> : null}
        </p>
      ) : null}

      {block ? (
        <div className="rounded-3xl bg-white/[0.06] p-5 ring-1 ring-white/10" role={error ? "alert" : undefined}>
          <p className="font-semibold">{block.title}</p>
          <p className="mt-1 text-sm text-white/70">{block.text}</p>
          {block.link ? (
            <Link href={block.link.href} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
              {block.link.label}
            </Link>
          ) : null}
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10">
          <dt className="text-xs text-white/60">Won so far</dt>
          <dd className="font-display text-lg font-extrabold">{usd(allowance?.won_usd ?? "0.00")}</dd>
        </div>
        <div className="rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10">
          <dt className="text-xs text-white/60">Spins today</dt>
          <dd className="font-display text-lg font-extrabold" suppressHydrationWarning>
            {allowance?.finished ? "All done" : allowance ? `${allowance.today_left} left` : `${initial.daily_limit} a day`}
          </dd>
        </div>
      </dl>

      <RewardsPanel rewards={rewards} onExchanged={refreshRewards} />

      <section aria-labelledby="wins" className="rounded-3xl bg-white/[0.06] p-5 ring-1 ring-white/10">
        <h2 id="wins" className="mb-1 text-lg font-bold">
          Your wins
        </h2>
        {recent.length ? (
          <ul className="divide-y divide-white/10">
            {recent.map(item => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-500/20 text-xs font-extrabold text-brand-300">#{item.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{formatCrypto(item.amount, item.asset)}</span>
                  <span className="block truncate text-sm text-white/60" suppressHydrationWarning>
                    Spin {item.number} · {winDate(item.created_at)}
                  </span>
                </span>
                <span className="shrink-0 font-semibold text-emerald-300">+{usd(item.usd)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-white/70">Your wins show here.</p>
        )}
      </section>
    </div>
  );
}
