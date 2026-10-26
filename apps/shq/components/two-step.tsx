"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useDispatch } from "react-redux";
import QRCode from "qrcode";
import { Check, Copy, KeyRound, LogOut, Mail, MessageSquareText, ShieldCheck, Smartphone } from "lucide-react";
import { bitocardApi } from "@bitocard/api-client";
import {
  type TwoStepMethod,
  type TwoStepSettings,
  type TwoStepSetup,
  useConfirmTwoStepSetupMutation,
  useDisableTwoStepMutation,
  useNewRecoveryCodesMutation,
  useSendTwoStepCodeMutation,
  useStartTwoStepSetupMutation,
  useTwoStepQuery,
  useVerifyTwoStepMutation,
} from "@bitocard/api-client/reseller";
import { Badge, Button, Card, CardHeader, CodeInput, cn, ErrorState, errorMessage, Field, formatDate, Input, Notice, Skeleton } from "@bitocard/admin-ui";

export const methodNames: Record<TwoStepMethod, string> = { authenticator: "Authenticator app", email: "Email codes", sms: "Text messages" };
const methodIcons = { authenticator: Smartphone, email: Mail, sms: MessageSquareText } as const;
const methodHints: Record<TwoStepMethod, string> = {
  authenticator: "A code from an app such as Google Authenticator or 1Password. Works offline; the most secure choice.",
  email: "A code emailed to your primary address each time you sign in.",
  sms: "A code texted to your primary mobile number each time you sign in.",
};
const unavailable = { not_allowed: "Not offered in your market", phone_required: "Confirm a mobile number on your profile first", sms_unavailable: "Not available for your number yet" } as const;

/** Recovery codes look like abcd-1234; everything else is a 6-digit code. */
const isRecoveryCode = (value: string) => /^[a-z0-9]{4}-[a-z0-9]{4}$/i.test(value.trim());

/** A 60-second countdown after a code is sent (the API sends at most one a minute). */
function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);
  return [left, () => setLeft(60)] as const;
}

/** The 6-digit code boxes, or a recovery code field when the person has switched to one. */
function CodeField({ recovery, value, onChange, onComplete, invalid, disabled, label }: { recovery: boolean; value: string; onChange: (value: string) => void; onComplete: (value: string) => void; invalid: boolean; disabled: boolean; label: string }) {
  if (recovery) {
    return (
      <Field label="Recovery code" htmlFor="two-step-recovery" hint="One of the codes you saved, for example abcd-1234. Each works once.">
        <Input id="two-step-recovery" autoComplete="off" autoFocus maxLength={9} value={value} onChange={event => onChange(event.target.value)} className="text-center font-mono text-lg tracking-[0.2em]" />
      </Field>
    );
  }
  return <CodeInput label={label} value={value} onChange={onChange} onComplete={onComplete} autoFocus invalid={invalid} disabled={disabled} />;
}

/** Shown once: the ten recovery codes, with copy. */
export function RecoveryCodes({ codes, onDone, doneLabel = "I have saved them" }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <Notice tone="amber" title="Save your recovery codes">
        Each one signs you in once if your phone or email is not to hand. They are shown only now: keep them somewhere safe, such as a password manager.
      </Notice>
      <ol className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-white p-4 font-mono text-sm sm:p-5" aria-label="Recovery codes">
        {codes.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          onClick={() => {
            void navigator.clipboard?.writeText(codes.join("\n")).then(() => setCopied(true), () => undefined);
          }}
        >
          {copied ? "Copied" : "Copy codes"}
        </Button>
        <Button onClick={onDone}>{doneLabel}</Button>
      </div>
    </div>
  );
}

/**
 * Setting a method up: choose it, then scan the QR code (an authenticator) or enter the code just sent, then save the
 * recovery codes. `currentCode` is a code from the person's existing method when they are changing it.
 */
