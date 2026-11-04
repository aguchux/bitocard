// @vitest-environment jsdom
// Home pages' marquees play on their own and can be moved by hand: a swipe, the wheel or a mouse drag, either way. A drag
// never opens the link it ended on; the copy is hidden from screen readers and out of the tab order, yet can be tapped.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Marquee, wrapOffset } from "@/components/marquee";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<() => void> = [];
function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const items = ["a", "b"].map(id => createElement("li", { key: id }, createElement("a", { href: `/l/${id}` }, `Item ${id}`)));
  act(() => root.render(createElement(Marquee, { label: "Trending", count: 2, children: items })));
  mounted.push(() => act(() => root.unmount()));
  return host;
}
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  document.body.innerHTML = "";
});

function pointer(type: string, target: Element, clientX: number) {
  const event = Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 }), { pointerType: "mouse", pointerId: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
}

describe("wrapOffset", () => {
  it("keeps an offset within one loop, above 0 and up to the copy's start, either way", () => {
    expect(wrapOffset(5, 100)).toBe(5);
    expect(wrapOffset(100, 100)).toBe(100);
    expect(wrapOffset(0, 100)).toBe(100);
    expect(wrapOffset(105, 100)).toBe(5);
    expect(wrapOffset(-5, 100)).toBe(95);
    expect(wrapOffset(42, 0)).toBe(42);
  });
});

describe("Marquee", () => {
  it("is a sideways scroller; the copy is hidden from screen readers and out of the tab order, but not inert", () => {
    const host = mount();
    const [list, copy] = host.querySelectorAll("ul");
    expect(host.querySelector(".marquee-viewport")).not.toBeNull();
    expect(copy!.getAttribute("aria-hidden")).toBe("true");
    expect(copy!.hasAttribute("inert")).toBe(false);
    for (const link of copy!.querySelectorAll("a")) expect(link.tabIndex).toBe(-1);
    for (const link of list!.querySelectorAll("a")) expect(link.tabIndex).toBe(0);
  });

  it("moves with a mouse drag either way, and the drag does not open the link it ended on", () => {
    const host = mount();
    const viewport = host.querySelector<HTMLDivElement>(".marquee-viewport")!;
    const link = host.querySelector("a")!;
    viewport.scrollLeft = 200;
    pointer("pointerdown", link, 300);
    pointer("pointermove", link, 240);
    expect(viewport.scrollLeft).toBe(260);
    pointer("pointermove", link, 380);
    expect(viewport.scrollLeft).toBe(120);
    pointer("pointerup", link, 380);
    const dragged = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(dragged);
    });
    expect(dragged.defaultPrevented).toBe(true);
    // A plain click afterwards opens the link.
    pointer("pointerdown", link, 380);
    pointer("pointerup", link, 381);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(false);
  });
});
