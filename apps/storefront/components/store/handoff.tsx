"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { continueSignIn, type HandoffResult } from "@/lib/handoff-actions";

/** `#c=<code>&n=<path>` as the code and where to go next. */
export function readHandoffHash(hash: string) {
  const values = new URLSearchParams(hash.replace(/^#/, ""));
  return { code: values.get("c") ?? "", next: values.get("n") ?? "/" };
}

/**
 * Reads the code from the address's fragment, removes it from the address bar at once (so it is not kept in history or
 * shared by mistake), and exchanges it once on this site's server, even if the effect runs twice; then on to `next`.
 */
export function HandoffLanding() {
  const pending = useRef<Promise<HandoffResult> | null>(null);
  const [failed, setFailed] = useState<null | { unreachable: boolean; next: string }>(null);

  useEffect(() => {
    const { code, next } = readHandoffHash(window.location.hash);
    if (!pending.current) {
      window.history.replaceState(null, "", window.location.pathname);
      pending.current = continueSignIn(code, next);
    }
    let live = true;
    void pending.current.then(result => {
      if (!live) return;
      if (result.ok) window.location.replace(result.next);
      else setFailed({ unreachable: result.unreachable, next });
    });
    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    return (
      <section className="rounded-3xl border border-slate-100 bg-white p-6 text-center shadow-sm sm:p-8">
        <h1 className="font-display text-2xl font-extrabold text-navy-900">{failed.unreachable ? "We could not sign you in just now" : "This sign-in link has expired"}</h1>
        <p className="mt-2 text-slate-600">{failed.unreachable ? "Try again in a moment, or sign in with your email and password." : "Links like this work once, for a minute. Sign in with your email and password instead."}</p>
        <Link href={`/signin?next=${encodeURIComponent(failed.next.startsWith("/") && !failed.next.startsWith("//") ? failed.next : "/")}`} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-navy-900 px-5 font-semibold text-white hover:bg-navy-800">
          Sign in
        </Link>
      </section>
    );
  }
  return (
    <p className="flex items-center justify-center gap-2 rounded-3xl border border-slate-100 bg-white p-8 font-semibold text-slate-600 shadow-sm" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden="true" /> Signing you in…
    </p>
  );
}
