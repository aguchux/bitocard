"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const ownerLinks = [
  { href: "/app", label: "Home" },
  { href: "/app/till", label: "Till" },
  { href: "/app/sales", label: "Sales" },
  { href: "/app/customers", label: "Customers" },
  { href: "/app/products", label: "Products" },
  { href: "/app/setup", label: "Shop and tills" },
  { href: "/app/billing", label: "Plan and billing" },
] as const;

/** The owner's places, the current one marked; a row that slides sideways on phones, never wider than the screen. */
export function OwnerNav() {
  const path = usePathname();
  return (
    <nav aria-label="POS" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {ownerLinks.map(link => {
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
