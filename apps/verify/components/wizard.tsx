"use client";

import { useState } from "react";
import { ArrowLeft, CheckCircle2, Clock, RotateCcw, Send, XCircle } from "lucide-react";
import { Button, Notice } from "@bitocard/admin-ui";
import { type KycCase, type KycDeclineReason, kycDeclineReasons, kycItemLabels } from "@bitocard/api-client/kyc";
import { BusinessStep, ConsentStep, IdentityStep } from "@/components/forms";
import { LivenessStep } from "@/components/liveness-step";
import { PhotoStep } from "@/components/photo-step";
import { saveStep } from "@/lib/client";
import { chosenIdType, currentStep, neighbours, pendingItems, planSteps, progress, type StepKey, stepTitles } from "@/lib/steps";
import { brand } from "@/lib/brand";

/** "Back to Ada Gifts", where the applicant came from. */
function BackLink({ kase, primary }: { kase: KycCase; primary?: boolean }) {
  if (!kase.return_url) return null;
  return (
    <a
      href={kase.return_url}
      className={
        primary
          ? "inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-navy-900 px-5 text-base font-semibold text-white hover:bg-navy-800"
          : "inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted hover:text-ink"
      }
    >
      {primary ? null : <ArrowLeft className="size-4" aria-hidden />}
      {`Back to ${kase.brand.name}`}
    </a>
  );
}

/** After sending: in review, approved, declined (with the reason and note), or what to redo. */
function StatusView({ kase }: { kase: KycCase }) {
  const view = {
    submitted: { icon: Clock, tone: "text-amber-600", title: "We’re reviewing it", text: "A person is checking your documents. This usually takes less than a working day. We will email you the outcome; you can close this page." },
    approved: { icon: CheckCircle2, tone: "text-emerald-600", title: "You’re verified", text: "Your identity has been confirmed. You can go back and carry on." },
    declined: { icon: XCircle, tone: "text-red-600", title: "Your check was not approved", text: "You can go back and start a new check." },
    draft: { icon: Clock, tone: "text-muted", title: "Not sent yet", text: "" },
    resubmit: { icon: RotateCcw, tone: "text-blue-600", title: "Some things need redoing", text: "" },
  }[kase.status];
  return (
    <div className="space-y-5 text-center">
      <view.icon className={`mx-auto size-12 ${view.tone}`} aria-hidden />
      <h2 className="text-2xl font-extrabold tracking-tight">{view.title}</h2>
      {view.text ? <p className="text-muted">{view.text}</p> : null}
      {kase.status === "declined" ? (
        <Notice tone="red" title={kase.reason_text ?? (kase.reason ? (kycDeclineReasons[kase.reason as KycDeclineReason] ?? "Not approved") : "Not approved")}>
          {kase.note ? <span className="whitespace-pre-line">{kase.note}</span> : brand.key === "bitocard" ? "If you think this is a mistake, contact the store or BitoCard support." : `If you think this is a mistake, contact ${brand.name} support.`}
        </Notice>
      ) : null}
      <BackLink kase={kase} primary />
    </div>
  );
}

