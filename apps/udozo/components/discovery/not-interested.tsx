"use client";

import { useEffect, useRef, useState } from "react";
import { EyeOff, MoreVertical } from "lucide-react";
import { trackLater } from "@/lib/discovery-client";
import { useDismiss } from "../dropdown";

/** How long Undo is offered before "Not interested" is sent. */
export const undoMs = 6000;

/**
 * A listing card with a small menu holding **Not interested**: choosing it hides the card (with Undo for a few seconds)
 * and tells discovery to show fewer like it. The menu sits over the card's corner, beside its link, never inside it.
 */
export function NotInterested({ listing, source, children, className = "" }: { listing: number; source: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef<{ commit: () => void; cancel: () => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  useDismiss(menu, open, () => setOpen(false), () => trigger.current);

  // Leaving the page sends a choice still waiting (the queue sends held events as the page hides).
  useEffect(
    () => () => {
      if (!pending.current) return;
      clearTimeout(pending.current.timer);
      pending.current.commit();
    },
    [],
  );

  const choose = () => {
    setOpen(false);
    setHidden(true);
    const held = trackLater({ kind: "not_interested", listing, source });
    const timer = setTimeout(() => {
      held.commit();
      pending.current = null;
    }, undoMs);
    pending.current = { ...held, timer };
  };
  const undo = () => {
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current.cancel();
      pending.current = null;
    }
    setHidden(false);
  };

  if (hidden) {
    return (
      <div role="status" className={`flex min-h-24 flex-col items-start justify-center gap-1.5 rounded-2xl border border-dashed border-navy-300 bg-navy-50 p-3 text-sm text-navy-700 ${className}`}>
        <span>We will show you fewer like this.</span>
        <button type="button" onClick={undo} className="min-h-9 font-semibold text-brand-700 hover:underline">
          Undo
        </button>
      </div>
    );
  }
  return (
    <div ref={menu} className={`relative ${className}`}>
      {children}
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More options for this listing"
        className="absolute top-1.5 right-1.5 grid size-8 place-items-center rounded-full bg-white/90 text-navy-900 shadow-sm hover:bg-white"
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" className="absolute top-10 right-1.5 z-20 w-44 rounded-xl border border-navy-200 bg-white py-1 text-sm shadow-lg">
          <button type="button" role="menuitem" onClick={choose} className="flex min-h-10 w-full items-center gap-2 px-3 text-left font-semibold text-navy-900 hover:bg-navy-50">
            <EyeOff className="size-4 shrink-0" aria-hidden="true" /> Not interested
          </button>
        </div>
      ) : null}
    </div>
  );
}
