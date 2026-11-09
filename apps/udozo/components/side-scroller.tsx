"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** How far a mouse moves before a press is a drag (and the link under it is not opened). */
const dragThreshold = 6;

/**
 * One row of chips moved sideways by hand at every width, never by itself: swiped on touch screens, dragged with a
 * mouse (a drag never opens the chip it ends on), scrolled with a wheel or trackpad, or stepped with the arrows at its
 * ends (shown only while there is more that way). No scroll bar; the chip marked `aria-current` is brought into view
 * when the row first draws. It runs to the screen's edges on phones (`-mx-4`, matching the page's gutter).
 */
export function SideScroller({ label, more = "Show more", earlier = "Show earlier", children }: { label: string; more?: string; earlier?: string; children: ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
  const drag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 });
  const [ends, setEnds] = useState({ back: false, forward: false });

  const measure = useCallback(() => {
    const el = list.current;
    if (el) setEnds({ back: el.scrollLeft > 4, forward: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    const el = list.current;
    // The chosen chip in view, without moving the page.
    const current = el?.querySelector<HTMLElement>("[aria-current]")?.closest("li");
    if (el && current) el.scrollLeft = current.offsetLeft - el.offsetLeft - (el.clientWidth - current.offsetWidth) / 2;
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const step = (direction: 1 | -1) => {
    const el = list.current;
    if (el) el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.8, 140), behavior: "smooth" });
  };

  // Touch scrolls natively; only a mouse is dragged by hand (it cannot swipe, and the scroll bar is hidden).
  const onPointerDown = (event: React.PointerEvent<HTMLUListElement>) => {
    const el = list.current;
    if (!el || event.pointerType !== "mouse" || event.button !== 0 || el.scrollWidth <= el.clientWidth) return;
    drag.current = { active: true, moved: false, startX: event.clientX, startLeft: el.scrollLeft };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLUListElement>) => {
    const el = list.current;
    const state = drag.current;
    if (!el || !state.active) return;
    const dx = event.clientX - state.startX;
    if (!state.moved && Math.abs(dx) < dragThreshold) return;
    if (!state.moved) {
      state.moved = true;
      el.setPointerCapture(event.pointerId);
      el.style.scrollBehavior = "auto";
    }
    el.scrollLeft = state.startLeft - dx;
  };
  const endDrag = (event: React.PointerEvent<HTMLUListElement>) => {
    const el = list.current;
    if (!el || !drag.current.active) return;
    drag.current.active = false;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    el.style.scrollBehavior = "";
  };
  const onClickCapture = (event: React.MouseEvent) => {
    if (drag.current.moved) {
      event.preventDefault();
      event.stopPropagation();
      drag.current.moved = false;
    }
  };

  const arrow = "absolute top-1/2 z-10 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-navy-900 shadow-md ring-1 ring-navy-200 hover:bg-white";
  return (
    <div className="relative">
      <ul
        ref={list}
        aria-label={label}
        onScroll={measure}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onDragStart={event => event.preventDefault()}
        className="-mx-4 flex cursor-grab gap-2 overflow-x-auto overscroll-x-contain px-4 py-0.5 whitespace-nowrap contain-inline-size select-none [scrollbar-width:none] active:cursor-grabbing sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden [&>li]:shrink-0"
      >
        {children}
      </ul>
      {ends.back ? (
        <button type="button" aria-label={earlier} onClick={() => step(-1)} className={`${arrow} -left-2`}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      {ends.forward ? (
        <button type="button" aria-label={more} onClick={() => step(1)} className={`${arrow} -right-2`}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
