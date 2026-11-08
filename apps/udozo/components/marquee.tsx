"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

/** Seconds each item takes to pass, by the speed admins chose. */
export const marqueeSeconds = { slow: 6, normal: 4, fast: 2.5 } as const;
export type MarqueeSpeed = keyof typeof marqueeSeconds;

/** How long the row waits after someone swipes, drags or scrolls it before it moves on its own again. */
export const marqueeResumeMs = 2000;
/** How far a mouse moves before a press is a drag (and the link under it is not opened). */
const dragThreshold = 6;

/**
 * Keeps a scroll offset inside one loop of the items, above 0 and up to the copy's start, so the row can always be
 * moved either way and the copy takes over without a jump.
 */
export function wrapOffset(offset: number, period: number): number {
  if (period <= 0) return offset;
  const inside = ((offset % period) + period) % period;
  return inside === 0 ? period : inside;
}

function isFocusVisible(target: EventTarget): boolean {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * A row of items sliding past on its own, which people can also move themselves: a swipe on phones, the trackpad or
 * wheel, or dragging it with the mouse, either way; it carries on by itself `marqueeResumeMs` after they let go. The row
 * is a sideways scroller (scroll bar hidden) holding the items twice; it is moved by setting its scroll offset each
 * frame, wrapped at the copy's start so the loop never jumps, and held still while a finger or the mouse is on it. The copy is hidden from screen readers and taken out of
 * the tab order (`aria-hidden`, its links `tabindex="-1"`), so each item is read and reached once, yet a tap on it still
 * opens it. It pauses while pointed at with a mouse or while
 * something in it has keyboard focus, and with its own Pause button (moving content needs one, WCAG 2.2.2). For visitors who ask
 * for reduced motion it never moves by itself: the copy goes and the row only scrolls by hand. Never wider than the screen.
 */
/** `tight`: items 2 px apart (the hero reel), else 12 px. */
export function Marquee({ label, count, speed = "normal", direction = "left", tight = false, children }: { label: string; count: number; speed?: MarqueeSpeed; direction?: "left" | "right"; tight?: boolean; children: React.ReactNode }) {
  const spacing = tight ? "gap-0.5 pr-0.5" : "gap-3 pr-3";
  const [paused, setPaused] = useState(false);
  const duration = Math.max(12, count * marqueeSeconds[speed]);
  const viewport = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLUListElement>(null);
  const state = useRef({ paused: false, hover: false, focus: false, touching: false, quietUntil: 0, offset: 0, set: -1, dragging: false, dragged: false, draggedAt: 0, startX: 0, startOffset: 0 });

  useEffect(() => {
    state.current.paused = paused;
  }, [paused]);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const s = state.current;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // One loop is the distance from the first item to the copy's first item (gaps and padding included).
    const period = () => (reduced ? 0 : (copy.current?.offsetLeft ?? 0));
    const place = (offset: number) => {
      s.offset = wrapOffset(offset, period());
      el.scrollLeft = s.offset;
      s.set = el.scrollLeft;
    };
    // Anything that scrolls the row but this script (a swipe, its momentum, a wheel or trackpad) holds the motion.
    const onScroll = () => {
      if (Math.abs(el.scrollLeft - s.set) <= 1) return;
      s.quietUntil = performance.now() + marqueeResumeMs;
      const loop = period();
      if (loop > 0 && (el.scrollLeft > loop || el.scrollLeft <= 0)) place(el.scrollLeft);
      else {
        s.offset = el.scrollLeft;
        s.set = el.scrollLeft;
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // A finger on the row holds it still (moving it under the finger would fight the swipe), then the swipe's momentum.
    const touchStart = () => {
      s.touching = true;
    };
    const touchEnd = () => {
      s.touching = false;
      s.quietUntil = performance.now() + marqueeResumeMs;
    };
    el.addEventListener("touchstart", touchStart, { passive: true });
    el.addEventListener("touchend", touchEnd, { passive: true });
    el.addEventListener("touchcancel", touchEnd, { passive: true });
    const unlisten = () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("touchstart", touchStart);
      el.removeEventListener("touchend", touchEnd);
      el.removeEventListener("touchcancel", touchEnd);
    };
    // The copy's links stay out of the tab order (it is hidden from screen readers), but can be tapped.
    for (const item of copy.current?.querySelectorAll<HTMLElement>("a, button, input, select, textarea, [tabindex]") ?? []) item.tabIndex = -1;
    if (reduced) return unlisten;

    // Start just past the copy's start (it looks the same), so the row can be swiped back as well as on.
    place(s.offset || period());
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(now - last, 100);
      last = now;
      const loop = period();
      const still = s.paused || s.hover || s.focus || s.touching || s.dragging || now < s.quietUntil || document.hidden;
      if (!still && loop > 0) place(s.offset + ((direction === "left" ? 1 : -1) * loop * elapsed) / (duration * 1000));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      unlisten();
    };
  }, [direction, duration]);

  // Dragging with a mouse (touch and pens scroll the row themselves).
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || !viewport.current) return;
    const s = state.current;
    Object.assign(s, { dragging: true, dragged: false, startX: event.clientX, startOffset: viewport.current.scrollLeft });
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const s = state.current;
    const el = viewport.current;
    if (!s.dragging || !el) return;
    const moved = event.clientX - s.startX;
    if (!s.dragged && Math.abs(moved) < dragThreshold) return;
    if (!s.dragged) {
      s.dragged = true;
      el.setPointerCapture?.(event.pointerId);
    }
    const loop = copy.current?.offsetLeft ?? 0;
    s.offset = wrapOffset(s.startOffset - moved, loop);
    el.scrollLeft = s.offset;
    s.set = el.scrollLeft;
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const s = state.current;
    if (!s.dragging) return;
    s.dragging = false;
    if (s.dragged) {
      s.draggedAt = performance.now();
      s.quietUntil = s.draggedAt + marqueeResumeMs;
      viewport.current?.releasePointerCapture?.(event.pointerId);
    }
  };
  // A drag never opens the link it ended on (the click straight after it); later clicks are untouched.
  const onClickCapture = (event: React.MouseEvent) => {
    const s = state.current;
    if (!s.dragged || performance.now() - s.draggedAt > 500) return;
    s.dragged = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      className="marquee relative"
      data-paused={paused}
      data-direction={direction}
      data-duration={duration}
      onPointerEnter={event => {
        if (event.pointerType === "mouse") state.current.hover = true;
      }}
      onPointerLeave={() => {
        state.current.hover = false;
      }}
      // Keyboard focus holds it (a mouse press focuses the link under it, which must not stop the row for good).
      onFocus={event => {
        state.current.focus = isFocusVisible(event.target);
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) state.current.focus = false;
      }}
    >
      <div
        ref={viewport}
        className="marquee-viewport contain-inline-size"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onDragStart={event => event.preventDefault()}
      >
        <div className="marquee-track relative flex w-max">
          <ul aria-label={label} className={`flex shrink-0 ${spacing} [&>li]:shrink-0`}>
            {children}
          </ul>
          <ul ref={copy} aria-hidden="true" className={`marquee-copy flex shrink-0 ${spacing} [&>li]:shrink-0`}>
            {children}
          </ul>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPaused(value => !value)}
        aria-pressed={paused}
        className="marquee-control absolute top-2 right-2 z-10 grid size-9 place-items-center rounded-full bg-white/95 text-navy-900 shadow ring-1 ring-navy-200 hover:bg-white"
      >
        {paused ? <Play className="size-4" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
        <span className="sr-only">{paused ? `Play ${label}` : `Pause ${label}`}</span>
      </button>
    </div>
  );
}
