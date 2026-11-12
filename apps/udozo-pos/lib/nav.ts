import { allows, type PermissionSet } from "@/lib/pos";

/** The POS's places behind sign-in. Plain data, so server pages (the layout, staff home) and the client navigation pane both read it. */
export type NavLink = { href: string; label: string };

export const ownerLinks: readonly NavLink[] = [
  { href: "/app", label: "Home" },
  { href: "/app/overview", label: "Overview" },
  { href: "/app/till", label: "Till" },
  { href: "/app/shifts", label: "Shifts" },
  { href: "/app/sales", label: "Sales" },
  { href: "/app/offline", label: "Offline" },
  { href: "/app/reports", label: "Reports" },
  { href: "/app/customers", label: "Customers" },
  { href: "/app/collections", label: "Payments" },
  { href: "/app/products", label: "Products" },
  { href: "/app/staff", label: "Staff" },
  { href: "/app/setup", label: "Shop and tills" },
  { href: "/app/billing", label: "Plan and billing" },
] as const;

/**
 * A member of staff's places: only what their role opens (the API holds every call to it as well). Payments, the
 * shop and its tills, and the plan stay the owner's.
 */
export function staffLinks(permissions: PermissionSet): NavLink[] {
  return [
    { href: "/app", label: "Home", show: true },
    { href: "/app/overview", label: "Overview", show: allows(permissions, "all_sales") },
    { href: "/app/till", label: "Till", show: permissions.sell === "yes" },
    { href: "/app/shifts", label: "Shifts", show: allows(permissions, "till") || allows(permissions, "cash_up") },
    { href: "/app/sales", label: "Sales", show: allows(permissions, "own_sales") || allows(permissions, "all_sales") },
    { href: "/app/offline", label: "Offline", show: allows(permissions, "all_sales") || allows(permissions, "stock_adjust") },
    { href: "/app/reports", label: "Reports", show: allows(permissions, "cash_up") || allows(permissions, "export") },
    { href: "/app/customers", label: "Customers", show: allows(permissions, "customers") },
    { href: "/app/products", label: "Products", show: allows(permissions, "stock_view") || allows(permissions, "sell") },
    { href: "/app/staff", label: "Cashiers", show: permissions.staff === "cashiers" },
  ]
    .filter(link => link.show)
    .map(({ href, label }) => ({ href, label }));
}

