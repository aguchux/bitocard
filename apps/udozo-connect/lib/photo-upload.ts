import "server-only";
import type { Application, PhotoKind } from "./connect";
import { photoKinds } from "./connect";
import { customerApi } from "./session";

/**
 * A photo of the office sent through this site's own server, which runs the signed upload itself: it asks Udozo for
 * the signed link, sends the photo to storage with exactly the link's headers, then attaches it to the application.
 * The browser only ever talks to this site, so storage's CORS rule never matters.
 */

export type PhotoResult = { ok: true; application: Application } | { ok: false; status: number; message: string };
type UploadLink = { id: string; upload: { method?: string; url: string; headers?: Record<string, string> } };

export const photoTypes = ["image/jpeg", "image/png", "image/webp"];
/** What storage takes for an office photo (the API's own limit). */
export const photoLimit = 5 * 1024 * 1024;

export const isPhotoKind = (value: unknown): value is PhotoKind => typeof value === "string" && (photoKinds as readonly string[]).includes(value);

export async function storePhoto(applicationId: string, kind: PhotoKind, file: Blob, filename: string): Promise<PhotoResult> {
  if (!photoTypes.includes(file.type) || !file.size) return { ok: false, status: 400, message: "Choose a JPEG, PNG or WebP photo." };
  if (file.size > photoLimit) return { ok: false, status: 413, message: "That photo is too large. Choose a smaller one." };

  const base = `/v1/connect/applications/${encodeURIComponent(applicationId)}/photos`;
  const link = await customerApi<UploadLink>("POST", `${base}/uploads`, { filename: String(filename || `${kind}.jpg`).slice(0, 200), content_type: file.type, size: file.size });
  if (!link.ok) return { ok: false, status: link.status || 502, message: link.status === 401 ? "Sign in again to carry on." : link.message };
  const { id, upload } = link.data;
  if (!/^https:\/\//.test(upload.url) && process.env.NODE_ENV === "production") return { ok: false, status: 502, message: "The photo could not be stored. Try again." };

  let stored: Response;
  try {
    stored = await fetch(upload.url, { method: upload.method ?? "PUT", headers: upload.headers ?? {}, body: Buffer.from(await file.arrayBuffer()), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  } catch {
    return { ok: false, status: 502, message: "The photo could not be sent to storage. Try again shortly." };
  }
  if (!stored.ok) return { ok: false, status: 502, message: stored.status === 403 ? "The upload link was refused or has expired. Try again." : "The photo could not be stored. Try again." };

  const attached = await customerApi<Application>("POST", base, { media_id: id, kind });
  if (!attached.ok) return { ok: false, status: attached.status || 502, message: attached.message };
  return { ok: true, application: attached.data };
}
