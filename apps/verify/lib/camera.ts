/** Which camera: the back one for documents, the front one (a mirror-like preview) for the selfie and liveness. */
export type Facing = "environment" | "user";

/** Asks for a camera facing the right way, at a resolution good enough to read a document. No microphone, no torch. */
export function cameraConstraints(facing: Facing): MediaStreamConstraints {
  return {
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  };
}

/** The front camera's preview is mirrored, as people expect; photos never are. */
export const mirrored = (facing: Facing) => facing === "user";

export type CameraProblem = { title: string; help: string; canRetry: boolean };

/** Plain help for each way the camera can fail to start. */
export function cameraProblem(error: unknown, secure = true): CameraProblem {
  if (!secure) return { title: "The camera needs a secure page", help: "Open this page from the link you were sent (it starts with https).", canRetry: false };
  const name = (error as { name?: string } | null)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        title: "Camera access is blocked",
        help: "Allow the camera for this site, then try again. On iPhone: Settings > Safari > Camera > Allow (or tap “aA” in the address bar > Website Settings). On Android Chrome: tap the icon left of the address > Permissions > Camera > Allow.",
        canRetry: true,
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return { title: "No camera found", help: "Use a phone or a computer with a camera. You can also open the link on your phone.", canRetry: true };
    case "NotReadableError":
    case "AbortError":
      return { title: "The camera is busy", help: "Close other apps or tabs using the camera, then try again.", canRetry: true };
    case "Unsupported":
      return { title: "This browser cannot use the camera", help: "Open the link in an up-to-date Chrome, Safari, Firefox or Edge.", canRetry: false };
    default:
      return { title: "The camera did not start", help: "Try again. If it keeps failing, restart your browser or open the link on another device.", canRetry: true };
  }
}

export const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Liveness: three frames, about 400 ms apart, after a 3-second countdown. */
export const burst = { frames: 3, intervalMs: 400, countdown: 3 } as const;
