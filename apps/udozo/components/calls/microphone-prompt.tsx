"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Mic, MicOff, ShieldCheck, X } from "lucide-react";
import { micProblem } from "@/lib/call-engine";
import { type MicPermission, type MicPromptState, micPromptDue, micPromptKey, micPromptText, readMicPrompt } from "@/lib/microphone";
import { allowSteps } from "./call-panel";
import { useCalls } from "./call-provider";

function remember(allowed: boolean) {
  try {
    localStorage.setItem(micPromptKey, JSON.stringify({ asked_at: Date.now(), allowed }));
  } catch {
    // Storage blocked: the prompt may simply ask again next time.
  }
}

function recalled() {
  try {
    return readMicPrompt(localStorage.getItem(micPromptKey));
  } catch {
    return null;
  }
}

/** The prompt's words and buttons, apart from the dialog so they can be drawn on their own. */
export function MicPromptBody({ state, onAllow, onClose }: { state: MicPromptState; onAllow: () => void; onClose: () => void }) {
  const copy = micPromptText(state === "working" ? "ask" : state);
  const done = state === "done";
  return (
    <div className="grid gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className={`grid size-12 shrink-0 place-items-center rounded-full ${done ? "bg-mint-500 text-white" : state === "ask" || state === "working" ? "bg-navy-900 text-white" : "bg-amber-100 text-amber-700"}`} aria-hidden="true">
          {done ? <Check className="size-6" /> : state === "ask" || state === "working" ? <Mic className="size-6" /> : <MicOff className="size-6" />}
        </span>
        <h2 className="min-w-0 flex-1 pt-2.5 text-lg font-bold">{copy.title}</h2>
        <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-navy-50" aria-label="Close">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <p className="text-sm text-navy-700">{copy.text}</p>
      {copy.steps ? (
        <ul className="grid gap-1.5 rounded-2xl bg-navy-50 p-3.5 text-sm text-navy-700">
          {allowSteps.map(step => (
            <li key={step.where}>
              <strong className="text-navy-900">{step.where}:</strong> {step.how}
            </li>
          ))}
        </ul>
      ) : null}
      {done ? null : (
        <p className="flex items-center gap-1.5 text-xs text-navy-500">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" /> Udozo calls are private: no phone numbers are shared, and nothing is recorded.
        </p>
      )}
      <div className="flex gap-2.5">
        {done ? (
          <button type="button" onClick={onClose} className="h-12 flex-1 rounded-2xl bg-navy-900 px-4 text-sm font-bold text-white hover:bg-navy-700">
            Done
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} className="h-12 flex-1 rounded-2xl border border-navy-200 px-4 text-sm font-bold text-navy-900 hover:bg-navy-50">
              Not now
            </button>
            {copy.action ? (
              <button type="button" onClick={onAllow} disabled={state === "working"} className="flex h-12 flex-2 items-center justify-center gap-2 rounded-2xl bg-mint-500 px-4 text-sm font-bold text-white hover:bg-mint-700 disabled:opacity-60">
                <Mic className="size-4" aria-hidden="true" /> {state === "working" ? "Waiting for your browser…" : copy.action}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * On the account pages, once per visit to them: where calls are set up and this browser has not allowed the microphone
 * for udozo.com, a dialog asks the signed-in customer to allow it, so they can make and answer calls with buyers and
 * sellers. Allow microphone asks the browser (and lets the microphone go at once); where the browser blocks it, the
 * dialog says how to allow it, and closes as ready once the browser reports it allowed. Not now waits three days.
 */
export function MicrophonePrompt() {
  const available = useCalls()?.available ?? false;
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<MicPromptState | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!available || asked.current) return;
    asked.current = true;
    let stopped = false;
    let status: PermissionStatus | null = null;
    const decide = (permission: MicPermission) => {
      if (stopped) return;
      const due = micPromptDue({ available, supported: Boolean(navigator.mediaDevices?.getUserMedia), permission, memory: recalled(), now: Date.now() });
      if (due) setState(permission === "denied" ? "blocked" : "ask");
    };
    const changed = () => {
      if (stopped || status?.state !== "granted") return;
      remember(true);
      setState(current => (current === null ? null : "done"));
    };
    if (!navigator.permissions?.query) decide(null);
    else
      navigator.permissions
        .query({ name: "microphone" as PermissionName })
        .then(found => {
          status = found;
          found.addEventListener("change", changed);
          decide(found.state);
        })
        .catch(() => decide(null));
    return () => {
      stopped = true;
      status?.removeEventListener("change", changed);
    };
  }, [available]);

  useEffect(() => {
    if (state && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [state]);

  const allow = async () => {
    setState("working");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      // Only asking: the microphone is let go at once.
      for (const track of stream.getTracks()) track.stop();
      remember(true);
      // Closed while the browser was asking: nothing more to show.
      if (dialog.current?.open) setState("done");
    } catch (error) {
      if (!dialog.current?.open) return;
      const problem = micProblem(error);
      setState(problem === "missing" || problem === "in_use" ? problem : "blocked");
    }
  };

  if (!state) return null;
  return (
    <dialog
      ref={dialog}
      aria-label={micPromptText(state === "working" ? "ask" : state).title}
      className="sheet m-0 mt-auto w-full max-w-none rounded-t-3xl bg-white p-0 text-navy-900 sm:m-auto sm:max-w-md sm:rounded-3xl"
      onClick={event => event.target === event.currentTarget && event.currentTarget.close()}
      onClose={() => {
        // Closed before the microphone was allowed (Not now, Escape, the backdrop): not asked again for a while.
        if (state !== "done") remember(false);
        setState(null);
      }}
    >
      <MicPromptBody state={state} onAllow={() => void allow()} onClose={() => dialog.current?.close()} />
    </dialog>
  );
}
