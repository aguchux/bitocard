"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CameraOff, RotateCw } from "lucide-react";
import { Button } from "@bitocard/admin-ui";
import { type CameraProblem, cameraConstraints, cameraProblem, type Facing, mirrored } from "@/lib/camera";
import { grabFrame } from "@/lib/image";

export type Camera = {
  /** Give it to the <video> as its ref. */
  attach: (video: HTMLVideoElement | null) => void;
  facing: Facing;
  ready: boolean;
  problem: CameraProblem | null;
  retry: () => void;
  /** One frame as a JPEG (never mirrored). */
  grab: () => Promise<Blob>;
};

/** Puts a stream on the <video> (or takes it off) and plays it. */
async function show(video: HTMLVideoElement, stream: MediaStream | null) {
  video.srcObject = stream;
  if (stream) await video.play().catch(() => undefined);
}

/**
 * Starts a camera while the component is shown and stops every track when it goes (or the facing changes), so the
 * camera light never stays on. Nothing is recorded: frames are taken only when `grab` is called.
 */
export function useCamera(facing: Facing): Camera {
  const [video, attach] = useState<HTMLVideoElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<CameraProblem | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!video) return;
    const start = async () => {
      if (!window.isSecureContext) throw Object.assign(new Error("insecure"), { name: "Insecure" });
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("unsupported"), { name: "Unsupported" });
      const media = await navigator.mediaDevices.getUserMedia(cameraConstraints(facing));
      if (cancelled) {
        media.getTracks().forEach(track => track.stop());
        return;
      }
      stream = media;
      await show(video, media);
      setReady(true);
    };
    start().catch((error: unknown) => {
      if (cancelled) return;
      setProblem(cameraProblem(error, (error as { name?: string })?.name !== "Insecure"));
    });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach(track => track.stop());
      void show(video, null);
      setReady(false);
    };
  }, [video, facing, attempt]);

  return {
    attach,
    facing,
    ready,
    problem,
    retry: () => {
      setProblem(null);
      setAttempt(value => value + 1);
    },
    grab: () => (video ? grabFrame(video) : Promise.reject(new Error("The camera is not ready yet."))),
  };
}

/** A card-shaped frame for ID documents, an A4 page for business documents, an oval for a face. */
export type Guide = "card" | "page" | "oval";

function GuideOverlay({ guide }: { guide: Guide }) {
  if (guide === "oval") {
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        {/* Dims everything outside the oval. */}
        <div className="aspect-[3/4] h-[78%] rounded-[50%] border-4 border-white/90 shadow-[0_0_0_9999px_rgb(4_9_53/0.45)]" />
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center p-5">
      <div className={guide === "card" ? "relative aspect-[1.586/1] w-[88%]" : "relative aspect-[1/1.414] h-[88%]"}>
        <div className="absolute inset-0 rounded-xl shadow-[0_0_0_9999px_rgb(4_9_53/0.45)]" />
        {(["left-0 top-0 rounded-tl-xl border-l-4 border-t-4", "right-0 top-0 rounded-tr-xl border-r-4 border-t-4", "bottom-0 left-0 rounded-bl-xl border-b-4 border-l-4", "bottom-0 right-0 rounded-br-xl border-b-4 border-r-4"] as const).map(corner => (
          <span key={corner} className={`absolute size-9 border-brand-500 ${corner}`} />
        ))}
      </div>
    </div>
  );
}

/** The live preview with its guide; `overlay` shows instructions or a countdown on top. */
export function CameraView({ attach, facing, ready, problem, retry, guide, label, overlay }: Omit<Camera, "grab"> & { guide: Guide; label: string; overlay?: ReactNode }) {
  if (problem) {
    return (
      <div role="alert" className="grid gap-3 rounded-2xl border border-line bg-white p-5 text-center">
        <CameraOff className="mx-auto size-8 text-muted" aria-hidden />
        <p className="font-semibold text-ink">{problem.title}</p>
        <p className="text-sm text-muted">{problem.help}</p>
        {problem.canRetry ? (
          <Button variant="secondary" icon={<RotateCw className="size-4" aria-hidden />} onClick={retry} className="mx-auto">
            Try again
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-navy-950 ${guide === "oval" ? "aspect-[3/4]" : guide === "page" ? "aspect-[3/4]" : "aspect-[4/3]"}`}>
      <video
        ref={attach}
        aria-label={label}
        autoPlay
        muted
        playsInline
        className="size-full object-cover"
        style={mirrored(facing) ? { transform: "scaleX(-1)" } : undefined}
      />
      <GuideOverlay guide={guide} />
      {overlay ? <div className="absolute inset-x-0 bottom-0 p-3">{overlay}</div> : null}
      {!ready ? <div className="absolute inset-0 grid place-items-center bg-navy-950/70 text-sm font-semibold text-white">Starting the camera…</div> : null}
    </div>
  );
}
