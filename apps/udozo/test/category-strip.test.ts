import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CategoryStrip } from "@/components/category-strip";

const categories = [
  { slug: "vehicles", name: "Vehicles", icon: "car" },
  { slug: "jobs", name: "Jobs", icon: null },
];

describe("category strip", () => {
  const html = renderToStaticMarkup(createElement(CategoryStrip, { categories, href: (slug: string) => `/ng/c/${slug}` }));

  it("links every category", () => {
    expect(html).toContain('href="/ng/c/vehicles"');
    expect(html).toContain('href="/ng/c/jobs"');
    expect(html).toContain(">Vehicles<");
  });

  it("scrolls sideways on phones and is a grid from tablets up", () => {
    const strip = html.match(/^<div class="([^"]+)"/)?.[1].split(" ") ?? [];
    expect(strip).toEqual(expect.arrayContaining(["flex", "contain-inline-size", "overflow-x-auto", "snap-x", "snap-mandatory", "sm:grid", "sm:grid-cols-6", "sm:overflow-visible", "lg:grid-cols-8"]));
    // Fixed-width tiles that never shrink, so the row overflows and the next tile peeks.
    expect(html.match(/class="[^"]*\bshrink-0\b[^"]*\bsnap-start\b[^"]*"/g)).toHaveLength(2);
  });
});
