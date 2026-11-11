"use client";

import { useEffect, useRef, useState } from "react";

type Detector = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
};
type DetectorClass = new (options: { formats: string[] }) => Detector;

/** The barcodes products carry: EAN and UPC on goods, Code 128 and 39 on shop labels, QR on some. */
const formats = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf",
  "qr_code",
];

/** What the scanner says when the camera cannot start, in words. */
export function cameraProblem(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "The camera is blocked for pos.udozo.com. Allow it in your browser's site settings (the lock or settings icon by the address), then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No camera was found on this device. Use a barcode scanner or type the code.";
  if (name === "NotReadableError")
    return "Another app is using the camera. Close it, then try again.";
  return "The camera could not start. Use a barcode scanner or type the code.";
}

/**
 * Scanning a barcode with the device's camera, in a dialog: the browser's own `BarcodeDetector` where it has one
 * (Chrome, Edge, Android), else zxing (Safari on iPhone, Firefox), loaded only when needed. The first code read is
 * handed back and the camera stops; closing stops it too.
 */
export function CameraScan({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const element = dialog.current;
    if (element && typeof element.showModal === "function" && !element.open)
      element.showModal();
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopZxing: (() => void) | null = null;
    let cancelled = false;
    const found = (code: string) => {
      if (done.current || !code.trim()) return;
      done.current = true;
      onCode(code.trim());
    };

    (async () => {
      try {
        const native = (globalThis as { BarcodeDetector?: DetectorClass })
          .BarcodeDetector;
        if (native && video.current) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });
          if (cancelled) return;
          video.current.srcObject = stream;
          await video.current.play();
          const detector = new native({ formats });
          const look = async () => {
            if (cancelled || done.current || !video.current) return;
            try {
              const [code] = await detector.detect(video.current);
              if (code?.rawValue) return found(code.rawValue);
            } catch {
              // A frame the detector could not read: look again.
            }
            timer = setTimeout(look, 200);
          };
          void look();
        } else if (video.current) {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          if (cancelled) return;
          const controls =
            await new BrowserMultiFormatReader().decodeFromConstraints(
              { video: { facingMode: { ideal: "environment" } }, audio: false },
              video.current,
              (result) => {
                if (result) found(result.getText());
              },
            );
          stopZxing = () => controls.stop();
          if (cancelled) stopZxing();
        }
      } catch (error) {
        if (!cancelled) setProblem(cameraProblem(error));
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stopZxing?.();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onCode]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="scan-title"
      onCancel={onClose}
      className="m-auto w-[min(100%-2rem,32rem)] rounded-[20px] p-0 backdrop:bg-black/60"
    >
      <div className="grid gap-3 p-4">
        <h2
          id="scan-title"
          className="font-display text-xl font-bold text-pos-ink"
        >
          Scan a barcode
        </h2>
        {problem ? (
          <p
            role="alert"
            className="rounded-xl bg-pos-warn-bg p-3 text-sm font-semibold text-pos-warn"
          >
            {problem}
          </p>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video
                ref={video}
                muted
                playsInline
                className="aspect-[4/3] w-full object-cover"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-pos-500/90"
              />
            </div>
            <p className="text-sm text-pos-ink-2">
              Hold the barcode inside the picture, steady and well lit. It is
              added as soon as it is read.
            </p>
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          className="h-12 rounded-xl border border-pos-line font-bold"
        >
          Close
        </button>
      </div>
    </dialog>
  );
}
