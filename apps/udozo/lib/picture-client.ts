import type { PictureKind } from "./picture-upload";

/**
 * Sends a prepared photo or cover to this site's own server (`app/api/account/picture/[kind]`), which stores it with
 * Udozo's signed link and sets it. Resolves to the new address; throws the message to show.
 */
export async function sendPicture(kind: PictureKind, picture: Blob, filename: string): Promise<string | null> {
  const form = new FormData();
  form.set("file", picture, filename);
  let res: Response;
  try {
    res = await fetch(`/api/account/picture/${kind}`, { method: "POST", body: form, credentials: "same-origin" });
  } catch {
    throw new Error("The picture could not be sent. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as { url?: string | null; error?: { message?: string } } | null;
  if (!res.ok) throw new Error(body?.error?.message ?? "The picture could not be saved. Try again.");
  return body?.url ?? null;
}
