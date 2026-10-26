import { describe, expect, it } from "vitest";
import { offlineWorker } from "@bitocard/ui/offline-worker";
import { pushServiceWorker } from "../src/push-worker";

type Listener = (event: Record<string, unknown>) => void;

// SHQ serves its push worker and the offline worker as one file (apps/shq/app/push-sw.js/route.ts): both must run.
describe("SHQ's one service worker: push plus installable", () => {
  const source = `${pushServiceWorker}\n${offlineWorker("BitoCard SHQ")}`;
  const listeners: Record<string, Listener[]> = {};
  const shown: string[] = [];
  const self = {
    addEventListener: (type: string, listener: Listener) => (listeners[type] ??= []).push(listener),
    skipWaiting: () => undefined,
    location: { origin: "https://shq.bitocard.com" },
    clients: { claim: async () => undefined },
    registration: { showNotification: async (title: string) => void shown.push(title) },
  };
  new Function("self", "fetch", "Response", source)(self, () => Promise.reject(new TypeError("Failed to fetch")), Response);

  it("still shows push notifications", async () => {
    let done: Promise<unknown> | undefined;
    listeners.push![0]!({ data: { json: () => ({ title: "Order failed" }) }, waitUntil: (promise: Promise<unknown>) => (done = promise) });
    await done;
    expect(shown).toEqual(["Order failed"]);
  });

  it("answers page loads, with SHQ's own offline page when there is no connection", async () => {
    expect(listeners.fetch).toHaveLength(1);
    let answer: Promise<Response> | undefined;
    listeners.fetch![0]!({ request: { mode: "navigate" }, respondWith: (response: Promise<Response>) => (answer = response) });
    const page = await answer!;
    expect(page.status).toBe(503);
    expect(await page.text()).toContain("BitoCard SHQ needs a connection");
  });
});
