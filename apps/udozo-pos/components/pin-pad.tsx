"use client";

import { useId } from "react";

const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;

/**
 * A 4-digit PIN: typed (a password field with the number keyboard on phones) or tapped on the keypad, as a till's
 * touch screen needs. Each digit shows as a dot; the PIN itself is never shown.
 */
export function PinPad({ value, onChange, label = "PIN", disabled = false, autoFocus = false }: { value: string; onChange: (pin: string) => void; label?: string; disabled?: boolean; autoFocus?: boolean }) {
  const id = useId();
  const press = (key: (typeof keys)[number]) => {
    if (key === "back") onChange(value.slice(0, -1));
    else if (key && value.length < 4) onChange(value + key);
  };
  return (
    <div className="grid gap-3">
      <label htmlFor={id} className="text-sm font-semibold text-pos-ink-2">
        {label}
      </label>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={event => onChange(event.target.value.replace(/\D/g, "").slice(0, 4))}
        className="h-14 w-full rounded-xl border border-pos-line bg-white px-4 text-center font-display text-3xl tracking-[0.6em]"
      />
      <div className="grid grid-cols-3 gap-2" aria-hidden="true">
        {keys.map((key, index) =>
          key ? (
            <button key={key} type="button" tabIndex={-1} disabled={disabled} onClick={() => press(key)} className="h-14 rounded-xl border border-pos-line bg-white font-display text-2xl font-bold text-pos-ink hover:bg-pos-50 disabled:opacity-50">
              {key === "back" ? "⌫" : key}
            </button>
          ) : (
            <span key={`blank-${index}`} />
          ),
        )}
      </div>
    </div>
  );
}
