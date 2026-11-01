"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, ShieldCheck, X } from "lucide-react";
import type { CallView } from "@/lib/call-engine";

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
 * The call, in a panel over the page (bottom right on desktops, across the bottom on phones) that stays while the
 * person browses: who it is with (their public name only), the listing, the state or the time, and Answer and Decline,
 * or Mute and End. Nobody's number is ever shown.
 */
export function CallPanel({ view, onAnswer, onHangUp, onMute, onClose }: { view: CallView; onAnswer: () => void; onHangUp: () => void; onMute: () => void; onClose: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (view.phase !== "connected") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [view.phase]);
  if (view.phase === "idle") return null;
  const name = view.call?.with.name ?? (view.phase === "starting" ? "The seller" : "");
  const round = "grid size-14 place-items-center rounded-full text-white disabled:opacity-60";
  return (
    <section
      role="dialog"
      aria-label={view.phase === "incoming" ? `Incoming call from ${name}` : `Call with ${name}`}
      className="fixed inset-x-3 bottom-3 z-50 grid gap-4 rounded-3xl bg-navy-900 p-5 text-white shadow-2xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-80"
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
      {view.phase === "incoming" ? (
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
