'use client';

import { useEffect, useState } from 'react';
import { BellRing, Laptop, Send, Trash2 } from 'lucide-react';
import {
  type NotificationRealm,
  type PushSubscriptionInput,
  usePushDevicesQuery,
  usePushSettingsQuery,
  useNotificationPreferencesQuery,
  useRegisterPushDeviceMutation,
  useRemovePushDeviceMutation,
  useSetNotificationPreferenceMutation,
  useTestPushDeviceMutation,
} from '@bitocard/api-client';
import { errorMessage, formatRelative } from '../format';
import { Button, Card, CardHeader, Skeleton, Toggle } from '../ui/primitives';
import { Badge, Notice, QueryView } from '../ui/status';

/** Remembered per person in this browser: they turned push on here, so it is kept registered when they sign in again. */
const markerKey = (realm: NotificationRealm, userId: string) => `bc_push:${realm}:${userId}`;

function readMarker(realm: NotificationRealm, userId: string) {
  try {
    return window.localStorage.getItem(markerKey(realm, userId)) === '1';
  } catch {
    return false;
  }
}

function writeMarker(realm: NotificationRealm, userId: string, on: boolean) {
  try {
    if (on) window.localStorage.setItem(markerKey(realm, userId), '1');
    else window.localStorage.removeItem(markerKey(realm, userId));
  } catch {
    // Private windows may refuse storage: push still works until this browser signs in again.
  }
}

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

const keyBytes = (base64url: string) => {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
};

const sameKey = (key: ArrayBuffer | null | undefined, publicKey: string) => {
  if (!key) return false;
  const a = new Uint8Array(key);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

/** Subscribes this browser (or reuses its subscription) with BitoCard's public key, through the app's service worker. */
async function subscribe(publicKey: string): Promise<PushSubscriptionInput> {
  const registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with other keys (the keys were changed) can no longer receive pushes: replace it.
  if (subscription && !sameKey(subscription.options.applicationServerKey, publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  return { endpoint: json.endpoint ?? subscription.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } };
}

async function unsubscribe() {
  const registration = await navigator.serviceWorker.getRegistration('/');
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
}

/**
 * Keeps this browser registered for the signed-in person when they turned push on here before (for example after
 * signing in again, which ends the old registration). Never asks for permission: only the settings button does.
 */
export function usePushSync(realm: NotificationRealm, userId: string | null | undefined) {
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once mounted, so server and client markup match
    setWanted(Boolean(userId) && pushSupported() && Notification.permission === 'granted' && readMarker(realm, userId!));
  }, [realm, userId]);
  const { data: settings } = usePushSettingsQuery(realm, { skip: !wanted });
  const [register] = useRegisterPushDeviceMutation();
  useEffect(() => {
    if (!wanted || !settings?.enabled || !settings.public_key) return;
    subscribe(settings.public_key)
      .then(subscription => register({ realm, subscription }).unwrap())
      .catch(() => undefined);
  }, [wanted, settings, realm, register]);
}

