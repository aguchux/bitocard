"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, ShieldCheck, X } from "lucide-react";
import type { CallView, MicProblem } from "@/lib/call-engine";
import { RateSellerPrompt } from "../ratings/rate-seller";

/** What the browser says about the microphone for this site: "granted", "prompt", "denied", or unknown (null). */
type MicPermission = "granted" | "prompt" | "denied" | null;

/** What the microphone step says, by what went wrong and what the browser would do if asked again. */
export function micHelp(problem: MicProblem, permission: MicPermission) {
  switch (problem) {
    case "missing":
      return { text: "We could not find a microphone. Plug in a headset or microphone, then try again.", steps: false, action: "Try again" };
    case "in_use":
      return { text: "Another app is using your microphone. Close it (or end the call there), then try again.", steps: false, action: "Try again" };
    case "unsupported":
      return { text: "This browser cannot make calls. Open udozo.com in Chrome, Safari, Edge or Firefox to call.", steps: false, action: null };
    default:
      // Asking again shows the browser's own question, unless it has been told to block this site.
      return permission === "prompt"
        ? { text: "Udozo needs your microphone for the call. Press Allow microphone, then choose Allow when your browser asks.", steps: false, action: "Allow microphone" }
        : { text: "Your browser is blocking the microphone for udozo.com. Allow it, then press Try again:", steps: true, action: "Try again" };
  }
}

/** How to allow the microphone where the browser no longer asks. */
export const allowSteps = [
  { where: "On a computer", how: "click the icon left of the web address (a lock or sliders), set Microphone to Allow." },
  { where: "On iPhone or iPad", how: "tap aA in the address bar, then Website Settings, and set Microphone to Allow." },
  { where: "On Android", how: "tap the icon left of the web address, then Permissions, and turn on Microphone." },
];

/**
 * The browser's microphone permission for this site, kept up to date where the browser tells (Chrome, Edge, Safari;
 * Firefox does not say, so null). Once it turns to granted, `onGranted` tries again by itself.
 */
