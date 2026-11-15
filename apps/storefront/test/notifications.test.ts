// A customer's notifications on a store: the account header's bell, Account > Notifications (opening a notice marks it
// read and goes only to a page of this store), and push for their browsers through the store's service worker.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";
import { addPushDevice, readAllNotifications, readNotification, removePushDevice, setPushPreference, unreadNotifications } from "@/lib/notification-actions";
import { badgeText, noticeHref, noticeWhen } from "@/lib/notifications";
import { storePushWorker } from "@/lib/push-worker";
import { keyBytes } from "@/components/app/notifications/push-controls";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

type Call = { url: string; method: string; body: unknown; agent: string | null };
let calls: Call[];
let answer: () => Response;

beforeEach(() => {
  vi.stubEnv("API_URL", "https://api.test");
  calls = [];
  answer = () => Response.json({ object: "unread_count", count: 4 });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null, agent: new Headers(init.headers).get("bitocard-client-agent") });
    return answer();
  });
  setRequest({ host: "bitocard.com", "user-agent": "Mozilla/5.0 (Android 14) Chrome/130.0" }, { bc_customer: "bcc_session" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const id = "4b0f1c7e-2a9d-4f3e-8c1b-5d6e7f8a9b0c";

describe("where a notice opens", () => {
  test("a page of this store only; anything else opens the inbox", () => {
    expect(noticeHref("/account/orders/123")).toBe("/account/orders/123");
    expect(noticeHref("https://evil.example/x")).toBe("/account/profile/notifications");
    expect(noticeHref("//evil.example")).toBe("/account/profile/notifications");
    expect(noticeHref("/\\evil.example")).toBe("/account/profile/notifications");
    expect(noticeHref(null)).toBe("/account/profile/notifications");
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
    // The visitor's browser names the device, never this server's.
    expect(calls.at(-1)?.agent).toBe("Mozilla/5.0 (Android 14) Chrome/130.0");
    expect(await addPushDevice({} as never)).toMatchObject({ ok: false });

    answer = () => new Response(null, { status: 204 });
    expect(await removePushDevice(id)).toBe(true);
    expect(calls.at(-1)).toMatchObject({ url: `https://api.test/v1/store/account/devices/${id}`, method: "DELETE" });

    answer = () => Response.json({ type: "customer.order.refunded", push: false });
    expect(await setPushPreference("customer.order.refunded", false)).toEqual({ ok: true });
    expect(calls.at(-1)).toMatchObject({ method: "PUT", body: { push: false } });
    expect(await setPushPreference("admin.anything", true)).toMatchObject({ ok: false });
  });

  test("the VAPID key is decoded from base64url", () => {
    expect(Array.from(keyBytes("AQID_-8"))).toEqual([1, 2, 3, 255, 239]);
  });

  test("the worker shows a push titled as sent, with the store's icon only when given, and opens only this store's pages", async () => {
    const listeners: Record<string, (event: never) => void> = {};
    const shown: { title: string; options: { data: { url: string }; icon: string } }[] = [];
    const opened: string[] = [];
    const self = {
      location: { origin: "https://ada.bitocard.com" },
      addEventListener: (type: string, listener: (event: never) => void) => (listeners[type] = listener),
      registration: { showNotification: async (title: string, options: never) => void shown.push({ title, options }) },
      clients: { matchAll: async () => [], openWindow: async (url: string) => void opened.push(url) },
    };
    new Function("self", "URL", storePushWorker)(self, URL);
    const push = (data: unknown) => {
      let waiting: Promise<unknown> = Promise.resolve();
      listeners.push!({ data: { json: () => data }, waitUntil: (work: Promise<unknown>) => (waiting = work) } as never);
      return waiting;
    };
    await push({ title: "Your order is ready", body: "Open it.", link: "/account/orders/o1", icon: "https://cdn.example/ada.png" });
    await push({ title: "Phish", link: "https://evil.example/" });
    expect(shown.map(item => [item.title, item.options.data.url, item.options.icon])).toEqual([
      ["Your order is ready", "https://ada.bitocard.com/account/orders/o1", "https://cdn.example/ada.png"],
      ["Phish", "https://ada.bitocard.com/account/profile/notifications", undefined],
    ]);
    let clicked: Promise<unknown> = Promise.resolve();
    listeners.notificationclick!({ notification: { close: () => undefined, data: shown[0]!.options.data }, waitUntil: (work: Promise<unknown>) => (clicked = work) } as never);
    await clicked;
    expect(opened).toEqual(["https://ada.bitocard.com/account/orders/o1"]);
  });
});
