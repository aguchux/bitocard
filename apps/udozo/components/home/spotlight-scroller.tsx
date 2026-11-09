"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** How far a mouse moves before a press is a drag (and the link under it is not opened). */
const dragThreshold = 6;

/**
 * The category spotlights' row below computer width: swiped either way on touch screens, dragged either way with a
 * mouse (a drag never opens the tile it ends on), scrolled with a wheel or trackpad, or stepped with the arrows at its
 * ends (shown only while there is more that way). It snaps to each tile, with no scroll bar. From `lg` it is the grid
 * of every category (`--spotlight-cols` columns) and none of this applies.
 */
export function SpotlightScroller({ columns, label, children }: { columns: number; label: string; children: ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
  const drag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 });
  const [more, setMore] = useState({ back: false, forward: false });

  const measure = useCallback(() => {
    const el = list.current;
    if (el) setMore({ back: el.scrollLeft > 4, forward: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
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
      el.style.scrollSnapType = "none";
      el.style.scrollBehavior = "auto";
    }
    el.scrollLeft = state.startLeft - dx;
  };
  const endDrag = (event: React.PointerEvent<HTMLUListElement>) => {
    const el = list.current;
    if (!el || !drag.current.active) return;
    drag.current.active = false;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    el.style.scrollSnapType = "";
    el.style.scrollBehavior = "";
  };
  const onClickCapture = (event: React.MouseEvent) => {
    if (drag.current.moved) {
      event.preventDefault();
      event.stopPropagation();
      drag.current.moved = false;
    }
  };

  const arrow = "absolute top-[38%] z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-navy-900 shadow-lg ring-1 ring-navy-200 hover:bg-white lg:hidden";
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
        style={{ "--spotlight-cols": columns } as CSSProperties}
        className="-mx-4 flex cursor-grab snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 contain-inline-size select-none [scrollbar-width:none] active:cursor-grabbing sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:grid lg:cursor-auto lg:grid-cols-[repeat(var(--spotlight-cols),minmax(0,1fr))] lg:overflow-visible lg:px-0 lg:pb-0 lg:select-auto [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </ul>
      {more.back ? (
        <button type="button" aria-label="Show earlier categories" onClick={() => step(-1)} className={`${arrow} -left-2 sm:-left-3`}>
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
      ) : null}
      {more.forward ? (
        <button type="button" aria-label="Show more categories" onClick={() => step(1)} className={`${arrow} -right-2 sm:-right-3`}>
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
