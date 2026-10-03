'use client';

import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '../format';

/**
 * A one-time code as separate digit boxes (authenticator codes). Typing moves to the next box, Backspace goes back,
 * arrow keys move, and pasting or autofilling a whole code fills every box. `onComplete` fires once all digits are in.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  label,
  id,
  autoFocus,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  /** Read out for the group; each box is announced as "Digit n of 6". */
  label: string;
  id?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, index) => value[index] ?? '');
  const focus = (index: number) => boxes.current[Math.max(0, Math.min(length - 1, index))]?.focus();

  const update = (next: string, focusAt?: number) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (focusAt !== undefined) focus(focusAt);
    if (clean.length === length) onComplete?.(clean);
  };

  /** Writes typed (or autofilled) digits over the boxes from `index` on; digits stay contiguous from the first box. */
  const fillFrom = (index: number, typed: string) => {
    const incoming = typed.replace(/\D/g, '');
    if (!incoming) return;
    const start = Math.min(index, value.length);
    const next = (value.slice(0, start) + incoming + value.slice(start + incoming.length)).slice(0, length);
    update(next, Math.min(start + incoming.length, length - 1));
  };

  const onType = (index: number, raw: string) => {
    if (raw === '') return update(value.slice(0, index) + value.slice(index + 1), index);
    // The box's own digit may still be there when the caret was after it: keep only what was added.
    const digit = digits[index];
    fillFrom(index, raw.length > 1 && digit ? raw.replace(digit, '') : raw);
  };

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index]) update(value.slice(0, index) + value.slice(index + 1), index);
      else if (index > 0) update(value.slice(0, index - 1) + value.slice(index), index - 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focus(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focus(index + 1);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (pasted) update(pasted, Math.min(pasted.length, length - 1));
  };

  return (
    <div role="group" aria-label={label} id={id} className="flex justify-between gap-2 sm:gap-3">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={element => {
            boxes.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${index + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          autoFocus={autoFocus && index === 0}
          disabled={disabled}
          // A whole code may arrive in one box (autofill), so allow more than one character and spread it out.
          maxLength={length}
          value={digit}
          onChange={event => onType(index, event.target.value)}
          onKeyDown={onKeyDown(index)}
          onPaste={onPaste}
          onFocus={event => event.target.select()}
          className={cn(
            'h-14 w-full min-w-0 max-w-14 rounded-lg border bg-white text-center font-mono text-2xl font-semibold text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-canvas',
            invalid ? 'border-red-400' : 'border-line',
          )}
        />
      ))}
    </div>
  );
}
