// @vitest-environment node
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { menus, sections } from "@/components/nav";

const consoleDir = fileURLToPath(new URL("../app/(console)", import.meta.url));

/** BitoCard SHQ's screens Udozo does not have: its catalogue, orders and the products that are BitoCard's alone. */
const bitocardOnly = [
  "/orders",
  "/catalogue",
  "/integrations",
  "/numbers",
  "/disputes",
  "/exchange",
  "/wallet/fees",
  "/wallet/reserved-accounts",
  "/wallet/exchange",
  "/store/customers",
  "/support/assistants",
  "/support/ai",
  "/support/bitocard",
  "/settings/preferences",
];

const hrefs = [...sections.map(item => item.href), ...Object.values(menus).flatMap(menu => menu.items.map(item => item.href))];
const labels = [...sections.map(item => item.label), ...Object.values(menus).flatMap(menu => [menu.title, ...menu.items.map(item => item.label)])];

describe("Udozo Seller HQ's navigation", () => {
  test("lists no BitoCard-only screen, and no page for one exists", () => {
    for (const path of bitocardOnly) {
      expect(hrefs.filter(href => href === path || href.startsWith(`${path}/`)), path).toEqual([]);
      expect(existsSync(`${consoleDir}${path}`), `app/(console)${path}`).toBe(false);
    }
  });

  test("never names BitoCard or SHQ", () => {
    for (const label of labels) expect(label, label).not.toMatch(/bitocard|\bSHQ\b/i);
  });

  test("has Resale with its five screens, stores, domains, plans, wallet, reports, developers, team and support", () => {
    expect(sections.map(item => item.key)).toEqual(["home", "resale", "store", "wallet", "reports", "support", "developers", "team", "settings"]);
    expect(menus.resale.items.map(item => item.href)).toEqual(["/resale", "/resale/listings", "/resale/orders", "/resale/rules", "/resale/suppliers"]);
    for (const href of ["/store", "/store/domains", "/settings/plan", "/wallet/payouts", "/wallet/invoices", "/reports", "/developers/webhooks", "/team", "/support/udozo"]) expect(hrefs).toContain(href);
  });

  test("every menu entry has its page", () => {
    const pages = new Set<string>();
    const walk = (dir: string, path: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${dir}/${entry.name}`, `${path}/${entry.name}`);
        else if (entry.name === "page.tsx") pages.add(path || "/");
      }
    };
    walk(consoleDir, "");
    for (const href of hrefs) expect(pages.has(href), href).toBe(true);
  });
});
