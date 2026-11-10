"use client";

import { Badge, currencyDigits, formatMoney } from "@bitocard/admin-ui";
import { type ConnectApplicationStatus, connectApplicationStatusLabels, type ConnectCentre, type ConnectCentrePause, type ConnectFlag } from "@bitocard/api-client/admin";

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

export const centreStatusLabels: Record<ConnectCentre["status"], string> = { active: "Active", paused: "Paused", closed: "Closed" };
export const centreStatusTones: Record<ConnectCentre["status"], "green" | "amber" | "grey"> = { active: "green", paused: "amber", closed: "grey" };

/** Who paused a centre, in words. */
export const pausedBy = (pause: ConnectCentrePause) => (pause.by === "udozo" ? "Paused by Udozo" : "Paused by the partner");

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

/** What needs attention at a centre, in words and a badge colour (Connect > Reports). */
export const flagLabels: Record<ConnectFlag, string> = {
  missing_items: "Items missing",
  over_capacity: "Full",
  high_uncollected: "Often not collected",
  loss_of_care: "Loss of care",
  late_arrivals: "Items arriving late",
  overdue_items: "Past their free time",
  paused: "Paused",
  closed: "Closed",
};
export const flagTones: Record<ConnectFlag, "red" | "amber" | "grey"> = {
  missing_items: "red",
  over_capacity: "red",
  high_uncollected: "amber",
  loss_of_care: "amber",
  late_arrivals: "amber",
  overdue_items: "amber",
  paused: "grey",
  closed: "grey",
};

/** A share in per cent, or a dash when nothing was tried. */
export const percent = (value: number | null) => (value === null ? "\u2014" : `${value}%`);
