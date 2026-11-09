// @vitest-environment jsdom
// A row of chips moved sideways by hand (the brand page's models, 9 November 2026, the owner's request): never by
// itself, the chosen chip brought into view, arrows only while there is more that way, and a mouse drag never opening
// the chip it ends on.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { SideScroller } = await import("@/components/side-scroller");

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  document.body.innerHTML = "";
});

// jsdom lays nothing out: each chip is 100 px wide, the row 250 px.
function mount(current: number | null) {
  const sizes = (el: Element, name: string, value: number) => Object.defineProperty(el, name, { configurable: true, value });
  const widths = { clientWidth: 250, scrollWidth: 1000 };
  for (const [name, value] of Object.entries(widths)) Object.defineProperty(HTMLUListElement.prototype, name, { configurable: true, get: () => value });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const chips = Array.from({ length: 10 }, (_, n) => createElement("li", { key: n, ref: (el: HTMLElement | null) => el && (sizes(el, "offsetLeft", n * 100), sizes(el, "offsetWidth", 100)) }, createElement("a", { href: `/m/${n}`, "aria-current": n === current ? "true" : undefined }, `Model ${n}`)));
  act(() => root.render(createElement(SideScroller, { label: "Popular models", more: "Show more models", earlier: "Show earlier models" } as Parameters<typeof SideScroller>[0], ...chips)));
  unmounts.push(() => act(() => root.unmount()));
  return host;
}

describe("the sideways row", () => {
  it("is one row with no wrapping, the chosen chip in view, and an arrow only where there is more", () => {
    const host = mount(6);
    const list = host.querySelector("ul")!;
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).not.toContain("flex-wrap");
    // Model 6 starts at 600 px: centred in a 250 px row.
    expect(list.scrollLeft).toBe(525);
    expect(host.querySelector('[aria-label="Show more models"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Show earlier models"]')).not.toBeNull();
  });

  it("starts at the beginning with no chip chosen, with no arrow back", () => {
    const host = mount(null);
    expect(host.querySelector("ul")!.scrollLeft).toBe(0);
    expect(host.querySelector('[aria-label="Show earlier models"]')).toBeNull();
    expect(host.querySelector('[aria-label="Show more models"]')).not.toBeNull();
  });

  it("a mouse drag moves it and never opens the chip it ends on; a plain click does", () => {
    const host = mount(null);
    const list = host.querySelector("ul")!;
    list.setPointerCapture = () => undefined;
    list.hasPointerCapture = () => true;
    list.releasePointerCapture = () => undefined;
    const link = host.querySelector("a")!;
    const pointer = (type: string, clientX: number) => act(() => void list.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX, button: 0 }), { pointerType: "mouse", pointerId: 1 })));
    pointer("pointerdown", 300);
    pointer("pointermove", 180);
    pointer("pointerup", 180);
    expect(list.scrollLeft).toBe(120);
    const dragged = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => void link.dispatchEvent(dragged));
    expect(dragged.defaultPrevented).toBe(true);
    const clicked = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => void link.dispatchEvent(clicked));
    expect(clicked.defaultPrevented).toBe(false);
  });
});