function ReviewStep({ kase, onSaved, onEdit }: { kase: KycCase; onSaved: (kase: KycCase) => void; onEdit: (step: StepKey) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const plan = planSteps(kase).filter((step): step is Exclude<StepKey, "review" | "status"> => step !== "review" && step !== "status");
  const pending = pendingItems(kase);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Check everything is there, then send it for review. You cannot change it while it is being reviewed.</p>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
        {plan.map(step => (
          <li key={step} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              {pending.includes(step) ? <span className="size-4 rounded-full border-2 border-amber-500" aria-hidden /> : <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />}
              {kycItemLabels[step] ?? stepTitles[step]}
              <span className="sr-only">{pending.includes(step) ? "(still to do)" : "(done)"}</span>
            </span>
            {step !== "consent" ? (
              <button type="button" className="text-sm font-semibold text-brand-600 hover:underline" onClick={() => onEdit(step)}>
                {pending.includes(step) ? "Do it" : "Change"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <Notice tone="red">{error}</Notice> : null}
      <Button
        className="min-h-12 w-full text-base"
        icon={<Send className="size-5" aria-hidden />}
        disabled={pending.length > 0}
        loading={sending}
        onClick={async () => {
          setSending(true);
          setError(null);
          const result = await saveStep("submit");
          setSending(false);
          if (result.ok) onSaved(result.case);
          else setError(result.message);
        }}
      >
        Send for review
      </Button>
    </div>
  );
}

const documentTips = ["Use the original document, not a photocopy or a screen.", "Lay it flat in good light, with no glare or shadows.", "All four corners in the frame, and the text sharp."];

/**
 * The applicant's wizard: one step per screen, resumed from what the case still needs (or only what the reviewer asked
 * to redo), then the status once sent.
 */
export function Wizard({ initial, privacyUrl }: { initial: KycCase; privacyUrl: string | null }) {
  const [kase, setKase] = useState(initial);
  // What the applicant saved again during this visit, for a resubmission's items without a document of their own.
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set());
  const [viewing, setViewing] = useState<StepKey | null>(null);
  const plan = planSteps(kase);
  const resume = currentStep(kase, saved);
  const step = viewing && plan.includes(viewing) ? viewing : resume;
  const { previous } = neighbours(plan, step);
  const { number, total, percent } = progress(plan, step);
  const pending = pendingItems(kase, saved);
  const top = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const onSaved = (next: KycCase) => {
    // Liveness counts as redone only from its new frames (`redone`), never from being issued new steps.
    if (step !== "liveness") setSaved(current => new Set([...current, step]));
    setKase(next);
    setViewing(null);
    top();
  };
  const go = (target: StepKey | null) => {
    setViewing(target);
    top();
  };

  if (step === "status") {
    return (
      <section className="rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8">
        <StatusView kase={kase} />
      </section>
    );
  }

  const idType = chosenIdType(kase);
  let body: React.ReactNode;
  switch (step) {
    case "consent":
      body = <ConsentStep kase={kase} privacyUrl={privacyUrl} onSaved={onSaved} />;
      break;
    case "business":
      body = <BusinessStep kase={kase} onSaved={onSaved} />;
      break;
    case "business_registration":
      body = <PhotoStep key={step} kase={kase} kind={step} facing="environment" guide="page" upload tips={["The certificate of incorporation or business name registration.", "A PDF, or a clear photo of the whole page.", ...documentTips.slice(1, 2)]} onSaved={onSaved} />;
      break;
    case "business_address":
      body = <PhotoStep key={step} kase={kase} kind={step} facing="environment" guide="page" upload tips={["A utility bill, bank statement or tenancy agreement in the business’s name.", "Dated within the last three months, showing the address you gave.", "A PDF, or a clear photo of the whole page."]} onSaved={onSaved} />;
      break;
    case "business_directors":
      body = <PhotoStep key={step} kase={kase} kind={step} facing="environment" guide="page" upload tips={["An official document naming the directors or owners (for example the CAC status report or Form CAC 7).", "A PDF, or a clear photo of every page in one file."]} onSaved={onSaved} />;
      break;
    case "identity":
      body = <IdentityStep kase={kase} onSaved={onSaved} />;
      break;
    case "id_front":
      body = <PhotoStep key={step} kase={kase} kind={step} facing="environment" guide="card" upload tips={[`The front of your ${idType?.label ?? "ID"}, with your photo.`, ...documentTips]} onSaved={onSaved} />;
      break;
    case "id_back":
      body = <PhotoStep key={step} kase={kase} kind={step} facing="environment" guide="card" upload tips={[`Turn your ${idType?.label ?? "ID"} over and photograph the back.`, ...documentTips.slice(1)]} onSaved={onSaved} />;
      break;
    case "selfie":
      body = (
        <PhotoStep
          key={step}
          kase={kase}
          kind={step}
          facing="user"
          guide="oval"
          upload={false}
          tips={["Face the camera with your face inside the oval.", "Good light on your face, nothing covering it (no hat, mask or sunglasses).", "Only you in the picture."]}
          onSaved={onSaved}
        />
      );
      break;
    case "liveness":
      body = <LivenessStep kase={kase} onSaved={onSaved} />;
      break;
    default:
      body = <ReviewStep kase={kase} onSaved={onSaved} onEdit={go} />;
  }

  return (
    <div className="space-y-4">
      {kase.status === "resubmit" ? (
        <Notice tone="blue" title="Please redo a few things">
          <span className="block">{`Asked for: ${kase.resubmit_items.map(item => kycItemLabels[item] ?? item).join(", ")}.`}</span>
          {kase.note ? <span className="mt-1 block whitespace-pre-line">{kase.note}</span> : null}
        </Notice>
      ) : null}
      <div>
        <div className="flex items-center justify-between text-xs font-semibold text-muted">
          <span>{`Step ${number} of ${total}`}</span>
          <span>{stepTitles[step]}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-navy-100" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={number}>
          <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <section className="rounded-3xl border border-line bg-white p-5 shadow-card sm:p-8">
        <h1 className="mb-4 text-2xl font-extrabold tracking-tight">{stepTitles[step]}</h1>
        {body}
        {step !== "review" && step !== "consent" && !pending.includes(step) ? (
          <Button variant="ghost" className="mt-3 w-full" onClick={() => go(neighbours(plan, step).next)}>
            Keep what I sent and continue
          </Button>
        ) : null}
      </section>
      <div className="flex items-center justify-between">
        {previous && previous !== "consent" ? (
          <button type="button" onClick={() => go(previous)} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Back
          </button>
        ) : (
          <span />
        )}
        <BackLink kase={kase} />
      </div>
    </div>
  );
}