export function SetUpTwoStep({ settings, currentCode, onDone, onCancel }: { settings: TwoStepSettings; currentCode?: string; onDone: () => void; onCancel?: () => void }) {
  const [method, setMethod] = useState<TwoStepMethod | null>(null);
  const [setup, setSetup] = useState<TwoStepSetup | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [start, startState] = useStartTwoStepSetupMutation();
  const [confirm, confirmState] = useConfirmTwoStepSetupMutation();
  const [resendIn, startCountdown] = useCountdown();

  useEffect(() => {
    if (!setup?.otpauth_uri) return;
    let current = true;
    void QRCode.toDataURL(setup.otpauth_uri, { margin: 1, width: 200 }).then(url => current && setQr(url), () => undefined);
    return () => {
      current = false;
    };
  }, [setup]);

  const begin = async (choice: TwoStepMethod) => {
    setMethod(choice);
    setCode("");
    const started = await start({ method: choice, ...(currentCode ? { current_code: currentCode } : {}) }).unwrap().catch(() => null);
    if (started) {
      setSetup(started);
      if (choice !== "authenticator") startCountdown();
    }
  };
  const finish = async (value: string) => {
    if (confirmState.isLoading || value.length !== 6) return;
    const done = await confirm({ code: value }).unwrap().catch(() => null);
    if (done) setCodes(done.recovery_codes);
    else setCode("");
  };

  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />;

  if (!setup) {
    return (
      <div className="space-y-4">
        {startState.error ? <Notice tone="red">{errorMessage(startState.error)}</Notice> : null}
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold text-ink">Choose how you will confirm it is you</legend>
          {settings.methods.map(item => {
            const Icon = methodIcons[item.method];
            return (
              <button
                key={item.method}
                type="button"
                disabled={!item.available || startState.isLoading}
                onClick={() => void begin(item.method)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border border-line bg-white p-4 text-left transition hover:border-brand-400 focus-visible:outline-2 disabled:opacity-60 disabled:hover:border-line",
                  method === item.method && startState.isLoading ? "border-brand-500" : undefined,
                )}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{methodNames[item.method]}</span>
                  <span className="block text-sm text-muted">{item.reason ? unavailable[item.reason] : methodHints[item.method]}</span>
                </span>
              </button>
            );
          })}
        </fieldset>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void finish(code);
      }}
    >
      {setup.method === "authenticator" ? (
        <>
          <p className="text-sm text-muted">Scan this with your authenticator app, then enter the 6-digit code it shows.</p>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-white p-5">
            {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
            {qr ? <img src={qr} alt="Authenticator QR code" className="size-48" /> : <Skeleton className="size-48" />}
            <p className="text-center text-xs text-muted">
              Can’t scan? Enter this key: <code className="font-mono break-all text-ink">{setup.secret}</code>
            </p>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">
          We sent a 6-digit code to <span className="font-semibold text-ink">{setup.sent_to}</span>. It works for 10 minutes.
        </p>
      )}
      {confirmState.error ? <Notice tone="red">{errorMessage(confirmState.error)}</Notice> : null}
      {startState.error ? <Notice tone="red">{errorMessage(startState.error)}</Notice> : null}
      <CodeField recovery={false} label="Code" value={code} onChange={setCode} onComplete={value => void finish(value)} invalid={Boolean(confirmState.error)} disabled={confirmState.isLoading} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={confirmState.isLoading} disabled={code.length !== 6} icon={<ShieldCheck className="size-4" aria-hidden />}>
          Turn on
        </Button>
        {setup.method !== "authenticator" && !currentCode ? (
          <Button type="button" variant="ghost" disabled={resendIn > 0} loading={startState.isLoading} onClick={() => void begin(setup.method)}>
            <span aria-live="polite">{resendIn > 0 ? `Send again in ${resendIn}s` : "Send a new code"}</span>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setSetup(null);
            setQr(null);
            setCode("");
            if (currentCode) onCancel?.();
          }}
        >
          Choose another method
        </Button>
      </div>
    </form>
  );
}

/**
 * Asks for a code from the person's method (sending it for email and SMS when they ask), or a recovery code. Used to sign
 * in and to confirm a change.
 */
