"use client";

import { useState } from "react";
import { Building2, ExternalLink, RotateCw, ShieldCheck, UserRound } from "lucide-react";
import { ActionDialog, Button, Card, CardHeader, errorMessage, formatDateTime, Notice, StatusBadge } from "@bitocard/admin-ui";
import { type AccountType, type Verification, useSetAccountTypeMutation, useStartBusinessCheckMutation } from "@bitocard/api-client/reseller";

const choices: Array<{
  value: AccountType;
  title: string;
  text: string;
  icon: typeof UserRound;
}> = [
  {
    value: "individual",
    title: "Individual",
    text: "You sell in your own name. Only your identity is checked.",
    icon: UserRound,
  },
  {
    value: "business",
    title: "Business",
    text: "You sell as a registered business. Your business is checked too (KYB), with its documents.",
    icon: Building2,
  },
];

/** What switching does, said before it happens. */
export function switchWarning(check: Verification, to: AccountType): string {
  if (to === "business") {
    if (check.kyb_verified && check.business_type === "registered") return "Your registered business is already verified: you sell as a business straight away.";
    if (check.reseller_status === "active")
      return "Live selling pauses until your business passes its check (your registration certificate, proof of address and directors). Your sandbox keeps working.";
    return check.verified ? "You will verify your business next: its registration certificate, proof of address and directors." : "Your identity check will cover your registered business too.";
  }
  if (check.business_check?.status === "in_progress") return "Your business check in progress is closed. You sell in your own name.";
  return check.verified ? "Your identity is verified: you keep selling, in your own name." : "Your identity check will cover only you.";
}

/** Individual or business: the owner switches, after a warning saying what changes. */
export function AccountTypeCard({ check, owner }: { check: Verification; owner: boolean }) {
  const current: AccountType = check.account_type ?? "individual";
  const [target, setTarget] = useState<AccountType | null>(null);
  const [change, state] = useSetAccountTypeMutation();
  const reviewing = check.status === "in_review" || check.business_check?.status === "in_review";

  return (
    <Card>
      <CardHeader title="How you sell" description="As an individual or as a registered business. You can switch later." />
      <div className="space-y-4 p-5 sm:p-6">
        {check.paused_for_kyb ? (
          <Notice tone="amber" title="Live selling is paused">
            You switched to a business account. Verify your business below to sell live again, or switch back to individual.
          </Notice>
        ) : null}
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <div role="radiogroup" aria-label="Account type" className="grid gap-3 sm:grid-cols-2">
          {choices.map(choice => {
            const chosen = choice.value === current;
            return (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={chosen}
                disabled={!owner || reviewing || chosen || state.isLoading}
                onClick={() => setTarget(choice.value)}
                className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${chosen ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-line bg-white hover:border-brand-300"} disabled:cursor-default`}
              >
                <choice.icon className={`mt-0.5 size-5 shrink-0 ${chosen ? "text-brand-600" : "text-muted"}`} aria-hidden />
                <span>
                  <span className="flex items-center gap-2 font-semibold text-ink">
                    {choice.title}
                    {chosen ? <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[11px] font-bold text-white">Current</span> : null}
                  </span>
                  <span className="mt-1 block text-sm text-muted">{choice.text}</span>
                </span>
              </button>
            );
          })}
        </div>
        {!owner ? (
          <p className="text-sm text-muted">Only the business owner can change how the account sells.</p>
        ) : reviewing ? (
          <p className="text-sm text-muted">You can switch once the check being reviewed is decided.</p>
        ) : null}
        <ActionDialog
          open={target !== null}
          onClose={() => setTarget(null)}
          title={target === "business" ? "Switch to a business account?" : "Switch to an individual account?"}
          description={target ? switchWarning(check, target) : ""}
          confirmLabel={target === "business" ? "Switch to business" : "Switch to individual"}
          requireReason={false}
          onConfirm={async () => {
            if (!target) return;
            await change(target).unwrap();
            setTarget(null);
          }}
        />
      </div>
    </Card>
  );
}

const businessReasons: Record<string, string> = {
  restarted: "You closed this check.",
  abandoned: "It was closed after three days without progress.",
  cancelled: "BitoCard closed it.",
};

/** A business account's KYB once the owner's identity is approved: the business and its documents only. */
export function BusinessCheckCard({ check, owner }: { check: Verification; owner: boolean }) {
  const [consent, setConsent] = useState(false);
  const [start, state] = useStartBusinessCheckMutation();
  const business = check.business_check ?? null;
  const open = business?.status === "in_progress";

  const begin = async (restart = false) => {
    const result = await start({
      consent: true,
      ...(restart ? { restart: true } : {}),
    })
      .unwrap()
      .catch(() => null);
    if (result?.business_url) window.location.assign(new URL(result.business_url).href);
  };

  return (
    <Card>
      <CardHeader title="Business check (KYB)" actions={business ? <StatusBadge status={business.status} /> : <StatusBadge status="not_started" />} />
      <div className="space-y-4 p-5 sm:p-6">
        {business?.status === "in_review" ? (
          <Notice tone="amber" title="Being reviewed">
            A person at BitoCard is checking your business. We will email you the outcome.
          </Notice>
        ) : business?.status === "declined" ? (
          <Notice tone="red" title="Business check not passed">
            Check your documents and start a new one.
          </Notice>
        ) : business?.status === "expired" ? (
          <Notice tone="grey" title="Check closed">
            {businessReasons[business.reason ?? ""] ?? "It was not finished in time."} Start a new one when you are ready.
          </Notice>
        ) : open ? (
          <Notice tone="blue" title="Check in progress">
            Continue where you left off.
          </Notice>
        ) : (
          <Notice tone="amber" title="Verify your business">
            Your identity is already verified, so only your business is asked: its registered name, number and address, then the registration certificate, a proof of address from the last three months
            and a document naming its directors or owners.
          </Notice>
        )}
        {business ? <p className="text-sm text-muted">Started {formatDateTime(business.started_at)}</p> : null}
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        {!owner ? (
          <p className="text-sm text-muted">Only the business owner can take the business check.</p>
        ) : business?.status === "in_review" ? null : open ? (
          <div className="flex flex-wrap gap-2">
            <Button icon={<ExternalLink className="size-4" aria-hidden />} loading={state.isLoading} onClick={() => void begin()}>
              Continue the business check
            </Button>
            <Button variant="secondary" icon={<RotateCw className="size-4" aria-hidden />} disabled={state.isLoading} onClick={() => void begin(true)}>
              Start again
            </Button>
          </div>
        ) : (
          <>
            <label className="flex items-start gap-3 rounded-xl border border-line p-4 text-sm">
              <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand-500" />
              <span>I agree to BitoCard checking my business and its documents, as described in the privacy notice.</span>
            </label>
            <Button icon={<ShieldCheck className="size-4" aria-hidden />} loading={state.isLoading} disabled={!consent} onClick={() => void begin()}>
              Verify my business
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
