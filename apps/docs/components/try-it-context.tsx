"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** The API, called straight from the browser (never through the docs website). */
export const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.bitocard.com").replace(/\/$/, "");

/** SHQ, where resellers sign in; it sends them back to the page they came from. */
export function shqSignInUrl() {
  const shq = process.env.NEXT_PUBLIC_SHQ_URL ?? (window.location.hostname === "localhost" ? "http://localhost:3004" : "https://shq.bitocard.com");
  return `${shq.replace(/\/$/, "")}/signin?next=${encodeURIComponent(window.location.href)}`;
}

export type Mode = "test" | "live";
type Membership = { role: string; reseller: { id: string; name: string; status: string } };
type Session = { user: { name: string; email: string }; memberships: Membership[] };
type Token = { token: string; expires: number; readOnly: boolean };

type State = {
  status: "checking" | "signed_out" | "signed_in" | "unavailable";
  session: Session | null;
  membership: Membership | null;
  chooseReseller: (id: string) => void;
  mode: Mode;
  setMode: (mode: Mode) => void;
  /** Live only: GET requests only, on by default. */
  readOnly: boolean;
  setReadOnly: (value: boolean) => void;
  /** A "Try it" token for the current account and mode, fetched when needed and kept in memory only. */
  token: () => Promise<Token>;
  refresh: () => void;
};

const TryItContext = createContext<State | null>(null);

export function useTryIt() {
  const state = useContext(TryItContext);
  if (!state) throw new Error("useTryIt must be used inside <TryItProvider>");
  return state;
}

/**
 * Who is signed in to SHQ (its session cookie is shared on .bitocard.com), which account and mode "Try it" uses,
 * and the short-lived tokens. Tokens live only in this tab's memory: never in storage, the address or the docs
 * website. Every visit starts in the sandbox.
 */
export function TryItProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<State["status"]>("checking");
  const [session, setSession] = useState<Session | null>(null);
  const [resellerId, setResellerId] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>("test");
  const [readOnly, setReadOnly] = useState(true);
  const tokens = useRef(new Map<string, Token>());
  const [check, setCheck] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/v1/auth/session`, { credentials: "include", headers: { accept: "application/json" } })
      .then(async response => {
        if (cancelled) return;
        if (response.status === 401) {
          setStatus("signed_out");
          setSession(null);
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as Session;
        setSession(body);
        setResellerId(current => current ?? body.memberships[0]?.reseller.id ?? null);
        setStatus("signed_in");
      })
      .catch(() => !cancelled && setStatus("unavailable"));
    return () => {
      cancelled = true;
    };
  }, [check]);

  const membership = session?.memberships.find(item => item.reseller.id === resellerId) ?? session?.memberships[0] ?? null;

  const setMode = useCallback((next: Mode) => {
    setModeState(next);
    // Live always starts read-only.
    if (next === "live") setReadOnly(true);
  }, []);

  const token = useCallback(async () => {
    if (!membership) throw new Error("Sign in to try the API.");
    const key = `${membership.reseller.id}:${mode}:${mode === "live" && readOnly}`;
    const cached = tokens.current.get(key);
    if (cached && cached.expires - Date.now() > 30_000) return cached;
    const response = await fetch(`${apiUrl}/v1/auth/docs-token`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json", "bitocard-reseller": membership.reseller.id },
      body: JSON.stringify({ mode, read_only: mode === "live" && readOnly }),
    });
    const body = (await response.json().catch(() => null)) as { token?: string; expires_at?: string; read_only?: boolean; error?: { message?: string } } | null;
    if (response.status === 401) {
      setStatus("signed_out");
      setSession(null);
    }
    if (!response.ok || !body?.token) throw new Error(body?.error?.message ?? "Could not start Try it. Try again.");
    const fresh = { token: body.token, expires: Date.parse(body.expires_at ?? "") || Date.now() + 60_000, readOnly: Boolean(body.read_only) };
    tokens.current.set(key, fresh);
    return fresh;
  }, [membership, mode, readOnly]);

  const value = useMemo<State>(
    () => ({
      status,
      session,
      membership,
      chooseReseller: id => setResellerId(id),
      mode,
      setMode,
      readOnly,
      setReadOnly,
      token,
      refresh: () => {
        tokens.current.clear();
        setCheck(count => count + 1);
      },
    }),
    [status, session, membership, mode, setMode, readOnly, token],
  );
  return <TryItContext.Provider value={value}>{children}</TryItContext.Provider>;
}