function CurrentCode({ settings, action, loading, error, onCode, autoSend }: { settings: TwoStepSettings; action: string; loading: boolean; error: unknown; onCode: (code: string) => void; autoSend?: boolean }) {
  const method = settings.method ?? "authenticator";
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [send, sendState] = useSendTwoStepCodeMutation();
  const [resendIn, startCountdown] = useCountdown();
  const sentOnce = useRef(false);
  const sends = method !== "authenticator";

  const sendCode = async () => {
    const sent = await send().unwrap().catch(() => null);
    if (sent) startCountdown();
  };
  useEffect(() => {
    // The code goes out as soon as the step shows (once, even if React runs effects twice).
    if (!autoSend || !sends || sentOnce.current) return;
    sentOnce.current = true;
    void sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, sends]);

  const submit = (value: string) => {
    if (loading) return;
    if (recovery ? isRecoveryCode(value) : value.length === 6) onCode(value.trim().toLowerCase());
  };
  useEffect(() => {
    // A refused code clears the boxes for another try.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (error) setCode("");
  }, [error]);

  const prompt = recovery
    ? "Enter one of your recovery codes."
    : method === "authenticator"
      ? "Enter the 6-digit code from your authenticator app."
      : sendState.data || !autoSend
        ? `Enter the 6-digit code we sent to ${settings.sent_to ?? "you"}.`
        : `We are sending a code to ${settings.sent_to ?? "you"}.`;

  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        submit(code);
      }}
    >
      <p className="text-sm text-muted">{prompt}</p>
      {error ? <Notice tone="red">{errorMessage(error)}</Notice> : null}
      {sendState.error ? <Notice tone="red">{errorMessage(sendState.error)}</Notice> : null}
      <CodeField recovery={recovery} label="Code" value={code} onChange={setCode} onComplete={submit} invalid={Boolean(error)} disabled={loading} />
      <Button type="submit" className="w-full sm:w-auto" loading={loading} disabled={recovery ? !isRecoveryCode(code) : code.length !== 6} icon={<ShieldCheck className="size-4" aria-hidden />}>
        {action}
      </Button>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
        {sends && !recovery ? (
          <button type="button" className="text-brand-600 hover:text-brand-700 disabled:text-subtle" disabled={resendIn > 0 || sendState.isLoading} onClick={() => void sendCode()}>
            <span aria-live="polite">{resendIn > 0 ? `Send again in ${resendIn}s` : sendState.data || autoSend ? "Send a new code" : `Send a code to ${settings.sent_to ?? "me"}`}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="text-brand-600 hover:text-brand-700"
          onClick={() => {
            setRecovery(value => !value);
            setCode("");
          }}
        >
          {recovery ? `Use your ${methodNames[method].toLowerCase()}` : "Use a recovery code instead"}
        </button>
      </div>
    </form>
  );
}

function Frame({ title, intro, children, onSignOut, signingOut }: { title: string; intro: string; children: ReactNode; onSignOut: () => void; signingOut: boolean }) {
  return (
    <div className="w-full max-w-md space-y-5">
      <span className="grid size-12 place-items-center rounded-xl bg-brand-50 text-brand-600">
        <KeyRound className="size-6" aria-hidden />
      </span>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-muted">{intro}</p>
      </div>
      {children}
      <Button variant="ghost" size="sm" icon={<LogOut className="size-4" aria-hidden />} loading={signingOut} onClick={onSignOut}>
        Sign out
      </Button>
    </div>
  );
}

/**
 * The second step of signing in: the code from the person's method, or, when their account requires two-step sign-in
 * and they have none yet, setting a method up. `onDone` runs once this session has finished signing in.
 */
export function TwoStepSignIn({ onDone, onSignOut, signingOut }: { onDone: () => void; onSignOut: () => void; signingOut: boolean }) {
  const dispatch = useDispatch();
  const settings = useTwoStepQuery();
  const [verify, verifyState] = useVerifyTwoStepMutation();
  const finished = () => {
    // The session now counts as signed in: everything refetches with it.
    dispatch(bitocardApi.util.invalidateTags(["Session"]));
    onDone();
  };

  if (!settings.data) {
    if (settings.error) return <ErrorState message={errorMessage(settings.error, "Could not load your sign-in step.")} onRetry={settings.refetch} />;
    return <Skeleton className="h-64 w-full max-w-md" />;
  }
  if (settings.data.setup_required) {
    return (
      <Frame title="Turn on two-step sign-in" intro="Your reseller account asks everyone on its team to confirm it is them with a second step when they sign in. Choose how." onSignOut={onSignOut} signingOut={signingOut}>
        <SetUpTwoStep settings={settings.data} onDone={finished} />
      </Frame>
    );
  }
  return (
    <Frame title="Confirm it is you" intro="Two-step sign-in is on for your account." onSignOut={onSignOut} signingOut={signingOut}>
      <CurrentCode
        settings={settings.data}
        action="Verify and sign in"
        autoSend
        loading={verifyState.isLoading}
        error={verifyState.error}
        onCode={code => {
          void verify({ code })
            .unwrap()
            .then(finished, () => undefined);
        }}
      />
    </Frame>
  );
}

