import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { Gift } from "lucide-react";

let pathname = "/account/profile/security";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { UnderlineTabs } = await import("@bitocard/ui/underline-tabs");
const { AccountPills } = await import("@/components/app/account-pills");

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

describe("the account app's rows are the standard tabs", () => {
  test("the Account screens, the current screen marked, Soon kept", () => {
    pathname = "/account/profile/security";
    const html = renderToStaticMarkup(createElement(AccountPills));
    expect(html).toContain('aria-label="Account settings"');
    expect(currentLink(html)).toContain("Security");
    expect(html.match(/Soon/g)).toHaveLength(2);
    expect(html).not.toContain("bg-brand-500");
  });
});
