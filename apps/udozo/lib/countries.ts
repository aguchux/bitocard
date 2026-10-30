import "server-only";
import { shopApi } from "./api";

/** A country Udozo serves, with its currency: what a customer chooses as their own at sign-up (`GET /v1/countries`). */
export type Market = { code: string; name: string; currency: string };

/** Udozo's markets, for choosing a customer's country. Empty when the API cannot be reached. */
export async function countries(): Promise<Market[]> {
  const result = await shopApi<{ data: Market[] }>("/v1/countries", { revalidate: 300 });
  return result.ok ? result.data.data.map(({ code, name, currency }) => ({ code, name, currency })) : [];
}
