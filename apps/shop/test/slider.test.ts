import { readFileSync } from "node:fs";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Slider } from "@/components/slider";

describe("slider", () => {
  const items = [createElement("li", { key: "ng", className: "w-44" }, "Nigeria"), createElement("li", { key: "gh", className: "w-44" }, "Ghana")];
  const html = renderToStaticMarkup(createElement(Slider, { label: "Countries" } as ComponentProps<typeof Slider>, items));

  it("one row sliding sideways on every screen, never a grid, never widening the page", () => {
    const row = /<ul [^>]*class="([^"]+)"/.exec(html)?.[1]?.replaceAll("&amp;", "&").replaceAll("&gt;", ">").split(" ") ?? [];
    expect(row).toEqual(expect.arrayContaining(["flex", "overflow-x-auto", "snap-x", "snap-mandatory", "contain-inline-size", "motion-safe:scroll-smooth", "[&>li]:shrink-0", "[&>li]:snap-start"]));
    expect(row.some(name => /^(sm:|md:|lg:|xl:)?grid/.test(name)), "no breakpoint turns it into a grid").toBe(false);
    expect(html).toContain('aria-label="Countries"');
    expect(html).toContain(">Nigeria<");
  });

  it("arrows only once it knows there is more (measured in the browser)", () => {
    expect(html).not.toContain("Scroll for more");
    expect(readFileSync(new URL("../components/slider.tsx", import.meta.url), "utf8")).toContain('behavior: "smooth"');
  });

  it("the global page's countries use it", () => {
    const page = readFileSync(new URL("../app/(global)/page.tsx", import.meta.url), "utf8");
    expect(page).toContain('<Slider label="Countries">');
    expect(page).not.toContain("grid-cols-2 gap-3 sm:grid-cols-4");
  });
});
