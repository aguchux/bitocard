"use client";

import { Badge, currencyDigits, formatMoney } from "@bitocard/admin-ui";
import { type ConnectApplicationStatus, connectApplicationStatusLabels } from "@bitocard/api-client/admin";

const tones: Record<ConnectApplicationStatus, "green" | "amber" | "red" | "blue" | "grey" | "pink"> = {
  draft: "grey",
  submitted: "blue",
  changes_requested: "amber",
  visit_scheduled: "pink",
  visited: "blue",
  approved: "green",
  rejected: "red",
  withdrawn: "grey",
};

/** A Connect Centre application's status in words, with its own colour. */
export function ApplicationStatus({ status }: { status: ConnectApplicationStatus }) {
  return <Badge tone={tones[status]}>{connectApplicationStatusLabels[status]}</Badge>;
}

/** Minor units in the market's currency, or a dash when there is none. */
export const money = (minor: number | null | undefined, currency: string) => (minor === null || minor === undefined ? "—" : formatMoney(minor, currency));

/** A datetime-local value (the admin's own time) as an ISO time, or null when it cannot be read. */
export function isoFromLocal(value: string) {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** An amount typed in main units ("50000" or "50000.50") as minor units, or null when it cannot be read. */
export function toMinor(value: string, currency: string) {
  const digits = currencyDigits(currency);
  const match = (digits ? new RegExp(`^(\\d{1,12})(?:\\.(\\d{1,${digits}}))?$`) : /^(\d{1,12})$/).exec(value.trim().replace(/,/g, ""));
  if (!match) return null;
  return Number(match[1]) * 10 ** digits + Number((match[2] ?? "").padEnd(digits, "0") || 0);
}
