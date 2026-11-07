"use server";

import { revalidatePath } from "next/cache";
import { customerApi } from "@/lib/customer";

/** What a profile photo step answers: its data, or the API's message. */
export type AvatarResult<T> = { ok: true; data: T } | { ok: false; message: string };

// Saving a photo or cover goes through `lib/picture-upload.ts` (this site's server runs Udozo's signed upload).

/** Takes the photo off: their initials show again. */
export async function removeAvatar(): Promise<AvatarResult<{ avatar_url: null }>> {
  const result = await customerApi<{ avatar_url: null }>("DELETE", "/v1/store/account/avatar");
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/", "layout");
  return { ok: true, data: { avatar_url: null } };
}

/** Takes the cover off: Udozo's own banner shows again. */
export async function removeBanner(): Promise<AvatarResult<{ banner_url: null }>> {
  const result = await customerApi<{ banner_url: null }>("DELETE", "/v1/store/account/banner");
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/", "layout");
  return { ok: true, data: { banner_url: null } };
}
