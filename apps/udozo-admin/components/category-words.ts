/** Search words as text to edit: one a line. */
export const wordsText = (words: string[]) => words.join("\n");

/** Edited text as search words: one per line or comma, trimmed, lower case, single spaces, each once. */
export function textWords(text: string) {
  const seen = new Set<string>();
  for (const word of text.split(/[\n,]/)) {
    const clean = word.trim().toLowerCase().replace(/\s+/g, " ");
    if (clean.length >= 2) seen.add(clean);
  }
  return [...seen];
}
