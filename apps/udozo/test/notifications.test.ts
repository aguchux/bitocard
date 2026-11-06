// A customer's notifications on udozo.com: the header's bell, Account > Notifications (opening a notice marks it read
// and goes only to a page of this site), and push for their browsers through the service worker.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";
import { addPushDevice, readAllNotifications, readNotification, removePushDevice, setPushPreference, unreadNotifications } from "@/lib/notification-actions";
import { badgeText, noticeHref, noticeWhen } from "@/lib/notifications";
import { udozoPushWorker } from "@/lib/push-worker";
import { keyBytes } from "@/components/notifications/push-controls";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let answer: () => Response;

beforeEach(() => {
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  vi.stubEnv("API_URL", "https://api.test");
  calls = [];
  answer = () => Response.json({ object: "unread_count", count: 4 });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    return answer();
  });
  setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const id = "4b0f1c7e-2a9d-4f3e-8c1b-5d6e7f8a9b0c";

describe("where a notice opens", () => {
  test("a page of udozo.com only; anything else opens the inbox", () => {
    expect(noticeHref("/account/orders/123")).toBe("/account/orders/123");
    expect(noticeHref("https://evil.example/x")).toBe("/account/notifications");
    expect(noticeHref("//evil.example")).toBe("/account/notifications");
    expect(noticeHref("/\\evil.example")).toBe("/account/notifications");
    expect(noticeHref(null)).toBe("/account/notifications");
  });

  test("when it came, in words, and the badge's count", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    expect(noticeWhen("2026-11-06T11:59:40Z", now)).toBe("Just now");
    expect(noticeWhen("2026-11-06T11:15:00Z", now)).toBe("45 min ago");
    expect(noticeWhen("2026-11-06T07:00:00Z", now)).toBe("5 h ago");
    expect(noticeWhen("2026-11-02T07:00:00Z", now)).toBe("2 Nov");
    expect(noticeWhen("2025-11-02T07:00:00Z", now)).toBe("2 Nov 2025");
    expect([badgeText(7), badgeText(140)]).toEqual(["7", "99+"]);
  });
});

describe("the inbox's actions", () => {
  test("the unread count, reading one and reading all, through the customer's session", async () => {
    expect(await unreadNotifications()).toBe(4);
    expect(calls.at(-1)).toMatchObject({ url: "https://api.test/v1/store/account/notifications/unread-count", method: "GET" });
    answer = () => Response.json({ object: "notification", id, read: true });
    expect(await readNotification(id)).toBe(true);
    expect(calls.at(-1)).toMatchObject({ url: `https://api.test/v1/store/account/notifications/${id}/read`, method: "POST" });
    expect(await readNotification("../../admin")).toBe(false);
    expect(calls).toHaveLength(2);
    answer = () => Response.json({ object: "notifications_read", updated: 3 });
    expect(await readAllNotifications()).toEqual({ ok: true });
    expect(calls.at(-1)?.url).toBe("https://api.test/v1/store/account/notifications/read-all");
  });

  test("the count is 0 when the API cannot answer", async () => {
    answer = () => Response.json({ error: { code: "phone_not_verified" } }, { status: 403 });
    expect(await unreadNotifications()).toBe(0);
  });
});

describe("push for the customer's browsers", () => {
  test("a browser is registered with its subscription only, removed by id, and choices saved per notice", async () => {
    answer = () => Response.json({ object: "device", id, label: "Chrome on Android", current: true }, { status: 201 });
    const added = await addPushDevice({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) }, extra: "x" } as never);
    expect(added).toMatchObject({ ok: true, device: { id, current: true } });
    expect(calls.at(-1)).toMatchObject({ url: "https://api.test/v1/store/account/devices", method: "POST", body: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } } });
    expect(await addPushDevice({} as never)).toMatchObject({ ok: false });

    answer = () => new Response(null, { status: 204 });
    expect(await removePushDevice(id)).toBe(true);
    expect(calls.at(-1)).toMatchObject({ url: `https://api.test/v1/store/account/devices/${id}`, method: "DELETE" });

    answer = () => Response.json({ type: "customer.classifieds.listing_expired", push: false });
    expect(await setPushPreference("customer.classifieds.listing_expired", false)).toEqual({ ok: true });
    expect(calls.at(-1)).toMatchObject({ method: "PUT", body: { push: false } });
    expect(await setPushPreference("admin.anything", true)).toMatchObject({ ok: false });
  });

  test("the VAPID key is decoded from base64url", () => {
    expect(Array.from(keyBytes("AQID_-8"))).toEqual([1, 2, 3, 255, 239]);
  });

  test("the worker shows a push titled as sent and opens only udozo.com's own pages", async () => {
    const listeners: Record<string, (event: never) => void> = {};
    const shown: { title: string; options: { data: { url: string }; icon: string } }[] = [];
    const opened: string[] = [];
    const self = {
      location: { origin: "https://udozo.com" },
      addEventListener: (type: string, listener: (event: never) => void) => (listeners[type] = listener),
      registration: { showNotification: async (title: string, options: never) => void shown.push({ title, options }) },
      clients: { matchAll: async () => [], openWindow: async (url: string) => void opened.push(url) },
    };
    new Function("self", "URL", udozoPushWorker)(self, URL);
    const push = (data: unknown) => {
      let waiting: Promise<unknown> = Promise.resolve();
      listeners.push!({ data: { json: () => data }, waitUntil: (work: Promise<unknown>) => (waiting = work) } as never);
      return waiting;
    };
    await push({ title: "Your ad expired", body: "Renew it.", link: "/account/listings" });
    await push({ title: "Phish", link: "https://evil.example/" });
    expect(shown.map(item => [item.title, item.options.data.url, item.options.icon])).toEqual([
      ["Your ad expired", "https://udozo.com/account/listings", "/icon-192.png"],
      ["Phish", "https://udozo.com/account/notifications", "/icon-192.png"],
    ]);
    let clicked: Promise<unknown> = Promise.resolve();
    listeners.notificationclick!({ notification: { close: () => undefined, data: shown[0]!.options.data }, waitUntil: (work: Promise<unknown>) => (clicked = work) } as never);
    await clicked;
    expect(opened).toEqual(["https://udozo.com/account/listings"]);
  });
});
