"use client";

import { type ReactNode, type RefObject, useEffect, useRef } from "react";

/**
 * Closes a dropdown or flyout on a click or tap outside it and on Escape (focus back on its trigger, when given), while
 * it is open (`open`, or a check of the element's own state). Every menu that opens over the page uses it, so none stays
 * open behind the next thing the person does.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean | (() => boolean), close: () => void, trigger?: () => HTMLElement | null | undefined) {
  const latest = useRef({ open, close, trigger });
  useEffect(() => {
    latest.current = { open, close, trigger };
  });
  const listening = open !== false;
  useEffect(() => {
    if (!listening) return;
    const isOpen = () => (typeof latest.current.open === "function" ? latest.current.open() : latest.current.open);
    const outside = (event: PointerEvent) => {
      if (isOpen() && ref.current && !ref.current.contains(event.target as Node)) latest.current.close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !isOpen()) return;
      latest.current.close();
      latest.current.trigger?.()?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [ref, listening]);
}

/**
 * A `<details>` dropdown (its first child the `<summary>`, then the panel) that closes on an outside click, on Escape and
 * on choosing a link in it, since the header stays across pages.
 *
 * Positioned from tablets up only: on phones its panel is placed against the sticky header instead (`right-4` in the
 * panel), so a menu opened from a button near the left never runs off the screen.
 */
export function Dropdown({ id, className = "sm:relative", children }: { id?: string; className?: string; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (details.current) details.current.open = false;
  };
  useDismiss(details, () => Boolean(details.current?.open), close, () => details.current?.querySelector("summary"));
  return (
    <details
      ref={details}
      id={id}
      className={className}
      onClick={event => {
        if ((event.target as HTMLElement).closest("a")) close();
      }}
    >
      {children}
    </details>
  );
}
