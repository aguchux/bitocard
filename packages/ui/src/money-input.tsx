'use client';

import { forwardRef, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { currencyDigits, currencySymbol, formatMoneyInput, parseMoney } from '@bitocard/api-client/money';

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'inputMode' | 'prefix'>;

/**
 * A money field: the currency's sign inside it on the left ("₦", "GH₵", "KSh", "$"), and only an amount can be typed:
 * digits and one decimal point, at most the currency's decimal places, commas put between thousands as it is typed
 * ("1234567" shows "1,234,567"). Letters and other characters are dropped. The form receives what is shown ("1,234.50");
 * read it with `parseMoney` (or strip the commas). Styled by the app: `className` on the input (its own field style;
 * the sign's room is added on the left), `wrapperClassName` on the box around it.
 */
export const MoneyInput = forwardRef<HTMLInputElement, Native & {
  /** ISO 4217 code: picks the sign and the decimal places. */
  currency: string;
  /** The amount as text ("5000", "1,250.5"); cleaned to the field's format. */
  defaultValue?: string | number;
  /** Controlled: the amount as shown ("1,250.50"). */
  value?: string;
  /** What is shown, and the amount in minor units (null while it is not an amount). */
  onValueChange?: (text: string, minor: number | null) => void;
  wrapperClassName?: string;
  /** The sign's colour and weight. */
  symbolClassName?: string;
}>(function MoneyInput({ currency, defaultValue, value, onValueChange, className = '', wrapperClassName = '', symbolClassName = 'font-semibold text-slate-500', style, ...rest }, forwarded) {
  const digits = currencyDigits(currency);
  const symbol = currencySymbol(currency);
  const [own, setOwn] = useState(() => (defaultValue === undefined || defaultValue === null ? '' : formatMoneyInput(String(defaultValue), digits)));
  const shown = value ?? own;
  const input = useRef<HTMLInputElement | null>(null);
  // Where the caret should land after a reformat: after the same number of digits (and point) as before it.
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = input.current;
    if (caret.current === null || !element || document.activeElement !== element) return;
    let seen = 0;
    let position = shown.length;
    for (let index = 0; index < shown.length; index += 1) {
      if (seen === caret.current) {
        position = index;
        break;
      }
      if (/[\d.]/.test(shown[index]!)) seen += 1;
    }
    if (seen < caret.current) position = shown.length;
    element.setSelectionRange(position, position);
    caret.current = null;
  }, [shown]);

  return (
    // Placed with inline styles, never utility classes: an app whose stylesheet does not scan this file would leave
    // the sign loose above the field.
    <div className={wrapperClassName} style={{ position: 'relative' }}>
      <span aria-hidden="true" className={symbolClassName} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', paddingLeft: '0.875rem', pointerEvents: 'none', lineHeight: 1 }}>
        {symbol}
      </span>
      <input
        {...rest}
        ref={element => {
          input.current = element;
          if (typeof forwarded === 'function') forwarded(element);
          else if (forwarded) forwarded.current = element;
        }}
        type="text"
        inputMode={digits ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={shown}
        style={{ ...style, paddingLeft: `calc(0.875rem + ${Math.max(symbol.length, 1) * 0.62}em + 0.375rem)` }}
        className={className}
        onChange={event => {
          const typed = event.target.value;
          const at = event.target.selectionStart ?? typed.length;
          caret.current = typed.slice(0, at).replace(/[^\d.]/g, '').length;
          const next = formatMoneyInput(typed, digits);
          if (value === undefined) setOwn(next);
          onValueChange?.(next, next ? parseMoney(next, currency) : null);
        }}
      />
    </div>
  );
});