/** Push to your devices: turn it on for this browser, see and remove devices, choose what is pushed. */
export function PushSettings({ realm, userId }: { realm: NotificationRealm; userId: string }) {
  const settings = usePushSettingsQuery(realm);
  const devices = usePushDevicesQuery(realm);
  const preferences = useNotificationPreferencesQuery(realm);
  const [register, registerState] = useRegisterPushDeviceMutation();
  const [remove] = useRemovePushDeviceMutation();
  const [test, testState] = useTestPushDeviceMutation();
  const [setPreference, preferenceState] = useSetNotificationPreferenceMutation();
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser capabilities are known only once mounted
    setSupported(pushSupported());
    if (pushSupported()) setPermission(Notification.permission);
  }, []);

  const current = devices.data?.data.find(device => device.current);

  const turnOn = async () => {
    setProblem(null);
    try {
      const answer = await Notification.requestPermission();
      setPermission(answer);
      if (answer !== 'granted') {
        setProblem('Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.');
        return;
      }
      const subscription = await subscribe(settings.data!.public_key!);
      const device = await register({ realm, subscription }).unwrap();
      writeMarker(realm, userId, true);
      await test({ realm, id: device.id });
    } catch (error) {
      setProblem(errorMessage(error, 'This browser could not turn on push notifications.'));
    }
  };

  const removeDevice = async (id: string, isCurrent: boolean) => {
    await remove({ realm, id });
    if (isCurrent) {
      writeMarker(realm, userId, false);
      await unsubscribe().catch(() => undefined);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Push notifications"
        description="Get your notifications on this computer or phone even when BitoCard is closed. Each browser you turn them on in is listed below; signing out of it stops them."
      />
      <div className="space-y-5 px-5 pb-5 sm:px-6">
        {settings.isLoading ? (
          <Skeleton className="h-10" />
        ) : !settings.data?.enabled ? (
          <Notice tone="grey">Push notifications are not switched on for BitoCard yet.</Notice>
        ) : !supported ? (
          <Notice tone="grey">This browser cannot receive push notifications. On iPhone and iPad, add BitoCard to your Home Screen first, then open it from there.</Notice>
        ) : current ? (
          <Notice tone="green" title="On for this browser">{`${current.label} gets your notifications.`}</Notice>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={<BellRing className="size-4" aria-hidden />} loading={registerState.isLoading} onClick={() => void turnOn()}>
              Turn on for this browser
            </Button>
            {permission === 'denied' ? <p className="text-sm text-red-700">Notifications are blocked for this site in your browser’s settings.</p> : null}
          </div>
        )}
        {problem ? <Notice tone="red">{problem}</Notice> : null}
        {testState.data && !testState.data.sent ? <Notice tone="amber">{`The test push was not accepted (${testState.data.error ?? 'unknown error'}).`}</Notice> : null}

        <section aria-label="Your devices" className="space-y-2">
          <h3 className="text-sm font-bold text-ink">Your devices</h3>
          <QueryView query={devices} loading={<Skeleton className="h-16" />}>
            {({ data: list }) =>
              list.length ? (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {list.map(device => (
                    <li key={device.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                      <Laptop className="size-5 shrink-0 text-muted" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                          {device.label}
                          {device.current ? (
                            <Badge tone="blue" dot={false}>
                              This browser
                            </Badge>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted">{device.last_pushed_at ? `Last push ${formatRelative(device.last_pushed_at)}` : `Added ${formatRelative(device.created_at)}`}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" icon={<Send className="size-4" aria-hidden />} onClick={() => void test({ realm, id: device.id })}>
                          Test
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`Remove ${device.label}`} icon={<Trash2 className="size-4" aria-hidden />} onClick={() => void removeDevice(device.id, device.current)}>
                          Remove
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No devices yet.</p>
              )
            }
          </QueryView>
        </section>

        <section aria-label="What is pushed" className="space-y-2">
          <h3 className="text-sm font-bold text-ink">What is pushed</h3>
          <p className="text-xs text-muted">Everything still appears in your notifications here. Urgent and security notifications are always pushed.</p>
          {preferenceState.error ? <Notice tone="red">{errorMessage(preferenceState.error)}</Notice> : null}
          <QueryView query={preferences} loading={<Skeleton className="h-24" />}>
            {({ data: list }) => (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {list.map(item => (
                  <li key={item.type} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="text-sm text-ink">
                      {item.label}
                      {item.locked ? <span className="ml-2 text-xs text-muted">Always</span> : null}
                    </span>
                    <Toggle checked={item.push} disabled={item.locked} label={`Push “${item.label}”`} onChange={push => void setPreference({ realm, type: item.type, push })} />
                  </li>
                ))}
              </ul>
            )}
          </QueryView>
        </section>
      </div>
    </Card>
  );
}
