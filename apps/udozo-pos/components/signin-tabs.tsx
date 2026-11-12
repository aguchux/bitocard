"use client";

import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

type Tab = "owner" | "staff";
const tabs: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "owner", label: "Shop owner" },
  { key: "staff", label: "Staff" },
];

/**
 * The sign-in card: one card, two tabs (Shop owner, Staff). Arrow keys, Home and End move between the tabs, as the
 * ARIA tabs pattern asks; only the chosen panel is shown.
 */
export function SignInTabs({ owner, staff, initial = "owner" }: { owner: ReactNode; staff: ReactNode; initial?: Tab }) {
  const id = useId();
  const [shown, setShown] = useState<Tab>(initial);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const to = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (to === null) return;
    event.preventDefault();
    const next = (to + tabs.length) % tabs.length;
    setShown(tabs[next]!.key);
    buttons.current[next]?.focus();
  };
  return (
    <div className="rounded-[20px] border border-pos-line bg-white">
      <div role="tablist" aria-label="Sign in as" className="grid grid-cols-2 gap-1 rounded-t-[20px] border-b border-pos-line bg-pos-page/60 p-1.5">
        {tabs.map((tab, index) => {
          const current = shown === tab.key;
          return (
            <button
              key={tab.key}
              ref={element => {
                buttons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${id}-${tab.key}-tab`}
              aria-selected={current}
              aria-controls={`${id}-${tab.key}`}
              tabIndex={current ? 0 : -1}
              onClick={() => setShown(tab.key)}
              onKeyDown={event => move(event, index)}
              className={`h-11 rounded-[14px] text-sm font-semibold transition-colors ${current ? "bg-white text-pos-ink shadow-[0_1px_2px_rgba(16,35,28,0.1)]" : "text-pos-muted hover:text-pos-ink"}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map(tab => (
        <div key={tab.key} role="tabpanel" id={`${id}-${tab.key}`} aria-labelledby={`${id}-${tab.key}-tab`} hidden={shown !== tab.key} className="p-6">
          {tab.key === "owner" ? owner : staff}
        </div>
      ))}
    </div>
  );
}
