import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { InstallSheet } from "@/components/install-app";
import { installCaptureScript, installed, installRoute, readInstallState, reminded, reminderGapMs, remindersAtMost, shouldRemind } from "@/lib/install";

const hour = reminderGapMs;

describe("install reminders", () => {
  it("ask on the first visit, then at most three times, each an hour after the last", () => {
    let state = readInstallState(null);
    let now = 1_800_000_000_000;
    expect(shouldRemind(state, now)).toBe(true);
    state = reminded(state, now);
    expect(shouldRemind(state, now + hour - 1)).toBe(false);
    now += hour;
    expect(shouldRemind(state, now)).toBe(true);
    state = reminded(state, now);
    now += 3 * hour;
    state = reminded(state, now);
    expect(state.shown).toBe(remindersAtMost);
    expect(shouldRemind(state, now + 100 * hour)).toBe(false);
  });

  it("never ask once installed, nor while the clock reads before the last reminder", () => {
    expect(shouldRemind(installed(readInstallState(null)), 0)).toBe(false);
    const state = reminded(readInstallState(null), 5 * hour);
    expect(shouldRemind(state, 4 * hour)).toBe(false);
  });

  it("survive what is saved, and start again from anything unreadable", () => {
    const state = reminded(readInstallState(null), 1234);
    expect(readInstallState(JSON.stringify(state))).toEqual({ shown: 1, last: 1234, installed: false });
    for (const raw of ["{", "[]", '{"shown":-1,"last":"x"}', '{"shown":1.5}']) expect(readInstallState(raw)).toEqual({ shown: 0, last: 0, installed: false });
  });
});

describe("how a device installs", () => {
  const android = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

  it("the browser's own dialog where it offers one, steps on iPhones and iPads, else nothing", () => {
    expect(installRoute({ hasPrompt: true, userAgent: android, touchPoints: 5 })).toBe("prompt");
    expect(installRoute({ hasPrompt: false, userAgent: android, touchPoints: 5 })).toBe("none");
    expect(installRoute({ hasPrompt: false, userAgent: iphone, touchPoints: 5 })).toBe("ios");
    expect(installRoute({ hasPrompt: false, userAgent: mac, touchPoints: 5 })).toBe("ios");
    expect(installRoute({ hasPrompt: false, userAgent: mac, touchPoints: 0 })).toBe("none");
  });

  it("holds back the browser's own install bar and keeps its event", () => {
    const listeners: Record<string, (event: { preventDefault(): void }) => void> = {};
    const win = { addEventListener: (type: string, listener: (event: { preventDefault(): void }) => void) => (listeners[type] = listener), __bcInstall: undefined as unknown };
    new Function("window", installCaptureScript)(win);
    let prevented = false;
    const event = { preventDefault: () => (prevented = true) };
    listeners.beforeinstallprompt!(event);
    expect(prevented).toBe(true);
    expect(win.__bcInstall).toBe(event);
  });
});

describe("the prompt", () => {
  const sheet = (route: "prompt" | "ios") => renderToStaticMarkup(createElement(InstallSheet, { route, onInstall: () => undefined, onClose: () => undefined }));

  it("offers Install where the browser can, and the two steps on iPhones and iPads", () => {
    expect(sheet("prompt")).toContain(">Install<");
    expect(sheet("prompt")).toContain(">Not now<");
    expect(sheet("prompt")).not.toContain("Add to Home Screen");
    expect(sheet("ios")).toContain("Add to Home Screen");
    expect(sheet("ios")).toContain(">Got it<");
    expect(sheet("ios")).not.toContain(">Install<");
  });

  it("is flat: no rounded corners or shadows anywhere", () => {
    for (const route of ["prompt", "ios"] as const) expect(sheet(route)).not.toMatch(/\b(rounded|shadow)(-[a-z0-9]+)?\b/);
    const source = readFileSync(new URL("../components/install-app.tsx", import.meta.url), "utf8");
    const dialogClass = /<dialog[\s\S]*?className="([^"]+)"/.exec(source)?.[1] ?? "";
    expect(dialogClass.split(" ")).toContain("rounded-none");
    expect(dialogClass).not.toMatch(/\brounded-(?!none)|\bshadow/);
  });
});

describe("the app", () => {
  it("is installable: a standalone manifest with its icons, and a service worker that answers page loads", () => {
    const app = manifest();
    expect([app.display, app.start_url, app.scope, app.id]).toEqual(["standalone", "/", "/", "/"]);
    expect(app.icons?.some(icon => icon.sizes === "512x512")).toBe(true);
    const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
    expect(worker).toContain('addEventListener("fetch"');
    expect(worker).toContain('"/offline.html"');
    expect(readFileSync(new URL("../public/offline.html", import.meta.url), "utf8")).toContain('name="robots" content="noindex"');
  });
});
