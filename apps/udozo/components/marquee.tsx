"use client";

import { useState } from "react";
import { Pause, Play } from "lucide-react";

/** Seconds each item takes to pass, by the speed admins chose. */
export const marqueeSeconds = { slow: 6, normal: 4, fast: 2.5 } as const;
export type MarqueeSpeed = keyof typeof marqueeSeconds;

/**
 * A row of items sliding past on its own (`.marquee` in globals.css): the items twice in one track moved by half its
 * width, so the loop never jumps. The copy is hidden from screen readers and keyboards (`aria-hidden`, `inert`), so
 * each item is read and reached once. It pauses while pointed at or while something in it has focus, and with its own
 * Pause button (moving content needs one, WCAG 2.2.2). For visitors who ask for reduced motion it stands still: the
 * copy goes and the row scrolls sideways by hand. Never wider than the screen.
 */
export function Marquee({ label, count, speed = "normal", direction = "left", children }: { label: string; count: number; speed?: MarqueeSpeed; direction?: "left" | "right"; children: React.ReactNode }) {
  const [paused, setPaused] = useState(false);
  const duration = Math.max(12, count * marqueeSeconds[speed]);
  return (
    <div className="marquee relative" data-paused={paused} data-direction={direction} style={{ "--marquee-duration": `${duration}s` } as React.CSSProperties}>
      <div className="marquee-viewport overflow-hidden contain-inline-size">
        <div className="marquee-track flex w-max">
          <ul aria-label={label} className="flex shrink-0 gap-3 pr-3 [&>li]:shrink-0">
            {children}
          </ul>
          <ul aria-hidden="true" inert className="marquee-copy flex shrink-0 gap-3 pr-3 [&>li]:shrink-0">
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
