// The account pages' microphone prompt: when a signed-in customer is asked to allow their microphone for calls, what the
// dialog says in each state, and that it is on the account pages only for confirmed customers.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { micPromptDue, micPromptKey, micPromptPauseMs, micPromptText, readMicPrompt } from "@/lib/microphone";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/account", useSearchParams: () => new URLSearchParams() }));

const { MicPromptBody, MicrophonePrompt } = await import("@/components/calls/microphone-prompt");

const now = Date.parse("2026-11-01T12:00:00Z");
const ask = { available: true, supported: true, permission: "prompt" as const, memory: null, now };

describe("when the prompt asks", () => {
  test("where calls are set up and the browser has not allowed the microphone", () => {
    expect(micPromptDue(ask)).toBe(true);
    expect(micPromptDue({ ...ask, permission: "denied" })).toBe(true);
    expect(micPromptDue({ ...ask, permission: null })).toBe(true);
  });

  test("never once it is allowed, where calls are not set up, or where the browser cannot use a microphone", () => {
    expect(micPromptDue({ ...ask, permission: "granted" })).toBe(false);
    expect(micPromptDue({ ...ask, available: false })).toBe(false);
    expect(micPromptDue({ ...ask, supported: false })).toBe(false);
  });

  test("Not now waits three days; where the browser does not say (Firefox), a microphone allowed before counts", () => {
    const declined = { asked_at: now - 60_000, allowed: false };
    expect(micPromptDue({ ...ask, memory: declined })).toBe(false);
    expect(micPromptDue({ ...ask, memory: { ...declined, asked_at: now - micPromptPauseMs - 1 } })).toBe(true);
    expect(micPromptDue({ ...ask, permission: null, memory: { asked_at: now - 60_000, allowed: true } })).toBe(false);
    // Allowed before but the browser now asks again (permission reset): asked again.
    expect(micPromptDue({ ...ask, memory: { asked_at: now - 60_000, allowed: true } })).toBe(true);
  });

  test("what is remembered is read safely", () => {
    expect(micPromptKey).toBe("udz_microphone_prompt");
    expect(readMicPrompt(JSON.stringify({ asked_at: now, allowed: false }))).toEqual({ asked_at: now, allowed: false });
    expect(readMicPrompt(null)).toBeNull();
    expect(readMicPrompt("not json")).toBeNull();
    expect(readMicPrompt(JSON.stringify({ asked_at: "yesterday", allowed: true }))).toBeNull();
  });
});

describe("the dialog", () => {
  const draw = (state: Parameters<typeof MicPromptBody>[0]["state"]) => renderToStaticMarkup(createElement(MicPromptBody, { state, onAllow: () => undefined, onClose: () => undefined }));

  test("asks to allow the microphone so calls with buyers and sellers work, and says calls are private", () => {
    const html = draw("ask");
    expect(html).toContain("Allow your microphone for calls");
    expect(html).toContain("call buyers and sellers");
    expect(html).toContain("Allow microphone");
    expect(html).toContain("Not now");
    expect(html).toContain("no phone numbers are shared");
  });

  test("blocked, it says how to allow it on computers, iPhones and Android, then Check again", () => {
    const html = draw("blocked");
    expect(html).toContain("blocking the microphone for udozo.com");
    for (const where of ["On a computer", "On iPhone or iPad", "On Android"]) expect(html).toContain(where);
    expect(html).toContain("Check again");
    expect(micPromptText("missing").text).toContain("could not find a microphone");
    expect(micPromptText("in_use").text).toContain("Another app is using your microphone");
  });

  test("while the browser asks, the button waits; once allowed, it says the microphone is ready", () => {
    expect(draw("working")).toMatch(/disabled=""[^>]*>.*Waiting for your browser/);
    const done = draw("done");
    expect(done).toContain("Your microphone is ready");
    expect(done).toContain("Done");
    expect(done).not.toContain("Not now");
  });

  test("draws nothing until it has decided to ask (and never outside calls)", () => {
    expect(renderToStaticMarkup(createElement(MicrophonePrompt))).toBe("");
  });

  test("the account pages show it to signed-in, confirmed customers only", () => {
    const layout = readFileSync(new URL("../app/(account)/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain("{counts ? <MicrophonePrompt /> : null}");
  });
});
