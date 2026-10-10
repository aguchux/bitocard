import "server-only";
import { storeApi } from "./api";

/** A country BitoCard sells in, with its currency: what a customer can choose as their own (`GET /v1/countries`). */
export type Market = { code: string; name: string; currency: string };

/** BitoCard's markets, for choosing a customer's country (bitocard.com only). Empty when the API cannot be reached. */
export async function markets(): Promise<Market[]> {
  const result = await storeApi<{ data: Market[] }>("/v1/countries");
  return result.ok ? result.data.data.map(({ code, name, currency }) => ({ code, name, currency })) : [];
}
