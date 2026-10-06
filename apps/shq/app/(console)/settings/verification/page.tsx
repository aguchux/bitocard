"use client";

import { useState } from "react";
import { ExternalLink, RotateCw, ShieldCheck } from "lucide-react";
import { Button, Card, CardHeader, errorMessage, formatDateTime, KeyValue, Notice, PageHeader, QueryView, Skeleton, StatusBadge } from "@bitocard/admin-ui";
import { type Verification, useAccountVerificationQuery, useStartAccountVerificationMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { useReseller } from "@/components/reseller";

const reasons: Record<string, string> = {
  not_verified: "The check could not confirm your identity. Make sure your document is valid and clearly visible, then try again.",
  name_mismatch: "The name on your document did not match the name on your account.",
  bvn_consent_declined: "Sharing your BVN record was declined.",
  expired: "The check was not finished in time. Start a new one.",
};

/** The identity provider's page, on another site. */
function goTo(url: string) {
  window.location.assign(new URL(url).href);
}

function Outcome({ check }: { check: Verification }) {
  if (check.verified) {
    return (
      <Notice tone="green" title="Your identity is verified">
        {check.reseller_status === "active"
          ? "Your account is active."
          : check.reseller_status === "pending"
            ? "BitoCard is reviewing your account before it goes live. We will email you."
            : "Your account is suspended. Contact support."}
      </Notice>
    );
  }
  switch (check.status) {
    case "in_progress":
      return <Notice tone="blue" title="Check in progress">If you have finished the check, the result can take a few minutes to arrive. Otherwise, continue where you left off.</Notice>;
    case "in_review":
      return <Notice tone="amber" title="Being reviewed">Your check needs a closer look by our team. We will email you the outcome.</Notice>;
    case "declined":
      return <Notice tone="red" title="Check not passed">{reasons[check.reason ?? "not_verified"] ?? reasons.not_verified} You can start a new check.</Notice>;
    case "expired":
      return <Notice tone="grey" title="Check expired">{reasons.expired}</Notice>;
    default:
      return <Notice tone="amber" title="Not started">The business owner needs to complete an identity check before your account can take live orders.</Notice>;
  }
}

function StartCheck({ check }: { check: Verification }) {
  const [consent, setConsent] = useState(false);
  const [start, state] = useStartAccountVerificationMutation();
  const resume = check.status === "in_progress" ? check.url : null;

  const begin = async () => {
    const result = await start({ consent: true })
      .unwrap()
      .catch(() => null);
    if (result?.url) goTo(result.url);
  };

  if (resume) {
    return (
      <Button icon={<ExternalLink className="size-4" aria-hidden />} onClick={() => goTo(resume)}>
        Continue the check
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 text-sm text-ink">
        <p className="font-semibold">What happens</p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>You go to our identity partner&apos;s secure page to photograph your ID document and take a selfie.</li>
          <li>Your selfie is compared with the photo on your document. This face check uses biometric data, which is sensitive personal data.</li>
          <li>BitoCard keeps only the outcome, your verified name and your document&apos;s country, never the images or document number.</li>
        </ul>
      </div>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <label className="flex items-start gap-3 rounded-xl border border-line p-4 text-sm">
        <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand-500" />
        <span>I agree to the identity check, including the face check that uses my biometric data, as described in the privacy notice.</span>
      </label>
      <Button icon={<ShieldCheck className="size-4" aria-hidden />} loading={state.isLoading} disabled={!consent} onClick={begin}>
        Start the identity check
      </Button>
    </div>
  );
}

/** The business owner's identity check, needed before the account goes live. */
export default function VerificationPage() {
  const { membership } = useReseller();
  const owner = membership.role === "owner";
  const verification = useAccountVerificationQuery();
  const { isFetching, refetch } = verification;

  return (
    <ShqShell
      section="settings"
      current="/settings/verification"
      crumbs={[{ label: "Settings", href: "/settings" }, { label: "Identity check" }]}
      actions={
        <Button size="sm" variant="ghost" icon={<RotateCw className="size-4" aria-hidden />} loading={isFetching} onClick={refetch}>
          Refresh
        </Button>
      }
    >
      <PageHeader title="Identity check" description="We verify the business owner before the account can take live orders." />
      <QueryView query={verification} message={error => errorMessage(error, "Could not load your identity check.")} loading={<Skeleton className="h-64 w-full" />}>
        {data => (
          <Card>
            <CardHeader title="Status" actions={<StatusBadge status={data.verified ? "approved" : data.status} />} />
            <div className="space-y-5 p-5 sm:p-6">
              <Outcome check={data} />
              <KeyValue
                items={[
                  { label: "Account", value: <StatusBadge status={data.reseller_status} /> },
                  { label: data.verified ? "Verified" : "Started", value: formatDateTime(data.verified ? data.verified_at : data.started_at) },
                ]}
              />
              {owner && !data.verified && data.status !== "in_review" ? (
                <StartCheck check={data} />
              ) : !owner && !data.verified ? (
                <Notice tone="grey">Only the business owner can take the identity check.</Notice>
              ) : null}
            </div>
          </Card>
        )}
      </QueryView>
    </ShqShell>
  );
}
