"use client";

import { useEffect, useId, useState } from "react";
import { Camera as CameraIcon, CheckCircle2, FileText, RotateCcw, Upload } from "lucide-react";
import { Button, Notice } from "@bitocard/admin-ui";
import type { KycCase } from "@bitocard/api-client/kyc";
import { CameraView, type Guide, useCamera } from "@/components/camera";
import type { Facing } from "@/lib/camera";
import { uploadDocument } from "@/lib/client";
import { acceptedTypes, uploadProblem } from "@/lib/documents";
import { compressImage, isPhoto } from "@/lib/image";

type Chosen = { blob: Blob; name: string; url: string | null };

/** The camera with its guide and a shutter; the photo comes back for checking before it is used. */
function Shutter({ facing, guide, label, onTaken }: { facing: Facing; guide: Guide; label: string; onTaken: (blob: Blob) => void }) {
  const camera = useCamera(facing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <CameraView {...camera} guide={guide} label={label} />
      {error ? <Notice tone="red">{error}</Notice> : null}
      {!camera.problem ? (
        <Button
          className="min-h-12 w-full text-base"
          icon={<CameraIcon className="size-5" aria-hidden />}
          disabled={!camera.ready}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              onTaken(await camera.grab());
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "The photo could not be taken.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Take the photo
        </Button>
      ) : null}
    </div>
  );
}

/**
 * One photo or document for the case. Documents can be photographed (back camera, with a guide) or uploaded; the
 * selfie is camera only, so a saved picture of someone else cannot be used. Photos are made smaller and stripped of
 * their metadata before upload, and shown for checking first.
 */
export function PhotoStep({
  kase,
  kind,
  facing,
  guide,
  upload,
  camera = true,
  tips,
  onSaved,
}: {
  kase: KycCase;
  kind: string;
  facing: Facing;
  guide: Guide;
  /** Allow choosing a file (documents only, never the selfie or liveness). */
  upload: boolean;
  camera?: boolean;
  tips: string[];
  onSaved: (kase: KycCase) => void;
}) {
  const id = useId();
  const existing = kase.documents.find(document => document.kind === kind);
  const [mode, setMode] = useState<"start" | "camera">(camera && !upload ? "camera" : "start");
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => () => {
    if (chosen?.url) URL.revokeObjectURL(chosen.url);
  }, [chosen]);

  const choose = async (blob: Blob, name: string) => {
    setError(null);
    const ready = isPhoto(blob.type) ? await compressImage(blob) : blob;
    const problem = uploadProblem(kind, ready);
    if (problem) {
      setError(problem.message);
      return;
    }
    setChosen({ blob: ready, name, url: ready.type.startsWith("image/") ? URL.createObjectURL(ready) : null });
  };

  const save = async () => {
    if (!chosen) return;
    setSaving(true);
    setError(null);
    const result = await uploadDocument(kind, chosen.blob, chosen.blob.type === "image/jpeg" ? `${kind}.jpg` : chosen.name);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setChosen(null);
    setMode("start");
    onSaved(result.case);
  };

  if (chosen) {
    return (
      <div className="space-y-4">
        <div className="overflow-hidden rounded-2xl border border-line bg-white">
          {chosen.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview of the applicant's own photo
            <img src={chosen.url} alt="Your photo, to check before sending" className="max-h-[60vh] w-full object-contain" />
          ) : (
            <p className="flex items-center gap-3 p-5 text-sm font-semibold">
              <FileText className="size-6 text-brand-600" aria-hidden />
              {chosen.name}
            </p>
          )}
        </div>
        <p className="text-sm text-muted">Is everything sharp and readable, with no glare and all four corners in view?</p>
        {error ? <Notice tone="red">{error}</Notice> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button className="min-h-12 text-base" loading={saving} onClick={save}>
            Use this
          </Button>
          <Button variant="secondary" className="min-h-12 text-base" icon={<RotateCcw className="size-4" aria-hidden />} disabled={saving} onClick={() => setChosen(null)}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        {tips.map(tip => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
      {existing ? (
        <Notice tone="green" title="Received">
          You can replace it, or continue.
        </Notice>
      ) : null}
      {error ? <Notice tone="red">{error}</Notice> : null}
      {mode === "camera" ? (
        <Shutter facing={facing} guide={guide} label={`Camera for ${kind.replace(/_/g, " ")}`} onTaken={blob => void choose(blob, `${kind}.jpg`)} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {camera ? (
            <Button className="min-h-12 text-base" icon={<CameraIcon className="size-5" aria-hidden />} onClick={() => setMode("camera")}>
              Use the camera
            </Button>
          ) : null}
          {upload ? (
            <label htmlFor={`${id}-file`} className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 text-base font-semibold text-ink hover:bg-canvas focus-within:outline focus-within:outline-3 focus-within:outline-brand-500">
              <Upload className="size-5" aria-hidden />
              Upload a file
              <input
                id={`${id}-file`}
                type="file"
                accept={acceptedTypes(kind).join(",")}
                className="sr-only"
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void choose(file, file.name);
                }}
              />
            </label>
          ) : null}
        </div>
      )}
      {mode === "camera" && upload ? (
        <button type="button" className="text-sm font-semibold text-brand-600 hover:underline" onClick={() => setMode("start")}>
          Upload a file instead
        </button>
      ) : null}
      {existing && mode === "start" ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="size-4" aria-hidden /> Saved
        </p>
      ) : null}
    </div>
  );
}
