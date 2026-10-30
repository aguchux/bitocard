"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A row that slides sideways on every screen: swiped on phones and tablets, and on desktops with the wheel, trackpad or
 * the arrow buttons (shown only while there is more that way). It snaps to each item, the next one peeking, with no
 * scroll bar, and it bleeds to the screen's edge on phones. `contain-inline-size` keeps the items out of its width, so a
 * grid parent never grows to fit them and the page never scrolls sideways. Item widths come from each `<li>`.
 */
export function Slider({ label, children }: { label: string; children: React.ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
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
  // About one screen of items at a time, landing on an item (the row snaps).
  const step = (direction: 1 | -1) => {
    const el = list.current;
    if (el) el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.8, 160), behavior: "smooth" });
  };
  const arrow = "absolute top-1/2 z-10 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white text-navy-900 shadow-lg ring-1 ring-navy-200 hover:bg-navy-50 lg:grid";
  return (
    <div className="relative">
      <ul
        ref={list}
        aria-label={label}
        onScroll={measure}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 contain-inline-size [scrollbar-width:none] motion-safe:scroll-smooth sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0 [&::-webkit-scrollbar]:hidden [&>li]:shrink-0 [&>li]:snap-start"
      >
        {children}
      </ul>
      {more.back ? (
        <button type="button" aria-label="Scroll back" onClick={() => step(-1)} className={`${arrow} -left-5`}>
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
      ) : null}
      {more.forward ? (
        <button type="button" aria-label="Scroll for more" onClick={() => step(1)} className={`${arrow} -right-5`}>
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
