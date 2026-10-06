"use client";

import { useId, useState, type FormEvent } from "react";
import { AlertTriangle, Loader2, LogIn, Play, ShieldCheck } from "lucide-react";
import { apiUrl, shqSignInUrl, useTryIt } from "./try-it-context";

export type TryItParameter = { name: string; in: "path" | "query"; required: boolean; description: string; example: string };
export type TryItOperation = {
  method: string;
  path: string;
  summary: string;
  auth: "public" | "session" | "api_key";
  scopes: string[];
  sandboxOnly: boolean;
  parameters: TryItParameter[];
  /** The documented example body, as JSON text. */
  body: string | null;
};

type Result = { status: number; ms: number; requestId: string | null; replayed: boolean; body: string; url: string } | { error: string };

const writes = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const newKey = () => crypto.randomUUID();

/**
 * Calls one operation from the browser, straight to the API, with the reseller's short-lived token. Sandbox by
 * default; live is read-only unless switched off, and every live change asks first.
 */
export function TryIt({ operation }: { operation: TryItOperation }) {
  const id = useId();
  const { status, membership, mode, readOnly, token } = useTryIt();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(operation.parameters.map(item => [item.name, item.example])));
  const [body, setBody] = useState(operation.body ?? "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const write = writes.has(operation.method);
  const live = mode === "live";

  if (operation.auth === "session") {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        Dashboard only: SHQ calls this with its own sign-in, so it cannot be tried here.
      </p>
    );
  }

  const blocked =
    operation.auth === "public"
      ? null
      : status === "checking"
        ? "Checking your sign-in…"
        : status === "unavailable"
          ? "BitoCard could not be reached. Try again shortly."
          : status !== "signed_in" || !membership
            ? "signin"
            : live && operation.sandboxOnly
              ? "This is a sandbox helper: switch to Sandbox to try it."
              : live && readOnly && write
                ? "Live mode is read-only. Turn off Read-only in the red bar to send changes to your live account."
                : null;

  const url = () => {
    const path = operation.path.replace(/\{(\w+)\}/g, (_match, name: string) => encodeURIComponent(values[name] ?? ""));
    const query = operation.parameters.filter(item => item.in === "query" && values[item.name]?.trim()).map(item => [item.name, values[item.name].trim()]);
    return `${apiUrl}${path}${query.length ? `?${new URLSearchParams(query).toString()}` : ""}`;
  };

  async function send() {
    setConfirming(false);
    setSending(true);
    setResult(null);
    const started = performance.now();
    const target = url();
    try {
      let parsedBody: string | undefined;
      if (write && operation.method !== "DELETE" && body.trim()) {
        try {
          parsedBody = JSON.stringify(JSON.parse(body));
        } catch {
          throw new Error("The request body is not valid JSON.");
        }
      }
      const headers: Record<string, string> = { accept: "application/json" };
      if (operation.auth === "api_key") headers.authorization = `Bearer ${(await token()).token}`;
      if (parsedBody) headers["content-type"] = "application/json";
      if (operation.method === "POST") headers["idempotency-key"] = idempotencyKey;
      const response = await fetch(target, { method: operation.method, headers, body: parsedBody, credentials: "omit" });
      const text = await response.text();
      let pretty = text;
      try {
        pretty = text ? JSON.stringify(JSON.parse(text), null, 2) : "";
      } catch {
        /* not JSON: shown as it is */
      }
      setResult({
        status: response.status,
        ms: Math.round(performance.now() - started),
        requestId: response.headers.get("request-id"),
        replayed: response.headers.get("idempotent-replayed") === "true",
        body: pretty,
        url: target,
      });
      // A new key for the next change; resending this one would replay the same result.
      if (operation.method === "POST" && response.status < 500) setIdempotencyKey(newKey());
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "The request failed." });
    } finally {
      setSending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    if (live && write) setConfirming(true);
    else void send();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#ff2382] px-3 text-sm font-semibold text-[#e0116d] hover:bg-pink-50"
      >
        <Play className="size-4" aria-hidden />
        Try it
      </button>
    );
  }

  return (
    <form onSubmit={submit} className={`space-y-4 rounded-2xl border p-4 ${live && operation.auth === "api_key" ? "border-red-300 bg-red-50/40" : "border-slate-200 bg-white"}`} aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-title`} className="text-sm font-semibold text-[#070f4c]">
          Try it
          {operation.auth === "api_key" ? (
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${live ? "bg-red-600 text-white" : "bg-emerald-100 text-emerald-800"}`}>{live ? "Live" : "Sandbox"}</span>
          ) : (
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Public: no sign-in</span>
          )}
        </p>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-[#070f4c]">
          Close
        </button>
      </div>

      {blocked === "signin" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          <span>Sign in with your SHQ account to call your sandbox or live account from here.</span>
          <button type="button" onClick={() => window.location.assign(shqSignInUrl())} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#070f4c] px-3 font-semibold text-white">
            <LogIn className="size-4" aria-hidden />
            Sign in
          </button>
        </div>
      ) : blocked ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{blocked}</p>
      ) : null}

      {operation.parameters.length ? (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">Parameters</legend>
          {operation.parameters.map(item => (
            <label key={`${item.in}:${item.name}`} className="text-sm">
              <span className="mb-1 flex items-baseline gap-2">
                <code className="font-semibold text-[#070f4c]">{item.name}</code>
                <span className="text-xs text-slate-500">
                  {item.in}
                  {item.required ? ", required" : ""}
                </span>
              </span>
              <input
                value={values[item.name] ?? ""}
                onChange={event => setValues(current => ({ ...current, [item.name]: event.target.value }))}
                required={item.required}
                placeholder={item.description.slice(0, 60)}
                autoComplete="off"
                spellCheck={false}
                className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-[13px] focus:border-[#ff2382] focus:ring-2 focus:ring-pink-100 focus:outline-none"
              />
            </label>
          ))}
        </fieldset>
      ) : null}

      {write && operation.method !== "DELETE" && operation.body !== null ? (
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-[#070f4c]">Body (JSON)</span>
          <textarea
            value={body}
            onChange={event => setBody(event.target.value)}
            rows={Math.min(16, Math.max(4, body.split("\n").length + 1))}
            spellCheck={false}
            className="w-full rounded-lg border border-slate-200 bg-[#0d1117] p-3 font-mono text-[13px] leading-relaxed text-slate-100 focus:border-[#ff2382] focus:ring-2 focus:ring-pink-100 focus:outline-none"
          />
        </label>
      ) : null}

      {operation.method === "POST" ? (
        <p className="text-xs text-slate-500">
          Sent with <code>Idempotency-Key: {idempotencyKey}</code>. A new key is used after each response.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={Boolean(blocked) || sending}
          className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${live && operation.auth === "api_key" ? "bg-red-600 hover:bg-red-700" : "bg-[#ff2382] hover:bg-[#e8116d]"}`}
        >
          {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
          Send {operation.method}
        </button>
        {operation.scopes.length ? <span className="text-xs text-slate-500">Needs {operation.scopes.join(", ")}</span> : null}
      </div>

      {confirming ? (
        <div role="alertdialog" aria-labelledby={`${id}-confirm`} className="space-y-3 rounded-xl border border-red-300 bg-white p-4">
          <p id={`${id}-confirm`} className="flex items-start gap-2 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              This sends <strong>{operation.method} {operation.path}</strong> to <strong>{membership?.reseller.name}</strong>&apos;s <strong>live</strong> account. It is real: it can
              spend your wallet or deliver real products.
            </span>
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void send()} className="min-h-9 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700">
              Send to live
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-9 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        "error" in result ? (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
            {result.error}
          </p>
        ) : (
          <div className="space-y-2" aria-live="polite">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
              <span className={`rounded-full px-2 py-0.5 font-semibold ${result.status < 300 ? "bg-emerald-100 text-emerald-800" : result.status < 500 ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800"}`}>{result.status}</span>
              <span>{result.ms} ms</span>
              {result.requestId ? <span>Request-Id {result.requestId}</span> : null}
              {result.replayed ? <span>Idempotent replay</span> : null}
            </p>
            <pre className="max-h-[28rem] overflow-auto rounded-xl bg-[#0d1117] p-3 font-mono text-[13px] leading-relaxed text-slate-100">{result.body || "(no body)"}</pre>
          </div>
        )
      ) : null}
    </form>
  );
}
