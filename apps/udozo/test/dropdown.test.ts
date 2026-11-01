// @vitest-environment jsdom
// Every dropdown and flyout closes on a click outside it, on Escape, and (a `Dropdown`) on choosing a link in it.
import { act, type ComponentProps, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Dropdown, useDismiss } from "@/components/dropdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<() => void> = [];
afterEach(() => {
  mounted.splice(0).forEach(unmount => unmount());
  document.body.innerHTML = "";
});

function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host, Object.assign(document.createElement("p"), { id: "outside" }));
  const root = createRoot(host);
  act(() => root.render(element));
  mounted.push(() => act(() => root.unmount()));
}

const pointerDown = (target: Element) => act(() => void target.dispatchEvent(new Event("pointerdown", { bubbles: true })));
const escape = () => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

describe("Dropdown", () => {
  const menu = () => document.querySelector("details")!;
  const open = () => act(() => void (menu().open = true));
  const render = () =>
    mount(
      createElement(
        Dropdown,
        { id: "menu" } as ComponentProps<typeof Dropdown>,
        createElement("summary", null, "Nigeria"),
        createElement("nav", null, createElement("a", { href: "#gh" }, "Ghana"), createElement("span", { id: "inside" }, "Choose")),
      ),
    );

  it("closes on a click outside it, never on one inside", () => {
    render();
    open();
    pointerDown(document.getElementById("inside")!);
    expect(menu().open).toBe(true);
    pointerDown(document.getElementById("outside")!);
    expect(menu().open).toBe(false);
  });

  it("closes on Escape with focus back on its button, and leaves focus alone while closed", () => {
    render();
    const before = document.activeElement;
    escape();
    expect(document.activeElement).toBe(before);
    open();
    escape();
    expect(menu().open).toBe(false);
    expect(document.activeElement).toBe(document.querySelector("summary"));
  });

  it("closes on choosing a link in it", () => {
    render();
    open();
    act(() => (document.querySelector('a[href="#gh"]') as HTMLAnchorElement).click());
    expect(menu().open).toBe(false);
  });
});

describe("useDismiss", () => {
  function Flyout() {
    const [shown, setShown] = useState(true);
    const box = useRef<HTMLDivElement>(null);
    useDismiss(box, shown, () => setShown(false));
    return createElement("div", { ref: box }, shown ? createElement("ul", { id: "panel" }) : null);
  }

  it("closes a state-driven flyout on a click outside", () => {
    mount(createElement(Flyout));
    pointerDown(document.getElementById("panel")!);
    expect(document.getElementById("panel")).not.toBeNull();
    pointerDown(document.getElementById("outside")!);
    expect(document.getElementById("panel")).toBeNull();
  });
});