function useMicPermission(active: boolean, onGranted: () => void) {
  const [permission, setPermission] = useState<MicPermission>(null);
  useEffect(() => {
    if (!active || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    let stopped = false;
    const changed = () => {
      if (!status || stopped) return;
      setPermission(status.state);
      if (status.state === "granted") onGranted();
    };
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then(found => {
        if (stopped) return;
        status = found;
        setPermission(found.state);
        found.addEventListener("change", changed);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      status?.removeEventListener("change", changed);
    };
  }, [active, onGranted]);
  return active ? permission : null;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map(part => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** "4:05" since the call connected. */
export function callTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** What the panel says under the name. */
export function statusText(view: CallView, now: number) {
  switch (view.phase) {
    case "starting":
      return "Starting the call…";
    case "microphone":
      return view.call?.role === "callee" ? "Calling you: allow your microphone to answer" : "Allow your microphone to call";
    case "ringing":
      return "Ringing…";
    case "incoming":
      return "Calling you on Udozo";
    case "connecting":
      return "Connecting…";
    case "connected":
      return callTime(now - (view.connectedAt ?? now));
    case "ended":
      return view.message ?? "Call ended.";
    default:
      return "";
  }
}

/**
 * The call, in a panel over the page (top centre on desktops, across the top on phones, clear of the chats) that stays while the
 * person browses: who it is with (their public name only), the listing, the state or the time, and Answer and Decline,
 * or Mute and End. Nobody's number is ever shown. Without the microphone the call waits on a step saying how to allow
 * it, with Allow microphone (or Try again), and goes on by itself once the browser says it is allowed.
 */
export function CallPanel({
  view,
  onAnswer,
  onHangUp,
  onMute,
  onClose,
  onRetry,
}: {
  view: CallView;
  onAnswer: () => void;
  onHangUp: () => void;
  onMute: () => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (view.phase !== "connected") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [view.phase]);
  const permission = useMicPermission(view.phase === "microphone" && view.microphone === "blocked", onRetry);
  if (view.phase === "idle") return null;
  const name = view.call?.with.name ?? (view.phase === "starting" || view.phase === "microphone" ? "Your call" : "");
  const round = "grid size-14 place-items-center rounded-full text-white disabled:opacity-60";
  const help = view.phase === "microphone" ? micHelp(view.microphone ?? "blocked", permission) : null;
  return (
    <section
      role="dialog"
      aria-label={view.phase === "incoming" ? `Incoming call from ${name}` : `Call with ${name}`}
      className="fixed inset-x-3 top-3 z-50 grid gap-4 rounded-3xl bg-navy-900 p-5 text-white shadow-2xl sm:inset-x-auto sm:top-5 sm:left-1/2 sm:w-96 sm:-translate-x-1/2"
    >
      <div className="flex items-start gap-3">
        <span className={`grid size-12 shrink-0 place-items-center rounded-full bg-white/15 text-lg font-bold ${view.phase === "incoming" ? "animate-pulse" : ""}`} aria-hidden="true">
          {initials(name || "?")}
        </span>
        <div className="grid min-w-0 flex-1">
          <strong className="truncate text-lg">{name}</strong>
          <span className="text-sm text-navy-200" aria-live="polite">
            {statusText(view, now)}
          </span>
          {view.call?.listing ? (
            <Link href={view.call.listing.path} className="truncate text-xs text-navy-200 underline-offset-2 hover:underline">
              About {view.call.listing.title ?? "a listing"}
            </Link>
          ) : null}
        </div>
        {view.phase === "ended" ? (
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full hover:bg-white/10" aria-label="Close">
            <X className="size-5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {view.phase === "ended" && view.call?.listing && view.call.answered_at ? <RateSellerPrompt listingId={view.call.listing.id} seller={view.call.with.name} tone="dark" /> : null}
      {help ? (
        <div className="grid gap-3">
          <div className="flex gap-3 rounded-2xl bg-white/10 p-3.5 text-sm">
            <MicOff className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden="true" />
            <div className="grid gap-2">
              <p>{help.text}</p>
              {help.steps ? (
                <ul className="grid gap-1.5 text-navy-100">
                  {allowSteps.map(step => (
                    <li key={step.where}>
                      <strong className="text-white">{step.where}:</strong> {step.how}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2.5">
            <button type="button" onClick={onHangUp} className="h-11 flex-1 rounded-2xl bg-white/15 px-4 text-sm font-bold hover:bg-white/25">
              {view.call?.role === "callee" ? "Decline" : "Cancel"}
            </button>
            {help.action ? (
              <button type="button" onClick={onRetry} className="flex h-11 flex-[2] items-center justify-center gap-2 rounded-2xl bg-mint-500 px-4 text-sm font-bold hover:bg-mint-700">
                <Mic className="size-4" aria-hidden="true" /> {help.action}
              </button>
            ) : null}
          </div>
        </div>
      ) : view.phase === "incoming" ? (
        <div className="flex justify-around">
          <button type="button" onClick={onHangUp} className={`${round} bg-red-600 hover:bg-red-500`} aria-label="Decline">
            <PhoneOff className="size-6" aria-hidden="true" />
          </button>
          <button type="button" onClick={onAnswer} className={`${round} bg-mint-500 hover:bg-mint-700`} aria-label="Answer">
            <Phone className="size-6" aria-hidden="true" />
          </button>
        </div>
      ) : view.phase === "ended" ? null : (
        <div className="flex justify-around">
          <button type="button" onClick={onMute} disabled={view.phase !== "connected" && view.phase !== "connecting"} aria-pressed={view.muted} className={`${round} bg-white/15 hover:bg-white/25`} aria-label={view.muted ? "Unmute" : "Mute"}>
            {view.muted ? <MicOff className="size-6" aria-hidden="true" /> : <Mic className="size-6" aria-hidden="true" />}
          </button>
          <button type="button" onClick={onHangUp} className={`${round} bg-red-600 hover:bg-red-500`} aria-label={view.phase === "ringing" || view.phase === "starting" ? "Cancel the call" : "End the call"}>
            <PhoneOff className="size-6" aria-hidden="true" />
          </button>
        </div>
      )}
      <p className="flex items-center gap-1.5 text-xs text-navy-200">
        <ShieldCheck className="size-4 shrink-0" aria-hidden="true" /> A private Udozo call: no numbers are shared, and it is not recorded.
      </p>
    </section>
  );
}
