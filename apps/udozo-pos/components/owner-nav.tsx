"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { allows, type PermissionSet } from "@/lib/pos";

export type NavLink = { href: string; label: string };

export const ownerLinks: readonly NavLink[] = [
  { href: "/app", label: "Home" },
  { href: "/app/overview", label: "Overview" },
  { href: "/app/till", label: "Till" },
  { href: "/app/shifts", label: "Shifts" },
  { href: "/app/sales", label: "Sales" },
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
    { href: "/app/reports", label: "Reports", show: allows(permissions, "cash_up") || allows(permissions, "export") },
    { href: "/app/customers", label: "Customers", show: allows(permissions, "customers") },
    { href: "/app/products", label: "Products", show: allows(permissions, "stock_view") || allows(permissions, "sell") },
    { href: "/app/staff", label: "Cashiers", show: permissions.staff === "cashiers" },
  ]
    .filter(link => link.show)
    .map(({ href, label }) => ({ href, label }));
}

/** The places, the current one marked; a row that slides sideways on phones, never wider than the screen. */
export function OwnerNav({ links = ownerLinks }: { links?: readonly NavLink[] }) {
  const path = usePathname();
  return (
    <nav aria-label="POS" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {links.map(link => {
          const current = link.href === "/app" ? path === "/app" : path.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={`flex h-11 items-center rounded-[10px] px-4 text-sm font-semibold whitespace-nowrap no-underline ${current ? "bg-pos-night-2 text-white" : "text-pos-night-text hover:bg-pos-night-2 hover:text-white"}`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
