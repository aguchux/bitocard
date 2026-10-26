/**
 * When BitoCard Shop asks a visitor to install it as an app (its market's `install_prompt` switch on): at most
 * `remindersAtMost` times, once a visit at most, each at least `reminderGapMs` after the last, never once it is installed
 * or the visitor installed it from our prompt. Kept on the visitor's own device (local storage), never sent to us.
 */
export const installStateKey = "bc_shop_install";
/** Set in session storage once a visit has been considered, so moving between pages never asks again. */
export const installVisitKey = "bc_shop_install_visit";
export const remindersAtMost = 3;
export const reminderGapMs = 60 * 60 * 1000;
/** How long after a page opens the prompt waits, so the visitor sees the page first. */
export const promptDelayMs = 4000;

/**
 * Runs in the page's <head> on every page: holds back the browser's own install bar and keeps its install event for our
 * prompt, which asks only where an admin switched it on. Inline, because the event can fire before React has started.
 */
export const installCaptureScript = `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__bcInstall=e;});`;

export type InstallState = { shown: number; last: number; installed: boolean };

const fresh: InstallState = { shown: 0, last: 0, installed: false };

/** The saved state; anything unreadable starts again. */
export function readInstallState(raw: string | null | undefined): InstallState {
  if (!raw) return fresh;
  try {
    const value = JSON.parse(raw) as Partial<InstallState>;
    const shown = Number.isInteger(value.shown) && value.shown! >= 0 ? value.shown! : 0;
    const last = typeof value.last === "number" && Number.isFinite(value.last) && value.last >= 0 ? value.last : 0;
    return { shown, last, installed: value.installed === true };
  } catch {
    return fresh;
  }
}

/** Whether this visit may ask. A clock set back (the last reminder "in the future") waits as if it were now. */
export function shouldRemind(state: InstallState, now: number): boolean {
  if (state.installed || state.shown >= remindersAtMost) return false;
  return state.shown === 0 || now - state.last >= reminderGapMs;
}

/** The state after asking once. */
export const reminded = (state: InstallState, now: number): InstallState => ({ ...state, shown: state.shown + 1, last: now });

/** The state once installed: never asked again. */
export const installed = (state: InstallState): InstallState => ({ ...state, installed: true });

/**
 * How this device installs: `prompt` where the browser offers its install dialog (Chrome, Edge, Samsung Internet and
 * others, known only when it fires `beforeinstallprompt`), `ios` on iPhones and iPads (Share, then Add to Home Screen),
 * else `none` (nothing we can offer, so nothing is shown or counted).
 */
export function installRoute({ hasPrompt, userAgent, touchPoints }: { hasPrompt: boolean; userAgent: string; touchPoints: number }): "prompt" | "ios" | "none" {
  if (hasPrompt) return "prompt";
  // iPadOS reports a Mac; a Mac with a touch screen is an iPad.
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return "ios";
  return "none";
}