type Change = { kind: "change" | "codes" | "off"; code?: string };

/** Settings > Security: the person's two-step sign-in, changed with a code from their current method. */
export function TwoStepCard() {
  const settings = useTwoStepQuery();
  const [change, setChange] = useState<Change | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disable, disableState] = useDisableTwoStepMutation();
  const [regenerate, regenerateState] = useNewRecoveryCodesMutation();
  const data = settings.data;

  const reset = () => {
    setChange(null);
    setEnabling(false);
    setNewCodes(null);
    disableState.reset();
    regenerateState.reset();
  };
  const done = (message: string) => {
    reset();
    setNotice(message);
    void settings.refetch();
  };

  return (
    <Card>
      <CardHeader
        title="Two-step sign-in"
        description="A second step after your password, so a stolen password alone cannot open your account."
        actions={data ? <Badge tone={data.method ? "green" : "grey"}>{data.method ? `On: ${methodNames[data.method]}` : "Off"}</Badge> : null}
      />
      <div className="space-y-4 p-5 sm:p-6">
        {!data ? (
          settings.error ? <ErrorState message={errorMessage(settings.error, "Could not load your two-step settings.")} onRetry={settings.refetch} /> : <Skeleton className="h-24 w-full" />
        ) : (
          <>
            {notice ? <Notice tone="green">{notice}</Notice> : null}
            {data.required ? <Notice tone="blue">Your reseller account requires two-step sign-in for everyone on its team, so it cannot be turned off. You can change the method.</Notice> : null}
            {newCodes ? <RecoveryCodes codes={newCodes} onDone={() => done("Your new recovery codes are saved. The old ones no longer work.")} doneLabel="Done" /> : null}

            {!newCodes && !change && !enabling ? (
              <>
                {data.method ? (
                  <dl className="grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted">Method</dt>
                      <dd className="font-semibold text-ink">{methodNames[data.method]}{data.sent_to ? ` (${data.sent_to})` : ""}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Turned on</dt>
                      <dd className="font-semibold text-ink">{data.enabled_at ? formatDate(data.enabled_at) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Recovery codes left</dt>
                      <dd className={cn("font-semibold", data.recovery_codes_left <= 2 ? "text-amber-700" : "text-ink")}>{data.recovery_codes_left} of 10</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-muted">Off. Turn it on to be asked for a code from your phone or email each time you sign in.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {data.method ? (
                    <>
                      <Button variant="secondary" onClick={() => setChange({ kind: "change" })}>
                        Change method
                      </Button>
                      <Button variant="secondary" onClick={() => setChange({ kind: "codes" })}>
                        New recovery codes
                      </Button>
                      {data.required ? null : (
                        <Button variant="ghost" onClick={() => setChange({ kind: "off" })}>
                          Turn off
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button icon={<ShieldCheck className="size-4" aria-hidden />} onClick={() => setEnabling(true)}>
                      Turn on two-step sign-in
                    </Button>
                  )}
                </div>
              </>
            ) : null}

            {enabling ? <SetUpTwoStep settings={data} onDone={() => done("Two-step sign-in is on.")} onCancel={reset} /> : null}

            {change && !change.code ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-ink">
                  {change.kind === "change" ? "First, confirm it is you." : change.kind === "codes" ? "Confirm it is you to get new recovery codes." : "Confirm it is you to turn two-step sign-in off."}
                </p>
                <CurrentCode
                  settings={data}
                  action={change.kind === "off" ? "Turn off" : "Continue"}
                  loading={disableState.isLoading || regenerateState.isLoading}
                  error={disableState.error ?? regenerateState.error}
                  onCode={code => {
                    if (change.kind === "change") setChange({ kind: "change", code });
                    else if (change.kind === "codes") void regenerate({ code }).unwrap().then(result => { setChange(null); setNewCodes(result.recovery_codes); }, () => undefined);
                    else void disable({ code }).unwrap().then(() => done("Two-step sign-in is off."), () => undefined);
                  }}
                />
                <Button variant="ghost" onClick={reset}>
                  Cancel
                </Button>
              </div>
            ) : null}

            {change?.kind === "change" && change.code ? <SetUpTwoStep settings={data} currentCode={change.code} onDone={() => done("Your two-step method is changed.")} onCancel={reset} /> : null}
          </>
        )}
      </div>
    </Card>
  );
}
