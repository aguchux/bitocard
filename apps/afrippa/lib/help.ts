"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@afrippa/ui/forms";
import { customerApi, signInPath } from "@/lib/customer";

/**
 * A trader's help desk: tickets to Afrippa's own team (`/v1/afrippa/account/support/tickets`), over the trader's session,
 * signed by this server. Questions, not money: an order's money is settled by its appeal.
 */

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories = ["order", "payment", "account", "product", "technical", "other"];

function refused(result: { status: number; message: string; param: string | null }, next: string): FormState {
  if (result.status === 401) redirect(signInPath(next));
  return { error: result.message, field: result.param };
}

export async function openTicket(_state: FormState, form: FormData): Promise<FormState> {
  const subject = text(form, "subject");
  const message = text(form, "message");
  const category = categories.includes(text(form, "category")) ? text(form, "category") : "other";
  if (subject.length < 3) return { error: "Give it a short title.", field: "subject" };
  if (message.length < 3) return { error: "Tell us what you need.", field: "message" };
  const result = await customerApi<{ id: string }>("POST", "/v1/afrippa/account/support/tickets", { subject, category, message }, { idempotencyKey: text(form, "nonce") || undefined });
  if (!result.ok) return refused(result, "/help");
  revalidatePath("/help");
  redirect(`/help/${result.data.id}`);
}

export async function replyToTicket(_state: FormState, form: FormData): Promise<FormState> {
  const id = uuid.test(text(form, "id")) ? text(form, "id") : null;
  const body = text(form, "body");
  if (!id) return { error: "Choose a ticket." };
  if (!body) return { error: "Write a message.", field: "body" };
  const result = await customerApi("POST", `/v1/afrippa/account/support/tickets/${id}/messages`, { body });
  if (!result.ok) return refused(result, `/help/${id}`);
  revalidatePath(`/help/${id}`);
  return { notice: "Sent." };
}

export async function closeTicket(form: FormData): Promise<void> {
  const id = uuid.test(text(form, "id")) ? text(form, "id") : null;
  if (!id) return;
  await customerApi("POST", `/v1/afrippa/account/support/tickets/${id}/close`, {});
  revalidatePath(`/help/${id}`);
  revalidatePath("/help");
}
