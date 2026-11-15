"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Home's "I want to" row on phones and tablets: one row that slides sideways. Fingers scroll it natively (snapping);
 * a mouse drags it too (a drag never opens the card it ends on), and mice also get arrows while there is more that
 * way. From `lg` it is a 3 × 2 grid and none of this applies (nothing to scroll).
 */
export function ActionRow({ label, className, children }: { label: string; className: string; children: React.ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const scrollable = () => {
    const el = list.current;
    return Boolean(el && el.scrollWidth > el.clientWidth + 1);
  };

  // Settles on the nearest card with snapping off, then gives snapping back.
  const settle = (el: HTMLUListElement, target: number) => {
    el.style.scrollSnapType = "none";
    el.scrollTo({ left: target, behavior: "smooth" });
    const restore = () => {
      el.style.scrollSnapType = "";
      el.removeEventListener("scrollend", restore);
    };
    el.addEventListener("scrollend", restore);
    window.setTimeout(restore, 600);
  };

  const nearest = (el: HTMLUListElement) => {
    const padding = parseFloat(getComputedStyle(el).scrollPaddingLeft || "0") || 0;
    const base = el.getBoundingClientRect().left;
    let best = el.scrollLeft;
    let distance = Infinity;
    for (const item of Array.from(el.children)) {
      const offset = el.scrollLeft + (item as HTMLElement).getBoundingClientRect().left - base - padding;
      const target = Math.max(0, Math.min(offset, el.scrollWidth - el.clientWidth));
      if (Math.abs(target - el.scrollLeft) < distance) {
        distance = Math.abs(target - el.scrollLeft);
        best = target;
      }
    }
    return best;
  };

  const step = (direction: 1 | -1) => {
    const el = list.current;
    const first = el?.querySelector("li");
    if (!el || !first) return;
    const width = first.getBoundingClientRect().width + parseFloat(getComputedStyle(el).columnGap || "0");
    settle(el, Math.max(0, Math.min(el.scrollLeft + direction * width, el.scrollWidth - el.clientWidth)));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLUListElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || !scrollable()) return;
    drag.current = { x: event.clientX, left: event.currentTarget.scrollLeft, moved: false, id: event.pointerId };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLUListElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const el = event.currentTarget;
    const dx = event.clientX - state.x;
    if (!state.moved) {
      if (Math.abs(dx) < 6) return;
      state.moved = true;
      el.style.scrollSnapType = "none";
      el.style.cursor = "grabbing";
      el.setPointerCapture(event.pointerId);
    }
    el.scrollLeft = state.left - dx;
  };
  const onPointerEnd = (event: React.PointerEvent<HTMLUListElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    const el = event.currentTarget;
    el.style.cursor = "";
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    if (state.moved) {
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
      settle(el, nearest(el));
    }
  };

  const arrow =
    "absolute top-1/2 z-10 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white text-navy-900 shadow-lg ring-1 ring-slate-200 hover:bg-slate-50 [@media(hover:hover)_and_(pointer:fine)]:grid lg:!hidden";
  return (
    <div className="relative">
      <ul
        ref={list}
        aria-label={label}
        onScroll={measure}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={event => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
        onDragStart={event => event.preventDefault()}
        className={className}
      >
        {children}
      </ul>
      {!edges.start ? (
        <button type="button" aria-label="Scroll back" onClick={() => step(-1)} className={`${arrow} left-1`}>
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
      ) : null}
      {!edges.end ? (
        <button type="button" aria-label="Scroll for more" onClick={() => step(1)} className={`${arrow} right-1`}>
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
