"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreTicket } from "@bitocard/api-client/storefront";
import { customerApi } from "@/lib/customer";
import type { FormState } from "@/lib/account-actions";

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/** The customer asks their store a question, optionally about one of their orders. */
export async function openTicket(_state: FormState, form: FormData): Promise<FormState> {
  const checkoutId = text(form, "checkout_id");
  const result = await customerApi<StoreTicket>("POST", "/v1/store/support/tickets", {
    subject: text(form, "subject"),
    category: text(form, "category") || "other",
    message: text(form, "message"),
    ...(checkoutId ? { checkout_id: checkoutId } : {}),
  });
  if (!result.ok) {
    if (result.status === 401) redirect(`/signin?next=${encodeURIComponent(checkoutId ? `/account/support/new?order=${checkoutId}` : "/account/support/new")}`);
    return { error: result.message, field: result.param };
  }
  revalidatePath("/account/support");
  redirect(`/account/support/${result.data.id}`);
}

/** The customer replies: the store's turn again (a resolved ticket reopens). */
export async function replyToTicket(_state: FormState, form: FormData): Promise<FormState> {
  const id = text(form, "id");
  const result = await customerApi<StoreTicket>("POST", `/v1/store/support/tickets/${encodeURIComponent(id)}/messages`, { body: text(form, "body") });
  if (!result.ok) return { error: result.message, field: result.param };
  revalidatePath(`/account/support/${id}`);
  return { notice: "Sent." };
}

/** The customer has their answer: the ticket is resolved. */
export async function closeTicket(_state: FormState, form: FormData): Promise<FormState> {
  const id = text(form, "id");
  const result = await customerApi<StoreTicket>("POST", `/v1/store/support/tickets/${encodeURIComponent(id)}/close`, {});
  if (!result.ok) return { error: result.message };
  revalidatePath(`/account/support/${id}`);
  revalidatePath("/account/support");
  return { notice: "Closed. Reply any time to reopen it." };
}
