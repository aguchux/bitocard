import { currencyDigits } from "@bitocard/admin-ui";
import { type PlanSettings } from "@bitocard/api-client/admin";

export type SettingsPlan = PlanSettings["plans"][number];

/** "35000" or "35,000.50" in a currency's major units, to minor units; null when it is not an amount. */
export function toMinor(value: string, currency: string) {
  const digits = currencyDigits(currency);
  const match = new RegExp(`^(\\d{1,12})(?:\\.(\\d{1,${Math.max(digits, 1)}}))?$`).exec(value.replace(/,/g, "").trim());
  if (!match || (digits === 0 && match[2])) return null;
  return Number(match[1]) * 10 ** digits + Number((match[2] ?? "").padEnd(digits, "0") || 0);
}
export const toMajor = (minor: number, currency: string) => String(minor / 10 ** currencyDigits(currency));

/** "Business" to "business"; what the code field suggests from the name. */
export const codeFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 30);
