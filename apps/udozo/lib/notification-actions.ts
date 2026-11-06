"use server";

import { revalidatePath } from "next/cache";
import { customerApi } from "./customer";
import type { PushDevice, PushPreference } from "./notifications";

const uuid = /^[0-9a-f-]{36}$/i;

/** How many notices the signed-in customer has not read (0 when signed out or the API cannot answer). */
export async function unreadNotifications(): Promise<number> {
  const result = await customerApi<{ count: number }>("GET", "/v1/store/account/notifications/unread-count");
  return result.ok ? result.data.count : 0;
}

/** Marks one notice read (opening it). */
export async function readNotification(id: string): Promise<boolean> {
  if (!uuid.test(id)) return false;
  const result = await customerApi("POST", `/v1/store/account/notifications/${id}/read`);
  return result.ok;
}

export async function readAllNotifications(): Promise<{ ok: boolean }> {
  const result = await customerApi("POST", "/v1/store/account/notifications/read-all");
  revalidatePath("/account/notifications");
  return { ok: result.ok };
}

/** Whether Udozo sends pushes at all, its public key, this customer's browsers and which notices are pushed. */
export async function pushState(): Promise<{ enabled: boolean; publicKey: string | null; devices: PushDevice[]; preferences: PushPreference[] } | null> {
  const [settings, devices, preferences] = await Promise.all([
    customerApi<{ enabled: boolean; public_key: string | null }>("GET", "/v1/store/account/devices/push-settings"),
    customerApi<{ data: PushDevice[] }>("GET", "/v1/store/account/devices"),
    customerApi<{ data: PushPreference[] }>("GET", "/v1/store/account/notification-preferences"),
  ]);
  if (!settings.ok) return null;
  return { enabled: settings.data.enabled, publicKey: settings.data.public_key, devices: devices.ok ? devices.data.data : [], preferences: preferences.ok ? preferences.data.data : [] };
}

/** Registers this browser's push subscription for the signed-in customer. */
export async function addPushDevice(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<{ ok: true; device: PushDevice } | { ok: false; message: string }> {
  const keys = subscription?.keys;
  if (typeof subscription?.endpoint !== "string" || typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") return { ok: false, message: "This browser cannot get notifications." };
  const result = await customerApi<PushDevice>("POST", "/v1/store/account/devices", { endpoint: subscription.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
  return result.ok ? { ok: true, device: result.data } : { ok: false, message: result.message };
}

export async function removePushDevice(id: string): Promise<boolean> {
  if (!uuid.test(id)) return false;
  return (await customerApi("DELETE", `/v1/store/account/devices/${id}`)).ok;
}

export async function setPushPreference(type: string, push: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!/^customer\.[a-z0-9_.]+$/.test(type)) return { ok: false, message: "That notice cannot be changed." };
  const result = await customerApi("PUT", `/v1/store/account/notification-preferences/${encodeURIComponent(type)}`, { push: push === true });
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}
