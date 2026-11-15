"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StoreAirtimePurchase, StoreAirtimePurchaseQuote, StoreAirtimeSale } from "@bitocard/api-client/storefront";
import { nairaToMinor } from "./airtime-rules";
import { customerApi } from "./customer";

const uuid = /^[0-9a-f-]{36}$/i;
const networkKey = /^[a-z0-9-]{2,20}$/;
const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export type AirtimeFormState = { error?: string; field?: string | null };
export type AirtimeBuyState = AirtimeFormState & { quote?: StoreAirtimePurchaseQuote };

/** Starts selling airtime to BitoCard, then opens the sale's page (where to send it and how). */
export async function startAirtimeSale(_state: AirtimeFormState, form: FormData): Promise<AirtimeFormState> {
  const network = text(form, "network");
  const amount = nairaToMinor(text(form, "amount"));
  if (!networkKey.test(network)) return { error: "Choose the network.", field: "network" };
  if (!amount) return { error: "Enter a whole amount in naira.", field: "amount" };
  const fromPhone = text(form, "from_phone");
  const result = await customerApi<StoreAirtimeSale>("POST", "/v1/store/airtime/sales", { network, amount, ...(fromPhone ? { from_phone: fromPhone } : {}) });
  if (!result.ok) return { error: result.message, field: result.param ?? null };
  revalidatePath("/account/airtime");
  redirect(`/account/airtime/sales/${result.data.id}`);
}

/** Buying from the pool: first the price (nothing paid), then paying exactly that price from the wallet. */
export async function buyAirtime(_state: AirtimeBuyState, form: FormData): Promise<AirtimeBuyState> {
  const network = text(form, "network");
  const amount = nairaToMinor(text(form, "amount"));
  const phone = text(form, "phone");
  if (!networkKey.test(network)) return { error: "Choose the network.", field: "network" };
  if (!amount) return { error: "Enter a whole amount in naira.", field: "amount" };
  if (phone.length < 7) return { error: "Choose the number to send it to.", field: "phone" };
  const expected = Number(text(form, "expected"));
  if (!expected) {
    const quote = await customerApi<StoreAirtimePurchaseQuote>("POST", "/v1/store/airtime/purchases", { network, amount, phone, preview: true });
    return quote.ok ? { quote: quote.data } : { error: quote.message, field: quote.param ?? null };
  }
  const result = await customerApi<StoreAirtimePurchase>("POST", "/v1/store/airtime/purchases", { network, amount, phone, expected_price: expected });
  if (!result.ok) return { error: result.message, field: result.code === "price_changed" ? null : (result.param ?? null) };
  revalidatePath("/account", "layout");
  redirect(`/account/airtime/purchases/${result.data.id}`);
}

export async function markAirtimeSent(id: string) {
  if (!uuid.test(id)) return;
  await customerApi<StoreAirtimeSale>("POST", `/v1/store/airtime/sales/${id}/sent`, {});
  revalidatePath(`/account/airtime/sales/${id}`);
}

export async function cancelAirtimeSale(id: string) {
  if (!uuid.test(id)) return;
  await customerApi<StoreAirtimeSale>("POST", `/v1/store/airtime/sales/${id}/cancel`, {});
  revalidatePath(`/account/airtime/sales/${id}`);
}

/** BitoCard's sandbox: settles a trade as staff would. */
export async function simulateAirtimeSale(id: string, outcome: "received" | "not_received") {
  if (!uuid.test(id)) return;
  await customerApi<StoreAirtimeSale>("POST", `/v1/store/airtime/sales/${id}/simulate`, { outcome });
  revalidatePath(`/account/airtime/sales/${id}`);
}

export async function simulateAirtimePurchase(id: string, outcome: "delivered" | "refunded") {
  if (!uuid.test(id)) return;
  await customerApi<StoreAirtimePurchase>("POST", `/v1/store/airtime/purchases/${id}/simulate`, { outcome });
  revalidatePath("/account", "layout");
}
