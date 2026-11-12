"use client";

import { type ClipboardEvent, type KeyboardEvent, useId, useRef } from "react";

/**
 * A PIN as one box per digit (6 by default): typing moves to the next box, Backspace on an empty box goes back, the
 * arrows move between boxes, and a pasted PIN fills them all. Each digit shows as a dot; the PIN itself is never shown.
 */
export function PinBoxes({ value, onChange, label, disabled = false, autoFocus = false, length = 6 }: { value: string; onChange: (pin: string) => void; label: string; disabled?: boolean; autoFocus?: boolean; length?: number }) {
  const id = useId();
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const focus = (index: number) => boxes.current[Math.max(0, Math.min(length - 1, index))]?.focus();
  const digits = Array.from({ length }, (_, index) => value[index] ?? "");

  const put = (index: number, typed: string) => {
    const clean = typed.replace(/\D/g, "");
    if (!clean) return;
    // Digits typed (or a phone's one-time code filling one box) go in from this box on.
    const next = (value.slice(0, index) + clean).slice(0, length);
    onChange(next);
    focus(next.length);
  };
  const key = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      if (digits[index]) onChange(value.slice(0, index));
      else if (index > 0) {
        onChange(value.slice(0, index - 1));
        focus(index - 1);
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focus(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focus(index + 1);
    }
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    focus(pasted.length);
  };

  return (
    <fieldset className="grid gap-3" disabled={disabled}>
      <legend id={id} className="mb-3 text-sm font-semibold text-pos-ink-2">
        {label}
      </legend>
      <div className="flex justify-between gap-2 sm:gap-3">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={element => {
              boxes.current[index] = element;
            }}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={length}
            value={digit}
            aria-label={`${label}, digit ${index + 1} of ${length}`}
            autoFocus={autoFocus && index === 0}
            // A box can be filled only in order: clicking ahead lands on the first empty one.
            onFocus={() => {
              if (index > value.length) focus(value.length);
            }}
            // A box that already held a digit now holds two: keep the new one.
            onChange={event => put(index, digit && event.target.value.length > 1 ? event.target.value.replace(digit, "") : event.target.value)}
            onKeyDown={event => key(index, event)}
            onPaste={paste}
            className="h-14 w-full min-w-0 rounded-xl border border-pos-line bg-white text-center font-display text-2xl text-pos-ink focus:border-pos-600 focus:outline-none focus:ring-2 focus:ring-pos-600/30 disabled:opacity-50 sm:h-16"
          />
        ))}
      </div>
    </fieldset>
  );
}
