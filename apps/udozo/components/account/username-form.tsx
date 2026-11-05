"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Check, Copy } from "lucide-react";
import { checkUsername, saveUsername, type UsernameCheck } from "@/lib/username-actions";
import { availabilityText, usernameChecker, usernameInput, usernameProblem, usernameRule } from "@/lib/username";
import { useConfirm } from "../confirm-dialog";

const inputClass = "min-h-12 w-full min-w-0 rounded-xl border border-navy-200 bg-white pr-3.5 pl-9 text-[15px] text-navy-900 focus:border-navy-500 focus:ring-2 focus:ring-brand-500/30 aria-[invalid=true]:border-brand-700";

type Shown = { tone: "idle" | "checking" | "ok" | "own" | "no"; text: string; suggestions: string[] };
const idle: Shown = { tone: "idle", text: usernameRule, suggestions: [] };

/** Copies their page's address, saying so for a moment. */
export function CopyAddress({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Nothing to copy with (an old browser): the address is on the page to select.
    }
  };
  return (
    <button type="button" onClick={() => void copy()} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-navy-200 bg-white px-3.5 text-sm font-semibold hover:border-navy-400">
      {copied ? <Check className="size-4 text-mint-700" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Choosing a username: lower case as they type, checked with Udozo a moment after they stop (only the newest answer is
 * shown), the reason in words when it cannot be theirs, Udozo's suggestions to tap, then Save. Changing one they have
 * asks first, as the old address works only 90 days more.
 */
export function UsernameForm({ current, addressPrefix }: { current: string | null; addressPrefix: string }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState("");
  const [shown, setShown] = useState<Shown>(idle);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();

  // Leaving the page cancels it, so an answer arriving afterwards is dropped.
  const checker = useMemo(
    () =>
      usernameChecker<UsernameCheck>(checkUsername, (_asked, result) => {
        if (!result.ok) return setShown({ tone: "no", text: result.message, suggestions: [] });
        const words = availabilityText(result.data);
        setShown({ tone: words.tone, text: words.text, suggestions: result.data.suggestions.slice(0, 3) });
      }),
    [],
  );
  useEffect(() => () => checker.cancel(), [checker]);

  const typed = (raw: string) => {
    const next = usernameInput(raw);
    setValue(next);
    setError(null);
    setSaved(null);
    const problem = usernameProblem(next);
    if (!next) {
      checker.cancel();
      return setShown(idle);
    }
    if (problem) {
      checker.cancel();
      return setShown({ tone: "no", text: problem, suggestions: [] });
    }
    if (next === current) {
      checker.cancel();
      return setShown({ tone: "own", text: "This is already yours.", suggestions: [] });
    }
    setShown(before => ({ tone: "checking", text: "Checking…", suggestions: before.suggestions }));
    checker.check(next);
  };

  const save = async () => {
    if (shown.tone !== "ok") return;
    if (current) {
      const answer = await confirm({
        title: `Change your username to ${value}?`,
        body: `Your page moves to ${addressPrefix}${value}. Links to ${addressPrefix}${current} keep working for 90 days, then stop. You can change it again in 30 days.`,
        action: "Change username",
      });
      if (!answer) return;
    }
    start(async () => {
      const result = await saveUsername(value);
      if (!result.ok) return setError(result.message);
      setSaved(result.data.username);
      setValue("");
      setShown(idle);
      router.refresh();
    });
  };

  const toneClass = shown.tone === "ok" ? "text-mint-700" : shown.tone === "no" ? "text-brand-700" : "text-navy-600";
  return (
    <form
      className="grid gap-3"
      onSubmit={event => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor={id} className="text-sm font-semibold">
        {current ? "New username" : "Your username"}
      </label>
      <div className="relative">
        <AtSign className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-navy-400" aria-hidden="true" />
        <input
          id={id}
          name="username"
          value={value}
          onChange={event => typed(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={40}
          placeholder="yourname"
          aria-invalid={shown.tone === "no" || undefined}
          aria-describedby={`${id}-status`}
          className={inputClass}
        />
      </div>
      <p id={`${id}-status`} aria-live="polite" className={`text-sm ${toneClass}`}>
        {shown.text}
      </p>
      {value && shown.tone !== "idle" ? (
        <p className="text-xs break-all text-navy-500">
          Your page: {addressPrefix}
          <strong className="text-navy-900">{value}</strong>
        </p>
      ) : null}
      {shown.suggestions.length && shown.tone !== "ok" ? (
        <div className="grid gap-2">
          <p className="text-xs text-navy-600">Free instead:</p>
          <ul className="flex flex-wrap gap-2">
            {shown.suggestions.map(suggestion => (
              <li key={suggestion} className="min-w-0">
                <button type="button" onClick={() => typed(suggestion)} className="inline-flex h-9 max-w-full items-center truncate rounded-full border border-navy-200 bg-white px-3.5 text-sm font-semibold hover:border-navy-400">
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="rounded-xl bg-mint-50 p-3 text-sm text-mint-700">
          Saved. Your page is now {addressPrefix}
          {saved}.
        </p>
      ) : null}
      <button type="submit" disabled={shown.tone !== "ok" || busy} className="flex h-11 w-fit items-center rounded-xl bg-navy-900 px-5 font-bold text-white disabled:opacity-50">
        {busy ? "Saving…" : current ? "Change username" : "Save username"}
      </button>
      {dialog}
    </form>
  );
}
