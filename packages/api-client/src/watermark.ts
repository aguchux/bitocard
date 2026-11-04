// Udozo's photo watermark text: the one rule shared by the admin (Udozo's text) and Seller HQ (a store's own text),
// matching the API's (docs/UDOZO_WATERMARK_PLAN.md). The API decides; this only says what is wrong before asking.

/** 2 to 30 characters of letters (accented Latin ones too, as the API allows), digits, spaces and `. - _ @`. */
export const watermarkTextPattern = /^[A-Za-z0-9À-ÖØ-öø-ÿ ._@-]{2,30}$/;
export const watermarkTextMax = 30;

/** Why a watermark text cannot be saved, in plain words, or null when it can. Spaces at either end are ignored. */
export function watermarkTextProblem(value: string): string | null {
  const text = value.trim();
  if (text.length < 2) return 'Use at least 2 characters.';
  if (text.length > watermarkTextMax) return `Use at most ${watermarkTextMax} characters.`;
  if (!watermarkTextPattern.test(text)) return 'Use only letters, digits, spaces and . - _ @';
  return null;
}
