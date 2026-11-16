import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { Gift } from "lucide-react";

let pathname = "/account/profile/security";
let search = "";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useSearchParams: () => new URLSearchParams(search) }));

const { UnderlineTabs } = await import("@bitocard/ui/underline-tabs");
const { SubTabs } = await import("@/components/app/sub-tabs");

const context = { groups: [{ key: "gift_cards", label: "Gift cards" }, { key: "mobile", label: "Mobile" }], currency: "NGN", wallets: ["NGN", "USD"] };
const tabs = (path: string, query = "") => {
  pathname = path;
  search = query;
  return renderToStaticMarkup(createElement(SubTabs, { context }));
};

const currentLink = (html: string) => html.match(/<a [^>]*aria-current="page"[^>]*>(.*?)<\/a>/)?.[1] ?? null;

describe("BitoCard's standard tabs", () => {
  test("a grey line under every tab, pink under the current one, sliding sideways with the line running to the edges", () => {
    const html = renderToStaticMarkup(
      createElement(UnderlineTabs, {
        label: "Places",
        current: "/b",
        tabs: [
          { href: "/a", label: "First", icon: Gift },
          { href: "/b", label: "Second", badge: 120 },
          { href: "/c", label: "Third", soon: true },
          { href: "https://legals.bitocard.com", label: "Legals", external: true },
        ],
      }),
    );
    expect(html).toContain('aria-label="Places"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(currentLink(html)).toContain("Second");
    expect(html).toContain("99+");
    expect(html).toContain("Soon");
    expect(html).toContain('<svg');
    // The page's gutter and the rest of the row are line too, so it runs from edge to edge.
    expect(html).toContain("-mx-4 sm:-mx-6");
    expect(html.match(/border-b-2 border-slate-200/g)!.length).toBe(6);
    expect(html).toContain("aria-[current=page]:border-brand-500");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("scroll-smooth");
    expect(html).toContain("[scrollbar-width:none]");
    expect(html).not.toContain("snap-");
    // Another site is a plain link and never current.
    expect(html).toMatch(/<a href="https:\/\/legals\.bitocard\.com" class="[^"]*">Legals<\/a>/);
  });

  test("without bleed, no gutter: the row keeps to its box", () => {
    const html = renderToStaticMarkup(createElement(UnderlineTabs, { label: "Show", current: null, bleed: false, tabs: [{ href: "/a", label: "A" }] }));
    expect(html).not.toContain("-mx-4");
    expect(html).not.toContain("aria-current");
  });
});

describe("the account app's sub menus as sliding tabs across the top on phones and tablets", () => {
  test("every tab's places, the current one marked, hidden on desktop where the sub rail lists them", () => {
    const wallet = tabs("/account/wallet/deposits", "show=open");
    expect(wallet).toContain('aria-label="Wallet menu"');
    expect(wallet).toContain("lg:hidden");
    for (const label of ["NGN wallet", "US dollars", "Deposits", "Transactions"]) expect(wallet).toContain(label);
    expect(currentLink(wallet)).toContain("Deposits");

    expect(currentLink(tabs("/account/wallet", "wallet=USD"))).toContain("US dollars");
    expect(currentLink(tabs("/account/orders", "show=delivered"))).toContain("Delivered");
    expect(currentLink(tabs("/account/disputes"))).toContain("Your disputes");
    expect(currentLink(tabs("/account/catalog", "group=mobile"))).toContain("Mobile");
  });

  test("the Account screens, the current screen marked, Soon kept", () => {
    const html = tabs("/account/profile/security");
    expect(html).toContain('aria-label="Account menu"');
    expect(currentLink(html)).toContain("Security");
    expect(html).toContain("Soon");
    expect(html).not.toContain("bg-brand-500");
  });

  test("nothing where the page has no menu (Home)", () => {
    expect(tabs("/account")).toBe("");
  });
});
