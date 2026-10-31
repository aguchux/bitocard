/**
 * The languages shop assistants may speak, as BCP 47 codes with the names people know them by. An assistant answers in
 * the person's language when it is one of its own, else in its main one (its first). Admins may use any valid code; the
 * names below are for the ones BitoCard's markets use most.
 */
export const languageNames: Record<string, string> = {
  en: 'English',
  fr: 'French',
  pt: 'Portuguese',
  ar: 'Arabic',
  yo: 'Yoruba',
  ha: 'Hausa',
  ig: 'Igbo',
  pcm: 'Nigerian Pidgin',
  sw: 'Swahili',
  tw: 'Twi',
  ak: 'Akan',
  ee: 'Ewe',
  ga: 'Ga',
  am: 'Amharic',
  zu: 'Zulu',
  xh: 'Xhosa',
  af: 'Afrikaans',
  so: 'Somali',
  rw: 'Kinyarwanda',
  wo: 'Wolof',
};

export const languagePattern = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

export const languageName = (code: string) => languageNames[code] ?? languageNames[code.split('-')[0]] ?? code;

/**
 * The language to answer in: the one asked for when the assistant speaks it (or its base language, `fr` for `fr-CI`),
 * else the assistant's main language.
 */
export function answerLanguage(spoken: readonly string[], asked: string | null | undefined) {
  if (!spoken.length) return 'en';
  if (asked) {
    const exact = spoken.find(code => code.toLowerCase() === asked.toLowerCase());
    if (exact) return exact;
    const base = asked.split('-')[0].toLowerCase();
    const near = spoken.find(code => code.split('-')[0].toLowerCase() === base);
    if (near) return near;
  }
  return spoken[0];
}

/** The greeting for a language, else the main language's, else none. */
export function greetingFor(bot: { languages: string[]; greetings: unknown; greeting: string | null }, language: string) {
  const greetings = (bot.greetings ?? {}) as Record<string, string>;
  return greetings[language] ?? greetings[bot.languages[0] ?? 'en'] ?? bot.greeting ?? null;
}
