"use client";

import { useState, useSyncExternalStore } from "react";
import { addPushDevice, removePushDevice, setPushPreference } from "@/lib/notification-actions";
import type { PushDevice, PushPreference } from "@/lib/notifications";

type Support = "checking" | "unsupported" | "blocked" | "ready";

/** A VAPID public key (base64url) as the bytes `pushManager.subscribe` wants. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = (key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const noChanges = () => () => undefined;

/** Whether this browser can take pushes, and whether udozo.com is already blocked from sending them. */
function browserSupport(): Support {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return Notification.permission === "denied" ? "blocked" : "ready";
}

/**
 * Push for this browser: turned on only with the button (the browser asks for permission then), off again here, the
 * customer's other browsers to remove, and which notices are pushed (security ones always are).
 */
export function PushControls({ publicKey, devices: initial, preferences: initialPreferences }: { publicKey: string; devices: PushDevice[]; preferences: PushPreference[] }) {
  const detected = useSyncExternalStore(noChanges, browserSupport, () => "checking" as const);
  const [blocked, setBlocked] = useState(false);
  const support: Support = blocked ? "blocked" : detected;
  const [devices, setDevices] = useState(initial);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = devices.find(device => device.current) ?? null;

  const turnOn = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setBlocked(true);
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription = (await registration.pushManager.getSubscription()) ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const added = await addPushDevice({ endpoint: json.endpoint, keys: json.keys });
      if (!added.ok) {
        setMessage(added.message);
        return;
      }
      setDevices(list => [{ ...added.device, current: true }, ...list.filter(device => device.id !== added.device.id && !device.current)]);
      setMessage("Notifications are on for this browser.");
    } catch {
      setMessage("This browser could not turn notifications on. Try again, or use another browser.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (device: PushDevice) => {
    setBusy(true);
    if (device.current) {
      const registration = await navigator.serviceWorker?.getRegistration("/").catch(() => undefined);
      await (await registration?.pushManager.getSubscription())?.unsubscribe().catch(() => undefined);
    }
    if (await removePushDevice(device.id)) setDevices(list => list.filter(item => item.id !== device.id));
    setBusy(false);
  };

  const choose = async (preference: PushPreference, push: boolean) => {
    setPreferences(list => list.map(item => (item.type === preference.type ? { ...item, push } : item)));
    const saved = await setPushPreference(preference.type, push);
    if (!saved.ok) {
      setPreferences(list => list.map(item => (item.type === preference.type ? { ...item, push: !push } : item)));
      setMessage(saved.message);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        {support === "unsupported" ? (
          <p className="text-sm text-slate-600">This browser cannot show notifications. On an iPhone, add Udozo to your Home Screen first, then open it from there.</p>
        ) : support === "blocked" ? (
          <p className="text-sm text-slate-600">Notifications are blocked for udozo.com. Allow them in your browser’s site settings, then come back here.</p>
        ) : current ? (
          <p className="text-sm text-slate-600">This browser gets your notifications.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy || support !== "ready"} onClick={turnOn} className="min-h-11 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-60">
              Turn on notifications here
            </button>
            <span className="text-sm text-slate-600">Hear about messages, orders and your listings when Udozo is closed.</span>
          </div>
        )}
        {message ? (
          <p role="status" className="text-sm text-navy-800">
            {message}
          </p>
        ) : null}
      </div>
      {devices.length ? (
        <ul className="grid gap-2">
          {devices.map(device => (
            <li key={device.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <span className="min-w-0 truncate font-semibold text-navy-900">
                {device.label}
                {device.current ? <span className="font-normal text-slate-500"> (this browser)</span> : null}
              </span>
              <button type="button" disabled={busy} onClick={() => remove(device)} className="min-h-11 shrink-0 rounded-lg px-3 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">
                {device.current ? "Turn off" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {preferences.length ? (
        <fieldset className="grid gap-1">
          <legend className="mb-2 text-sm font-semibold text-navy-900">Send to my browsers</legend>
          {preferences.map(preference => (
            <label key={preference.type} className="flex min-h-11 items-center justify-between gap-3 border-b border-slate-100 text-sm">
              <span className="min-w-0 text-slate-700">
                {preference.label}
                {preference.locked ? <span className="text-slate-500"> (always, for your safety)</span> : null}
              </span>
              <input type="checkbox" className="size-5 shrink-0 accent-[var(--color-brand-500)]" checked={preference.push} disabled={preference.locked} onChange={event => choose(preference, event.target.checked)} />
            </label>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}
