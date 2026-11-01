"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ShopPresence } from "@bitocard/api-client/classifieds";
import { type ApiAnswer, CallEngine, type CallTarget, type CallView } from "@/lib/call-engine";
import { CallPanel } from "./call-panel";
import { useRinger } from "./ringer";

type Calls = { available: boolean; busy: boolean; start: (target: CallTarget) => void };

const CallsContext = createContext<Calls | null>(null);

/** Calls, where this page has them (signed in on udozo.com): null on a store, or signed out. */
export const useCalls = () => useContext(CallsContext);

/** How often an open page says the customer is here and hears of a call: often while seen, less in the background. */
const presenceMs = 5000;
const hiddenPresenceMs = 20_000;

async function callApi<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiAnswer<T>> {
  try {
    const res = await fetch(`/api/calls/${path}`, { method, cache: "no-store", headers: body !== undefined ? { "content-type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : method === "POST" ? "{}" : undefined });
    const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, status: res.status, message: json?.error?.message ?? "The call could not be made. Try again." };
  } catch {
    return { ok: false, status: 0, message: "We could not reach Udozo. Check your connection and try again." };
  }
}

/**
 * Calls between buyers and sellers, once on every udozo.com page of a signed-in customer (in the root layout, so a call
 * carries on from page to page): it tells Udozo the customer is here every few seconds, rings when a buyer calls, and
 * shows the call panel. Calls go through Cloudflare's relay only, so neither side learns the other's number or address.
 */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<CallView>({ phase: "idle", call: null, message: null, muted: false, connectedAt: null });
  const [available, setAvailable] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const engine = useRef<CallEngine | null>(null);

  useEffect(() => {
    const created = new CallEngine({
      api: callApi,
      // No mediaDevices at all (an old browser, or a page not on https): this browser cannot call.
      microphone: () => (navigator.mediaDevices?.getUserMedia ? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }) : Promise.reject(new TypeError("no microphone access"))),
      peer: config => new RTCPeerConnection(config),
      onView: setView,
      onRemote: stream => {
        if (!audio.current) return;
        audio.current.srcObject = stream;
        if (stream) void audio.current.play().catch(() => undefined);
      },
      later: (fn, ms) => window.setTimeout(fn, ms),
      cancel: handle => window.clearTimeout(handle as number),
      now: () => Date.now(),
    });
    engine.current = created;
    let stopped = false;
    let timer = 0;
    const beat = async () => {
      const result = await callApi<ShopPresence>("POST", "presence");
      if (stopped) return;
      // Signed out (or a store's page): nothing more to say.
      if (!result.ok && (result.status === 401 || result.status === 403 || result.status === 404)) return;
      if (result.ok) {
        setAvailable(result.data.calls);
        if (result.data.incoming) created.ring(result.data.incoming);
      }
      timer = window.setTimeout(() => void beat(), document.visibilityState === "visible" ? presenceMs : hiddenPresenceMs);
    };
    void beat();
    // Coming back to the tab says so at once.
    const seen = () => {
      if (document.visibilityState !== "visible" || stopped) return;
      window.clearTimeout(timer);
      void beat();
    };
    document.addEventListener("visibilitychange", seen);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", seen);
      engine.current = null;
    };
  }, []);

  useRinger(view.phase === "incoming" ? "incoming" : view.phase === "ringing" ? "ringback" : null);

  const start = useCallback((target: CallTarget) => void engine.current?.call(target), []);
  const retryMicrophone = useCallback(() => void engine.current?.retryMicrophone(), []);
  const busy = view.phase !== "idle" && view.phase !== "ended";
  const value = useMemo(() => ({ available, busy, start }), [available, busy, start]);

  return (
    <CallsContext.Provider value={value}>
      {children}
      {/* The other side's voice. */}
      <audio ref={audio} autoPlay playsInline className="hidden" />
      <CallPanel view={view} onAnswer={() => void engine.current?.answer()} onHangUp={() => void engine.current?.hangUp()} onMute={() => engine.current?.toggleMute()} onClose={() => engine.current?.dismiss()} onRetry={retryMicrophone} />
    </CallsContext.Provider>
  );
}
