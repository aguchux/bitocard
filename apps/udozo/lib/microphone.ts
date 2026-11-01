/**
 * The account pages' microphone prompt: whether to ask a signed-in customer to allow their microphone for calls, and
 * what is remembered in their browser (`udz_microphone_prompt`, in the cookie notice) so they are not asked too often.
 */
export const micPromptKey = "udz_microphone_prompt";

/** After Not now, the prompt waits this long before asking again. */
export const micPromptPauseMs = 3 * 24 * 60 * 60 * 1000;

/** What the browser says about the microphone for this site; null where it does not say (Firefox). */
export type MicPermission = "granted" | "prompt" | "denied" | null;

/** When the person was last asked, and whether the microphone was allowed then. */
export type MicPromptMemory = { asked_at: number; allowed: boolean } | null;

export function readMicPrompt(raw: string | null): MicPromptMemory {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<{ asked_at: unknown; allowed: unknown }>;
    return typeof value.asked_at === "number" && typeof value.allowed === "boolean" ? { asked_at: value.asked_at, allowed: value.allowed } : null;
  } catch {
    return null;
  }
}

/**
 * Whether to ask: calls are set up here, the browser can use a microphone, it is not allowed already, and the person
 * did not choose Not now in the last three days. Where the browser does not say (Firefox), a microphone allowed here
 * before is taken as allowed.
 */
export function micPromptDue(input: { available: boolean; supported: boolean; permission: MicPermission; memory: MicPromptMemory; now: number }) {
  const { available, supported, permission, memory, now } = input;
  if (!available || !supported || permission === "granted") return false;
  if (permission === null && memory?.allowed) return false;
  if (memory && !memory.allowed && now - memory.asked_at < micPromptPauseMs) return false;
  return true;
}

export type MicPromptState = "ask" | "working" | "blocked" | "missing" | "in_use" | "done";

/** What the prompt says in each state, and its main button (null: none). */
export function micPromptText(state: MicPromptState) {
  switch (state) {
    case "blocked":
      return { title: "Your microphone is blocked", text: "Your browser is blocking the microphone for udozo.com, so you cannot make or answer calls. Allow it in your browser, then check again:", steps: true, action: "Check again" };
    case "missing":
      return { title: "No microphone found", text: "We could not find a microphone. Plug in a headset or microphone, then check again.", steps: false, action: "Check again" };
    case "in_use":
      return { title: "Your microphone is busy", text: "Another app is using your microphone. Close it (or end the call there), then check again.", steps: false, action: "Check again" };
    case "done":
      return { title: "Your microphone is ready", text: "You can now call buyers and sellers, and answer their calls, right here on Udozo.", steps: false, action: null };
    default:
      return {
        title: "Allow your microphone for calls",
        text: "On Udozo you can call buyers and sellers from your browser. Allow your microphone now so you are ready to make and answer calls. When your browser asks, choose Allow.",
        steps: false,
        action: "Allow microphone",
      };
  }
}
