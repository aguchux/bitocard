'use client';

import { useId, useState } from 'react';
import { checkPhone, dialCode, formatNational } from './phone';

/**
 * An account phone field locked to one country: its flag and dialling code are shown, not chosen, the number is
 * formatted as it is typed and checked as a mobile number of that country, and the form receives it in E.164 in a hidden
 * field named `name` (empty while it is not valid, so nothing else is sent). The API checks it again.
 */
export function PhoneInput({
  country,
  name = 'phone',
  label = 'Mobile number',
  defaultValue = '',
  onChange,
  className = '',
  inputClassName = '',
  errorClassName = '',
  prefixClassName = 'border-brand-500 bg-brand-500 text-white',
  required,
  disabled,
}: {
  /** ISO 3166-1 alpha-2: the account's country. */
  country: string;
  name?: string;
  label?: string;
  defaultValue?: string;
  /** The number in E.164 when valid, else null. */
  onChange?: (e164: string | null) => void;
  className?: string;
  inputClassName?: string;
  errorClassName?: string;
  /** The locked country prefix; the app's primary colour by default. */
  prefixClassName?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [typed, setTyped] = useState(defaultValue ? formatNational(defaultValue, country) : '');
  const [touched, setTouched] = useState(false);
  const check = checkPhone(typed, country);
  const showError = touched && !check.ok && check.error;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <div className="flex min-w-0 items-stretch">
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-l-xl border px-3 text-sm font-semibold tabular-nums ${prefixClassName}`} aria-label={`Country code ${dialCode(country)}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the app's own tiny flag file (`/flags/<code>.svg`); emoji flags show as letters on Windows */}
          <img src={`/flags/${country.toLowerCase()}.svg`} alt="" width={20} height={14} className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover ring-1 ring-white/40" />
          {dialCode(country)}
        </span>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={typed}
          required={required}
          disabled={disabled}
          aria-invalid={showError ? true : undefined}
          aria-describedby={showError ? `${id}-error` : undefined}
          onChange={event => {
            const next = formatNational(event.target.value, country);
            setTyped(next);
            const result = checkPhone(next, country);
            // The browser refuses to submit the form while the number is not valid for the country.
            event.target.setCustomValidity(result.ok || !next.trim() ? '' : (result.error ?? ''));
            onChange?.(result.ok ? result.e164 : null);
          }}
          onBlur={() => setTouched(true)}
          className={`min-w-0 flex-1 rounded-r-xl ${inputClassName}`}
        />
      </div>
      <input type="hidden" name={name} value={check.ok ? check.e164 : ''} />
      {showError ? (
        <p id={`${id}-error`} role="alert" className={`mt-1.5 text-sm ${errorClassName}`}>
          {check.error}
        </p>
      ) : null}
    </div>
  );
}
