"use client";

import { useState } from "react";
import { CheckCircle2, ScanFace } from "lucide-react";
import { Button, Notice } from "@bitocard/admin-ui";
import type { KycCase } from "@bitocard/api-client/kyc";
import { CameraView, useCamera } from "@/components/camera";
import { burst, wait } from "@/lib/camera";
import { reloadCase, saveStep, uploadDocument } from "@/lib/client";
import { livenessKind } from "@/lib/documents";

type Phase = { name: "ready" } | { name: "countdown"; value: number } | { name: "capturing" } | { name: "uploading" } | { name: "done" };

/**
 * Liveness: the front camera (mirrored preview, oval guide) and two random instructions from the API. For each, a short
 * countdown, then three frames a moment apart while the applicant moves, uploaded as `liveness_<step>_<frame>`. Camera
 * only: no file can stand in for it. A person at BitoCard (or the store's business) looks at the frames.
 */
function Capture({ kase, onSaved }: { kase: KycCase; onSaved: (kase: KycCase) => void }) {
  const camera = useCamera("user");
  const steps = kase.liveness?.steps ?? [];
  const frames = kase.liveness?.frames_per_step ?? burst.frames;
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>({ name: "ready" });
  const [error, setError] = useState<string | null>(null);
  const step = steps[index];

  const run = async () => {
    setError(null);
    for (let value = burst.countdown; value > 0; value--) {
      setPhase({ name: "countdown", value });
      await wait(1000);
    }
    setPhase({ name: "capturing" });
    const shots: Blob[] = [];
    try {
      for (let frame = 0; frame < frames; frame++) {
        shots.push(await camera.grab());
        if (frame < frames - 1) await wait(burst.intervalMs);
      }
    } catch (failure) {
      setPhase({ name: "ready" });
      setError(failure instanceof Error ? failure.message : "The photos could not be taken. Try again.");
      return;
    }
    setPhase({ name: "uploading" });
    for (const [frame, shot] of shots.entries()) {
      const result = await uploadDocument(livenessKind(index, frame), shot);
      if (!result.ok) {
        setPhase({ name: "ready" });
        setError(result.message);
        return;
      }
    }
    if (index < steps.length - 1) {
      setIndex(index + 1);
      setPhase({ name: "ready" });
      return;
    }
    setPhase({ name: "done" });
    const latest = await reloadCase();
    if (latest.ok) onSaved(latest.case);
    else setError(latest.message);
  };

  const overlay =
    phase.name === "countdown" ? (
      <p className="rounded-xl bg-navy-950/80 p-3 text-center text-white">
        <span className="block text-lg font-bold">{step?.label}</span>
        <span className="block text-4xl font-extrabold tabular-nums" aria-live="assertive">
          {phase.value}
        </span>
      </p>
    ) : phase.name === "capturing" ? (
      <p className="rounded-xl bg-brand-600/90 p-3 text-center text-lg font-bold text-white" aria-live="assertive">
        {`${step?.label}: keep going…`}
      </p>
    ) : step && phase.name === "ready" ? (
      <p className="rounded-xl bg-navy-950/80 p-3 text-center text-lg font-bold text-white">{step.label}</p>
    ) : null;

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-muted" aria-live="polite">{`Movement ${Math.min(index + 1, steps.length)} of ${steps.length}`}</p>
      <CameraView {...camera} guide="oval" label="Front camera for the liveness check" overlay={overlay} />
      {error ? <Notice tone="red">{error}</Notice> : null}
      {phase.name === "done" ? (
        <p className="flex items-center gap-2 font-semibold text-emerald-700">
          <CheckCircle2 className="size-5" aria-hidden /> Done
        </p>
      ) : camera.problem ? null : (
        <Button className="min-h-12 w-full text-base" icon={<ScanFace className="size-5" aria-hidden />} disabled={!camera.ready || phase.name !== "ready"} loading={phase.name === "uploading"} onClick={() => void run()}>
          {phase.name === "ready" ? (index === 0 ? "I’m ready" : "Next movement") : phase.name === "uploading" ? "Sending…" : "Hold on…"}
        </Button>
      )}
    </div>
  );
}

export function LivenessStep({ kase, onSaved }: { kase: KycCase; onSaved: (kase: KycCase) => void }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  if (kase.liveness?.steps.length && started) return <Capture kase={kase} onSaved={onSaved} />;

  return (
    <div className="space-y-4">
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        <li>We will ask you to make two simple movements, such as turning your head or smiling.</li>
        <li>Keep your face inside the oval, in good light, with nothing covering it (no hat, mask or sunglasses).</li>
        <li>Three photos are taken during each movement. Nothing is recorded in between.</li>
      </ul>
      {error ? <Notice tone="red">{error}</Notice> : null}
      <Button
        className="min-h-12 w-full text-base"
        icon={<ScanFace className="size-5" aria-hidden />}
        loading={starting}
        onClick={async () => {
          setError(null);
          if (!kase.liveness?.steps.length) {
            setStarting(true);
            const result = await saveStep("liveness");
            setStarting(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            onSaved(result.case);
          }
          setStarted(true);
        }}
      >
        Start the liveness check
      </Button>
    </div>
  );
}
