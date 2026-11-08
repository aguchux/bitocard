"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { WhatsappMark, whatsappGreen } from "../whatsapp-mark";

/** What the waiting page shows, by what `/api/whatsapp-sign-in` answered. */
export type WaitingState = "waiting" | "approved" | "declined" | "expired" | "over";

/** How often the page asks whether WhatsApp approved the sign-in (paused while the tab is hidden). */
export const pollMs = 3000;

/** The answer's state, read safely: anything unknown is over. */
export function waitingState(answer: unknown): { state: WaitingState; redirect: string | null } {
  const status = (answer as { status?: unknown } | null)?.status;
  const redirect = (answer as { redirect?: unknown } | null)?.redirect;
  if (status === "approved") return { state: "approved", redirect: typeof redirect === "string" && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/" };
  if (status === "waiting" || status === "declined" || status === "expired") return { state: status, redirect: null };
  return { state: "over", redirect: null };
}

const endings: Record<Exclude<WaitingState, "waiting" | "approved">, string> = {
  declined: "The sign-in was turned down on WhatsApp. If it was you, start again.",
  expired: "That took too long, so the code stopped working. Start again.",
  over: "This sign-in is over. Start again.",
};

/**
 * Waiting for WhatsApp: the message to send (Open WhatsApp fills it in; the QR code opens it on a phone), the steps on
 * WhatsApp (yes or no for an account; a few questions to make one), and the page asks every 3 seconds, while it is
 * shown, until WhatsApp approved it, then goes on signed in.
 */
export function WhatsappWaiting({ intent, text, link, qr, next }: { intent: "signin" | "signup"; text: string; link: string; qr: string | null; next: string }) {
  const [state, setState] = useState<WaitingState>("waiting");
  useEffect(() => {
    if (state !== "waiting") return;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/whatsapp-sign-in", { method: "POST", cache: "no-store" });
        const answer = waitingState(await res.json());
        if (stopped) return;
        if (answer.state === "approved") {
          stopped = true;
          setState("approved");
          window.location.assign(answer.redirect ?? "/");
          return;
        }
        if (answer.state !== "waiting") setState(answer.state);
      } catch {
        // The connection dropped: ask again next time.
      }
    };
    const timer = window.setInterval(check, pollMs);
    const visible = () => void check();
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [state]);

  const again = intent === "signup" ? `/signup?next=${encodeURIComponent(next)}` : `/signin?next=${encodeURIComponent(next)}`;
  return (
    <section className="grid gap-5 rounded-3xl border border-navy-200 bg-white p-5 sm:p-6" aria-live="polite">
      <header className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full text-white" style={{ background: whatsappGreen }}>
          <WhatsappMark className="size-6" />
        </span>
        <h1 className="text-xl leading-tight font-extrabold sm:text-2xl">{intent === "signup" ? "Sign up with WhatsApp" : "Continue with WhatsApp"}</h1>
      </header>

      {state === "approved" ? (
        <p className="flex items-center gap-2 font-semibold text-navy-900">
          <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> You are in. Taking you on…
        </p>
      ) : state !== "waiting" ? (
        <div className="grid gap-3">
          <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            {endings[state]}
          </p>
          <Link href={again} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-navy-900 px-5 font-bold text-white hover:bg-navy-800">
            Start again
          </Link>
        </div>
      ) : (
        <>
          <ol className="grid gap-2 text-[15px] text-navy-800">
            <li>
              <strong>1.</strong> Send Udozo this message on WhatsApp: <code className="rounded-md bg-navy-50 px-1.5 py-0.5 font-mono font-bold tracking-wide text-navy-900">{text}</code>
            </li>
            <li>
              <strong>2.</strong> {intent === "signup" ? "Answer a few questions there: your name, your email and the code we email you. Have an account already? Say yes to sign in instead." : "Tap Yes, sign me in. No account yet? Make one there in a minute."}
            </li>
            <li>
              <strong>3.</strong> Come back here: this page carries on by itself.
            </li>
          </ol>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 items-center justify-center gap-2.5 rounded-xl px-5 font-bold text-[#06361c] hover:brightness-95"
            style={{ background: whatsappGreen }}
          >
            <WhatsappMark /> Open WhatsApp
          </a>
          {qr ? (
            <div className="hidden items-center gap-4 rounded-2xl border border-navy-100 p-4 md:flex">
              {/* Drawn on the server from the link alone, as an image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR code that opens WhatsApp with the message" width={144} height={144} className="size-36 shrink-0" />
              <p className="text-sm text-navy-600">On a computer? Scan this with your phone’s camera to open WhatsApp with the message ready.</p>
            </div>
          ) : null}
          <p className="flex items-center gap-2 text-sm text-navy-500">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Waiting for WhatsApp… The message works for 20 minutes. Only send it from your own WhatsApp.
          </p>
          <p className="text-sm">
            <Link href={again} className="font-semibold text-brand-700 underline">
              Use your email instead
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
