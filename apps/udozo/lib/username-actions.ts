"use server";

import { revalidatePath } from "next/cache";
import { usernamePattern, type UsernameAvailability, type UsernameStatus } from "@bitocard/api-client/classifieds";
import { customerApi } from "@/lib/customer";
import { usernameErrorText, usernameInput, usernameRule } from "@/lib/username";

/**
 * Usernames (docs/UDOZO_USERNAMES_PLAN.md) for the signed-in customer: whether one is free as they type, saving it,
 * and Not now on the account pages' banner. The browser only ever calls these; they call the API with the customer's
 * session. Each answers plainly whether it worked.
 */

export type UsernameCheck = { ok: true; data: UsernameAvailability } | { ok: false; message: string };
export type UsernameSave = { ok: true; data: UsernameStatus } | { ok: false; message: string };

/** Whether `value` is free for them (the API's answer, with suggestions). */
export async function checkUsername(value: string): Promise<UsernameCheck> {
  const username = typeof value === "string" ? usernameInput(value) : "";
  if (!usernamePattern.test(username)) return { ok: false, message: usernameRule };
  const result = await customerApi<UsernameAvailability>("GET", `/v1/store/account/username/availability?username=${encodeURIComponent(username)}`);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: usernameErrorText(result) };
}

/** Saves `value` as their username; their pages are read again so every address follows. */
export async function saveUsername(value: string): Promise<UsernameSave> {
  const username = typeof value === "string" ? usernameInput(value) : "";
  if (!usernamePattern.test(username)) return { ok: false, message: usernameRule };
  const result = await customerApi<UsernameStatus>("PUT", "/v1/store/account/username", { username });
  if (!result.ok) return { ok: false, message: usernameErrorText(result) };
  revalidatePath("/", "layout");
  return { ok: true, data: result.data };
}

/** Not now on the banner: counted by the API (after three it never asks again). The banner hides at once either way. */
export async function dismissUsernamePrompt(): Promise<{ ok: boolean }> {
  const result = await customerApi<UsernameStatus>("POST", "/v1/store/account/username/prompt/dismiss");
  return { ok: result.ok };
}
