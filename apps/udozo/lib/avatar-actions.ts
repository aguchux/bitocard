"use server";

import { revalidatePath } from "next/cache";
import { customerApi } from "@/lib/customer";

/** What a profile photo step answers: its data, or the API's message. */
export type AvatarResult<T> = { ok: true; data: T } | { ok: false; message: string };
export type AvatarUploadLink = { id: string; upload: { method: "PUT"; url: string; headers: Record<string, string> } };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const types = ["image/png", "image/jpeg", "image/webp"];

/** A signed link for the browser to send the prepared photo straight to storage (10 minutes). */
export async function startAvatarUpload(file: { filename: string; content_type: string; size: number }): Promise<AvatarResult<AvatarUploadLink>> {
  if (!types.includes(file.content_type) || !(file.size > 0)) return { ok: false, message: "Choose a JPEG, PNG or WebP picture." };
  const result = await customerApi<AvatarUploadLink>("POST", "/v1/store/account/avatar/uploads", { filename: String(file.filename).slice(0, 200) || "photo.jpg", content_type: file.content_type, size: file.size });
  return result.ok ? { ok: true, data: { id: result.data.id, upload: result.data.upload } } : { ok: false, message: result.status === 401 ? "Sign in again to carry on." : result.message };
}

/** Once it is in storage: the API checks it and makes it the customer's photo, everywhere they are shown. */
export async function setAvatar(mediaId: string): Promise<AvatarResult<{ avatar_url: string | null }>> {
  if (!uuid.test(mediaId)) return { ok: false, message: "That upload could not be found. Try again." };
  const result = await customerApi<{ avatar_url: string | null }>("POST", "/v1/store/account/avatar", { media_id: mediaId });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/", "layout");
  return { ok: true, data: { avatar_url: result.data.avatar_url } };
}

/** Takes the photo off: their initials show again. */
export async function removeAvatar(): Promise<AvatarResult<{ avatar_url: null }>> {
  const result = await customerApi<{ avatar_url: null }>("DELETE", "/v1/store/account/avatar");
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/", "layout");
  return { ok: true, data: { avatar_url: null } };
}
