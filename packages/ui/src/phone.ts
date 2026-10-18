import { AsYouType, type CountryCode, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/mobile';

/**
 * Account phone numbers, checked the same way the API checks them (`normalisePhone`): a mobile number from the
 * account's own country (a reseller's business country, a customer's fixed country), sent in E.164 form.
 */
export type PhoneCheck = { ok: true; e164: string } | { ok: false; error: string | null };

/** The country's dialling code with its plus, for example `+234`. */
export const dialCode = (country: string) => `+${getCountryCallingCode(country as CountryCode)}`;

/** The country's flag as emoji (regional indicator letters), for a compact prefix without an image. */
export const flagEmoji = (country: string) => country.toUpperCase().replace(/./g, letter => String.fromCodePoint(0x1f1a5 + letter.charCodeAt(0)));

/** What the person typed, formatted as a national number as they type (`0803 123 4567`). */
export const formatNational = (input: string, country: string) => new AsYouType(country as CountryCode).input(input);

/**
 * Whether what was typed is a mobile number in `country`: with or without the dialling code, spaces and dashes allowed.
 * `error` is null while nothing has been typed.
 */
export function checkPhone(input: string, country: string): PhoneCheck {
  const typed = input.trim();
  if (!typed) return { ok: false, error: null };
  const parsed = parsePhoneNumberFromString(typed, country as CountryCode);
  if (parsed?.isValid() && parsed.country && parsed.country !== country) return { ok: false, error: `Use a mobile number from your country (${dialCode(country)}).` };
  const type = parsed?.getType();
  if (!parsed?.isValid() || (type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE')) return { ok: false, error: `Enter a valid mobile number for ${dialCode(country)}.` };
  return { ok: true, e164: parsed.number };
}
