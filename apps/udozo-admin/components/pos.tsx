import { formatDate, type Tone } from "@bitocard/admin-ui";
import { type AdminPosAccount, type AdminPosPlan, type PosAccountStatus, type PosLimitKey, posLimitKeys, posLimitLabels, type PosLimits, type PosPlanChange } from "@bitocard/api-client/admin";
import { toMinor } from "@/components/connect";
import { toMajor } from "@/components/plans/amounts";

export const posStatusTones: Record<PosAccountStatus, Tone> = { free: "grey", trial: "blue", active: "green", cancelling: "amber", past_due: "red" };

/** One limit in words: a number, or Unlimited. */
export const limitWords = (value: number | null) => (value === null ? "Unlimited" : value.toLocaleString("en-GB"));

/** Every limit on one line: "Products 50 · Shops 1 · Tills 2 · Staff 3". */
export const limitsLine = (limits: PosLimits) => posLimitKeys.map((key: PosLimitKey) => `${posLimitLabels[key]} ${limitWords(limits[key])}`).join(" · ");

/** Where an owner's plan stands, for Udozo's team. */
export function accountState(account: Pick<AdminPosAccount, "status" | "plan" | "next_plan" | "trial_ends_at" | "period_end" | "drops_to_free_at" | "lapsed_plan">) {
  switch (account.status) {
    case "free":
      return account.lapsed_plan ? `On Free since a paid plan lapsed (${account.lapsed_plan.replace("_", "-")}).` : "On Free.";
    case "trial":
      return `Trial of ${account.plan.name} until ${account.trial_ends_at ? formatDate(account.trial_ends_at) : "its end"}.`;
    case "cancelling":
      return `${account.plan.name} until ${account.period_end ? formatDate(account.period_end) : "the month's end"}, then Free.`;
    case "past_due":
      return `Renewal of ${account.plan.name} failed; drops to Free on ${account.drops_to_free_at ? formatDate(account.drops_to_free_at) : "the end of the grace period"}.`;
    default:
      return `${account.plan.name}, renews ${account.period_end ? formatDate(account.period_end) : "monthly"}${account.next_plan && account.next_plan !== account.plan.code ? `, then ${account.next_plan.replace("_", "-")}` : ""}.`;
  }
}

/** A VAT rate in basis points as a percentage. */
export const vatWords = (bps: number) => `${(bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;

/** What the form holds: each field as typed. */
export type PlanDraft = { name: string; description: string; prices: Record<string, string>; yearly: Record<string, string>; limits: Record<keyof PosLimits, string>; trial_days: string; shown: boolean; offline_hours: string; offline_sales: string };

export const draftOf = (plan: AdminPosPlan, currencies: string[]): PlanDraft => ({
  name: plan.name,
  description: plan.description ?? "",
  prices: Object.fromEntries(currencies.map(currency => [currency, plan.prices[currency] === undefined ? "" : toMajor(plan.prices[currency]!, currency)])),
  yearly: Object.fromEntries(currencies.map(currency => [currency, plan.yearly_prices?.[currency] === undefined ? "" : toMajor(plan.yearly_prices[currency]!, currency)])),
  limits: Object.fromEntries(posLimitKeys.map(key => [key, plan.limits[key] === null ? "" : String(plan.limits[key])])) as PlanDraft["limits"],
  trial_days: String(plan.trial_days),
  shown: plan.shown,
  offline_hours: String(plan.offline?.hours ?? 72),
  offline_sales: String(plan.offline?.sales ?? 500),
});

/** The change the form asks for, or the first thing wrong with it. */
export function planChange(plan: AdminPosPlan, currencies: string[], draft: PlanDraft): { change: PosPlanChange } | { error: string } {
  const name = draft.name.trim();
  if (!name || name.length > 40) return { error: "A plan name is 1 to 40 characters." };
  const change: PosPlanChange = { name, description: draft.description.trim() };
  if (plan.paid) {
    const prices: Record<string, number | null> = {};
    for (const currency of currencies) {
      const typed = draft.prices[currency]?.trim() ?? "";
      if (!typed) {
        if (plan.prices[currency] !== undefined) prices[currency] = null;
        continue;
      }
      const minor = toMinor(typed, currency);
      if (minor === null || minor <= 0) return { error: `The ${currency} price is not an amount above zero.` };
      prices[currency] = minor;
    }
    change.prices = prices;
    // Yearly prices, each beside a monthly one in its currency.
    const yearly: Record<string, number | null> = {};
    for (const currency of currencies) {
      const typed = draft.yearly?.[currency]?.trim() ?? "";
      if (!typed) {
        if (plan.yearly_prices?.[currency] !== undefined) yearly[currency] = null;
        continue;
      }
      const minor = toMinor(typed, currency);
      if (minor === null || minor <= 0) return { error: `The ${currency} yearly price is not an amount above zero.` };
      if (prices[currency] === null || (prices[currency] === undefined && plan.prices[currency] === undefined)) return { error: `Give ${currency}'s monthly price before its yearly one.` };
      yearly[currency] = minor;
    }
    if (Object.keys(yearly).length) change.yearly_prices = yearly;
  }
  const limits: Partial<PosLimits> = {};
  for (const key of posLimitKeys) {
    const typed = draft.limits[key].trim();
    if (!typed) {
      if (!plan.paid) return { error: `Free always has a limit: give ${posLimitLabels[key].toLowerCase()}.` };
      limits[key] = null;
      continue;
    }
    const value = Number(typed);
    if (!Number.isInteger(value) || value < 1 || value > 100_000) return { error: `${posLimitLabels[key]} is a whole number from 1 to 100,000, or empty for unlimited.` };
    limits[key] = value;
  }
  change.limits = limits;
  const hours = Number(draft.offline_hours.trim());
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) return { error: "A till sells offline for 1 to 168 hours." };
  const sales = Number(draft.offline_sales.trim());
  if (!Number.isInteger(sales) || sales < 1 || sales > 5000) return { error: "A till makes 1 to 5,000 sales offline." };
  change.offline_hours = hours;
  change.offline_sales = sales;
  if (plan.paid) {
    const trial = Number(draft.trial_days.trim() || "0");
    if (!Number.isInteger(trial) || trial < 0 || trial > 90) return { error: "The trial is from 0 to 90 days." };
    change.trial_days = trial;
    change.shown = draft.shown;
  }
  return { change };
}
