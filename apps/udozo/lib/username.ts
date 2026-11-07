import { usernamePattern, type UsernameAvailability, type UsernameStatus } from "@bitocard/api-client/classifieds";

/**
 * Usernames on udozo.com (docs/UDOZO_USERNAMES_PLAN.md): what the Username screen, the account pages' banner and the
 * seller's own page say, and the field's checking as people type. Pure, so the browser and the server share it; the
 * API decides every rule again.
 */

/** Where a customer chooses theirs. */
export const usernameScreen = "/account/profile/username";

/** How long the field waits after the last key before it asks whether a username is free. */
export const usernameCheckDelay = 400;

/** The rule, as the field shows it. */
export const usernameRule = "3 to 24 characters: lower-case letters, numbers and underscores, starting with a letter.";

/** What they typed, as it will be kept: lower case, with no spaces. */
export const usernameInput = (raw: string) => raw.toLowerCase().replace(/\s+/g, "").slice(0, 40);

/** What is wrong with a username before the API is asked (nothing typed is not a problem yet), else null. */
export function usernameProblem(value: string): string | null {
  if (!value) return null;
  if (usernamePattern.test(value)) return null;
  if (!/^[a-z]/.test(value)) return `Start with a letter. ${usernameRule}`;
  if (value.length < 3) return `Too short. ${usernameRule}`;
  if (value.length > 24) return `Too long. ${usernameRule}`;
  return `Only lower-case letters, numbers and underscores. ${usernameRule}`;
}

/** What the field says about the API's answer: whether it is free, else why not, in words. */
export function availabilityText(result: Pick<UsernameAvailability, "available" | "reason" | "username">): { tone: "ok" | "own" | "no"; text: string } {
  if (result.available) return { tone: "ok", text: `${result.username} is free.` };
  switch (result.reason) {
    case "own":
      return { tone: "own", text: "This is already yours." };
    case "taken":
      return { tone: "no", text: "Someone already has this username. Try another." };
    case "reserved":
      return { tone: "no", text: "This name is kept for Udozo. Try another." };
    case "refused":
      return { tone: "no", text: "This username is not allowed. Try another." };
    default:
      return { tone: "no", text: usernameRule };
  }
}

/** The API's refusal of a save or a check, in words (its own message where it carries a number or a date). */
export function usernameErrorText(error: { status: number; code: string | null; message: string }): string {
  if (error.status === 401) return "Sign in again to carry on.";
  switch (error.code) {
    case "username_taken":
      return "Someone already has this username. Try another.";
    case "username_reserved":
      return "This name is kept for Udozo. Try another.";
    case "username_refused":
      return "This username is not allowed. Try another.";
    case "username_invalid":
      return usernameRule;
    case "username_check_limit":
      return "Too many checks just now. Wait a minute, then try again.";
    case "username_change_too_soon":
      return error.message || "You can change your username once every 30 days.";
    case "username_not_eligible":
      return error.message || "Post more ads before choosing a username.";
    default:
      return error.message || "Something went wrong. Try again.";
  }
}

/** Ads still to post before they can choose one (never below zero). */
export const adsToGo = (status: Pick<UsernameStatus, "posted" | "required">) => Math.max(0, status.required - status.posted);

/** "Post 3 more ads to choose a username". */
export function moreAdsText(status: Pick<UsernameStatus, "posted" | "required">) {
  const left = Math.max(1, adsToGo(status));
  return `Post ${left} more ad${left === 1 ? "" : "s"} to choose a username`;
}

/** When they may change it next, in words; null while they can now (or have none). */
export function changeAfterText(status: Pick<UsernameStatus, "username" | "change_after">, now = Date.now()) {
  if (!status.username || !status.change_after) return null;
  const at = new Date(status.change_after);
  if (Number.isNaN(at.getTime()) || at.getTime() <= now) return null;
  return `You can change it again from ${at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.`;
}

/** Whether the account pages' banner asks them to choose one. */
export const bannerShown = (status: Pick<UsernameStatus, "prompt"> | null | undefined) => status?.prompt === true;

/** The card on the seller's own page while they have no username: choose one, or how many ads first. Null once they have one. */
export function usernameNudge(status: Pick<UsernameStatus, "username" | "eligible" | "posted" | "required">) {
  if (status.username) return null;
  return status.eligible
    ? { title: "Choose a username for a better address", body: "Your page's address becomes your name: easier to share and to remember.", action: "Choose a username", href: usernameScreen }
    : { title: moreAdsText(status), body: "Then your page's address can be your name instead of random letters.", action: "About usernames", href: usernameScreen };
}

/**
 * The field's checking: `check(value)` waits `delay` after the last call before asking, and only the newest question's
 * answer is ever passed on (an older one arriving later is dropped). `cancel()` stops what is waiting.
 */
export function usernameChecker<T>(ask: (value: string) => Promise<T>, answer: (value: string, result: T) => void, delay = usernameCheckDelay) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest = 0;
  return {
    check(value: string) {
      if (timer) clearTimeout(timer);
      const asked = ++latest;
      timer = setTimeout(() => {
        timer = null;
        void ask(value).then(result => {
          if (asked === latest) answer(value, result);
        });
      }, delay);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      latest += 1;
    },
  };
}

/**
 * What goes beside a seller's name on their page: their `@username` for everyone; on their own page also **Change**,
 * or, with none yet, **Choose a username** (or how many ads first). Null when there is nothing to show.
 */
export function usernameLine(username: string | null | undefined, own: boolean, status: Pick<UsernameStatus, "eligible" | "posted" | "required"> | null) {
  if (username) return { username: `@${username}`, action: own ? { text: "Change", href: usernameScreen } : null };
  if (!own) return null;
  return { username: null, action: { text: !status || status.eligible ? "Choose a username" : moreAdsText(status), href: usernameScreen } };
}
