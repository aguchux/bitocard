import "server-only";
import { revalidatePath } from "next/cache";
import { customerApi } from "./customer";

/**
 * A profile photo or cover saved through this site's own server, which runs the signed upload itself: it asks Udozo
 * for the signed link, sends the prepared picture to storage with exactly the link's headers, then asks Udozo to check
 * it and set it. The browser only ever talks to this site, so storage's CORS rule never matters, and the answer carries
 * the new address so the page shows it at once.
 */

export type PictureKind = "avatar" | "banner";
export const pictureKinds: readonly PictureKind[] = ["avatar", "banner"];
export type PictureResult = { ok: true; url: string | null } | { ok: false; status: number; message: string };

type UploadLink = { id: string; upload: { method: "PUT"; url: string; headers: Record<string, string> } };

const types = ["image/png", "image/jpeg", "image/webp"];
/** What storage takes for each (the API's own limits: 2 MB a photo, 3 MB a cover). */
export const pictureLimits: Record<PictureKind, number> = { avatar: 2 * 1024 * 1024, banner: 3 * 1024 * 1024 };
const words: Record<PictureKind, string> = { avatar: "photo", banner: "cover" };

export async function storePicture(kind: PictureKind, file: Blob, filename: string): Promise<PictureResult> {
  const word = words[kind];
  if (!types.includes(file.type) || !file.size) return { ok: false, status: 400, message: "Choose a JPEG, PNG or WebP picture." };
  if (file.size > pictureLimits[kind]) return { ok: false, status: 413, message: `That ${word} is too large. Choose a smaller picture.` };

  const name = String(filename || `${word}.jpg`).slice(0, 200);
  const link = await customerApi<UploadLink>("POST", `/v1/store/account/${kind}/uploads`, { filename: name, content_type: file.type, size: file.size });
  if (!link.ok) return { ok: false, status: link.status || 502, message: link.status === 401 ? "Sign in again to carry on." : link.message };
  const { id, upload } = link.data;
  if (!/^https:\/\//.test(upload.url) && process.env.NODE_ENV === "production") return { ok: false, status: 502, message: `The ${word} could not be stored. Try again.` };

  let stored: Response;
  try {
    stored = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: Buffer.from(await file.arrayBuffer()), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  } catch {
    return { ok: false, status: 502, message: `The ${word} could not be sent to storage. Try again shortly.` };
  }
  if (!stored.ok) return { ok: false, status: 502, message: stored.status === 403 ? "The upload link was refused or has expired. Try again." : `The ${word} could not be stored. Try again.` };

  const set = await customerApi<Record<string, string | null>>("POST", `/v1/store/account/${kind}`, { media_id: id });
  if (!set.ok) return { ok: false, status: set.status || 502, message: set.message };
  revalidatePath("/", "layout");
  return { ok: true, url: set.data[`${kind}_url`] ?? null };
}
