import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";
import { InstallSheet } from "@bitocard/ui/install-ui";
import { offlineWorker } from "@bitocard/ui/offline-worker";
import { GET } from "@/app/sw.js/route";
import { installCaptureScript, installed, installRoute, readInstallState, reminded, reminderGapMs, remindersAtMost, shouldRemind } from "@bitocard/ui/install";

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
  const sheet = (route: "prompt" | "ios") => renderToStaticMarkup(createElement(InstallSheet, { route, appName: "Udozo", onInstall: () => undefined, onClose: () => undefined }));

  it("names the site, offers Install where the browser can, and the two steps on iPhones and iPads", () => {
    expect(sheet("prompt")).toContain("Install Udozo");
    expect(sheet("prompt")).toContain(">Install<");
    expect(sheet("prompt")).toContain(">Not now<");
    expect(sheet("prompt")).not.toContain("Add to Home Screen");
    expect(sheet("ios")).toContain("Add to Home Screen");
    expect(sheet("ios")).toContain(">Got it<");
    expect(sheet("ios")).not.toContain(">Install<");
  });

  it("is flat: no rounded corners or shadows anywhere", () => {
    for (const route of ["prompt", "ios"] as const) expect(sheet(route)).not.toMatch(/\b(rounded|shadow)(-[a-z0-9]+)?\b/);
    const source = readFileSync(new URL("../../../packages/ui/src/install-ui.tsx", import.meta.url), "utf8");
    const dialogClass = /<dialog[\s\S]*?className="([^"]+)"/.exec(source)?.[1] ?? "";
    expect(dialogClass.split(" ")).toContain("rounded-none");
    expect(dialogClass).not.toMatch(/\brounded-(?!none)|\bshadow/);
  });
});

type Listener = (event: Record<string, unknown>) => void;

/** Runs a service worker's source in a stand-in for its scope and returns what it listens for. */
function runWorker(source: string, fetchImpl: () => Promise<Response>) {
  const listeners: Record<string, Listener> = {};
  const self = { addEventListener: (type: string, listener: Listener) => (listeners[type] = listener), skipWaiting: () => undefined, clients: { claim: async () => undefined }, registration: {} };
  new Function("self", "fetch", "Response", source)(self, fetchImpl, Response);
  return listeners;
}

/** A page load (or another request) through the worker: the response it gave, or null when it left it to the network. */
async function load(listeners: Record<string, Listener>, mode: string, preloadResponse?: Promise<Response | undefined>) {
  const given: { answer?: Promise<Response> } = {};
  listeners.fetch!({ request: { mode }, preloadResponse, respondWith: (response: Promise<Response>) => (given.answer = response) });
  return given.answer ? await given.answer : null;
}

describe("the app", () => {
  it("is installable: a standalone manifest with its icons, and its service worker at /sw.js", async () => {
    // The theme cannot be read: the manifest still answers, in the fallback colours.
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    const app = await manifest();
    vi.unstubAllGlobals();
    expect([app.display, app.start_url, app.scope, app.id, app.theme_color, app.name]).toEqual(["standalone", "/", "/", "/", "#070f4c", "Udozo – Buy and sell near you"]);
    expect(app.icons?.some(icon => icon.sizes === "512x512")).toBe(true);
    const res = GET();
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(await res.text()).toBe(offlineWorker("Udozo"));
  });

  it("the worker serves pages from the network, and its own page only when there is no connection", async () => {
    const online = runWorker(offlineWorker("Udozo"), async () => new Response("from the network"));
    expect(await (await load(online, "navigate"))!.text()).toBe("from the network");
    expect(await (await load(online, "navigate", Promise.resolve(new Response("preloaded"))))!.text()).toBe("preloaded");
    expect(await load(online, "cors"), "images, scripts and API calls never go through it").toBeNull();
    const offline = runWorker(offlineWorker('Shop <"&">'), () => Promise.reject(new TypeError("Failed to fetch")));
    const page = (await load(offline, "navigate"))!;
    expect(page.status).toBe(503);
    const html = await page.text();
    expect(html).toContain("You are offline");
    expect(html).toContain("Shop &#60;&#34;&#38;&#34;&#62; needs a connection");
    expect(html).toContain('name="robots" content="noindex"');
  });
});