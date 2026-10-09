"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreDispute } from "@bitocard/api-client/storefront";
import { customerApi } from "@/lib/customer";
import type { FormState } from "@/lib/account-actions";

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/** The customer opens a dispute about one of their orders; the store sees it at once. */
export async function openDispute(_state: FormState, form: FormData): Promise<FormState> {
  const checkoutId = text(form, "checkout_id");
  const result = await customerApi<StoreDispute>("POST", "/v1/store/account/disputes", { checkout_id: checkoutId, subject: text(form, "subject"), message: text(form, "message") });
  if (!result.ok) {
    if (result.status === 401) redirect(`/signin?next=${encodeURIComponent(`/account/disputes/new?order=${checkoutId}`)}`);
    return { error: result.message, field: result.param };
  }
  revalidatePath("/account/disputes");
  redirect(`/account/disputes/${result.data.id}`);
}

/** The customer replies on their dispute. */
export async function replyToDispute(_state: FormState, form: FormData): Promise<FormState> {
  const id = text(form, "id");
  const result = await customerApi<StoreDispute>("POST", `/v1/store/account/disputes/${encodeURIComponent(id)}/messages`, { body: text(form, "body") });
  if (!result.ok) return { error: result.message, field: result.param };
  revalidatePath(`/account/disputes/${id}`);
  return { notice: "Sent." };
}
