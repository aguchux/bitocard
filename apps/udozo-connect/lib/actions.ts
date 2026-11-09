"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Application } from "./connect";
import { customerApi, dropSession } from "./session";

/** What an action answers: the application as it now is, or Udozo's refusal in words with the field it names. */
export type ActionResult = { ok: true; application: Application } | { ok: false; message: string; code: string | null; param: string | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unknown: ActionResult = { ok: false, message: "No such application.", code: "resource_missing", param: null };

/** The fields the wizard may send, each a string, number or null (anything else is left out). */
const fields = ["business_name", "registration_number", "area_id", "address", "landmark", "hours", "phone", "capacity", "person_name", "person_role"] as const;
export type ApplicationFields = Partial<Record<(typeof fields)[number], string | number | null>>;

function clean(input: ApplicationFields) {
  const body: Record<string, string | number | null> = {};
  for (const key of fields) {
    const value = input[key];
    if (value === undefined) continue;
    if (key === "capacity") body.capacity = value === null || value === "" ? null : Number(value);
    else body[key] = typeof value === "string" ? (value.trim() ? value.trim() : null) : null;
  }
  return body;
}

async function answer(result: Awaited<ReturnType<typeof customerApi<Application>>>): Promise<ActionResult> {
  if (!result.ok) return { ok: false, message: result.status === 401 ? "Your session ended. Sign in again to carry on." : result.message, code: result.code, param: result.param };
  revalidatePath("/application");
  return { ok: true, application: result.data };
}

/** Saves a step: makes the application on its first save, then changes it. */
export async function saveApplication(id: string | null, input: ApplicationFields): Promise<ActionResult> {
  if (id !== null && !uuid.test(id)) return unknown;
  const body = clean(input);
  return answer(id ? await customerApi<Application>("PATCH", `/v1/connect/applications/${id}`, body) : await customerApi<Application>("POST", "/v1/connect/applications", body));
}

export async function loadApplication(id: string): Promise<ActionResult> {
  if (!uuid.test(id)) return unknown;
  return answer(await customerApi<Application>("GET", `/v1/connect/applications/${id}`));
}

export async function removePhoto(id: string, photo: string): Promise<ActionResult> {
  if (!uuid.test(id) || !uuid.test(photo)) return unknown;
  return answer(await customerApi<Application>("DELETE", `/v1/connect/applications/${id}/photos/${photo}`));
}

/** Accepts the Connect Centre agreement's version the person read; then the application is read again. */
export async function acceptAgreement(id: string, version: string): Promise<ActionResult> {
  if (!uuid.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(version)) return unknown;
  const accepted = await customerApi<{ accepted: boolean }>("POST", "/v1/connect/agreement/accept", { version });
  if (!accepted.ok) return { ok: false, message: accepted.message, code: accepted.code, param: accepted.param };
  return loadApplication(id);
}

/** Sends the application with the deposit the person saw (`deposit_changed` when it moved since). */
export async function submitApplication(id: string, expectedDeposit: number | null): Promise<ActionResult> {
  if (!uuid.test(id)) return unknown;
  return answer(await customerApi<Application>("POST", `/v1/connect/applications/${id}/submit`, expectedDeposit === null ? {} : { expected_deposit: expectedDeposit }));
}

export async function withdrawApplication(id: string): Promise<ActionResult> {
  if (!uuid.test(id)) return unknown;
  return answer(await customerApi<Application>("POST", `/v1/connect/applications/${id}/withdraw`, {}));
}

export async function confirmVisit(id: string): Promise<ActionResult> {
  if (!uuid.test(id)) return unknown;
  return answer(await customerApi<Application>("POST", `/v1/connect/applications/${id}/visit/confirm`, {}));
}

export async function rescheduleVisit(id: string, note: string): Promise<ActionResult> {
  if (!uuid.test(id)) return unknown;
  return answer(await customerApi<Application>("POST", `/v1/connect/applications/${id}/visit/reschedule`, { note: note.trim().slice(0, 1000) }));
}

export async function signOut() {
  await customerApi("POST", "/v1/store/account/signout", {});
  await dropSession();
  revalidatePath("/", "layout");
  redirect("/");
}
