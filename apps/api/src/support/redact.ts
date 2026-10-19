/**
 * Masks what must never reach an AI provider or come back from one: card, account and phone-length digit runs, codes
 * that look like gift card codes or licence keys (groups of capitals and digits joined by dashes, or one long run), and
 * anything written after "pin", "password" or similar. Applied to requesters' words before they are sent and to answers
 * before they are shown, so neither side ever carries a secret.
 */
const patterns: Array<[RegExp, string]> = [
  // A PIN, password or one-time code given after its name.
  [/\b(pin|password|passcode|otp|cvv|cvc)\b(\s*(?:is|:|=|-)?\s*)\S+/gi, '$1$2[hidden]'],
  // Long runs of digits (cards, bank accounts, BVNs), allowing spaces or dashes between groups.
  [/\b\d(?:[ -]?\d){11,}\b/g, '[number hidden]'],
  // Codes and keys: 3 or more groups of 3 to 8 capitals or digits joined by dashes (XXXX-XXXX-XXXX), with a digit.
  [/\b(?=[A-Z0-9-]*\d)[A-Z0-9]{3,8}(?:-[A-Z0-9]{3,8}){2,}\b/g, '[code hidden]'],
  // A single long unbroken code mixing letters and digits (16 or more characters).
  [/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{16,}\b/gi, '[code hidden]'],
];

export function redact(text: string) {
  let masked = text;
  for (const [pattern, replacement] of patterns) masked = masked.replace(pattern, replacement);
  return masked;
}
