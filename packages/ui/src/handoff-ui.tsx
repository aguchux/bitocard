"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { firstName, readHandoffHash } from "./handoff";

export type HandoffResult = { ok: true; next: string } | { ok: false; unreachable: boolean };

/**
 * The sign-in handoff's landing page, shared by BitoCard's own sites (bitocard.com and its country stores): reads the
 * code from the address's fragment, removes it from the address bar at once (so it is not kept in
 * history or shared by mistake), and has this site's server exchange it once (`continueSignIn`, the site's own server
 * action), even if the effect runs twice; then on to `next`.
 */
export function HandoffLanding({ continueSignIn }: { continueSignIn: (code: string, next: string) => Promise<HandoffResult> }) {
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
  }, [continueSignIn]);

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
      <svg className="size-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      Signing you in…
    </p>
  );
}

/**
 * "Continue as Adaeze · Signed in on ng.bitocard.com": the one-click way in from another BitoCard site, offered on the
 * sign-in page before anyone clicks, then an "or sign in" divider above the site's own form.
 */
export function ContinueAs({ name, host, href }: { name: string; host: string; href: string }) {
  return (
    <>
      <a href={href} className="flex items-center gap-3 rounded-2xl border-2 border-navy-900 p-3.5 text-navy-900 hover:bg-slate-50">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-navy-900 font-bold text-white" aria-hidden="true">
          {firstName(name).slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block">Continue as {name}</strong>
          <span className="block text-sm text-slate-600">Signed in on {host}</span>
        </span>
        <svg className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </a>
      <p className="my-5 flex items-center gap-3 text-sm text-slate-500">
        <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
        or sign in
        <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
      </p>
    </>
  );
}
