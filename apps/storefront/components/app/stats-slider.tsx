"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A sideways row that scrolls on its own (snapping, no visible scroll bar; it never makes the page scroll sideways):
 * the next item peeks so it is clear there is more. Desktops (where a mouse cannot swipe) also get arrow buttons, shown
 * only while there is more that way. It bleeds to the screen edge on phones and tablets. Item widths come from each
 * `<li>`; items are `relative`, so nothing positioned inside them (screen-reader labels) can escape the scroller.
 */
export function Slider({ label, children }: { label?: string; children: React.ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
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
  // One item at a time: the width of the first item plus the gap.
  const step = (direction: 1 | -1) => {
    const el = list.current;
    const first = el?.querySelector("li");
    if (!el || !first) return;
    el.scrollBy({ left: direction * (first.getBoundingClientRect().width + parseFloat(getComputedStyle(el).columnGap || "0")), behavior: "smooth" });
  };
  const arrow = "absolute top-1/2 z-10 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white text-[#070f4c] shadow-lg ring-1 ring-slate-200 hover:bg-slate-50 lg:grid";
  return (
    <div className="relative">
      <ul
        ref={list}
        aria-label={label}
        onScroll={measure}
        className="relative -mx-4 flex snap-x pb-1 snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 md:gap-4 lg:mx-0 lg:scroll-px-0 lg:px-0 [&::-webkit-scrollbar]:hidden [&>li]:relative"
      >
        {children}
      </ul>
      {!edges.start ? (
        <button type="button" aria-label="Scroll back" onClick={() => step(-1)} className={`${arrow} -left-5`}>
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
      ) : null}
      {!edges.end ? (
        <button type="button" aria-label="Scroll for more" onClick={() => step(1)} className={`${arrow} -right-5`}>
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** Home's stat cards: the slider with the next card peeking (three on desktops, with arrows). */
export function StatsSlider({ children }: { children: React.ReactNode }) {
  return <Slider label="Your figures">{children}</Slider>;
}
