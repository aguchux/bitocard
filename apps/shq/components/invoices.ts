import type { Invoice } from "@bitocard/api-client/reseller";

/** An invoice's badge: paid, this month (open), overdue, or to pay. */
export const invoiceStatus = (invoice: Invoice) =>
  invoice.status === "paid"
    ? { status: "completed", label: "Paid" }
    : invoice.status === "open"
      ? { status: "processing", label: "This month" }
      : invoice.overdue
        ? { status: "failed", label: "Overdue" }
        : { status: "pending", label: "To pay" };

/** The month an invoice covers, such as "October 2026". */
export const monthName = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
