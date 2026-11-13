/**
 * Calls between buyers and sellers, as udozo.com's (apps/udozo/lib/call-engine.ts): the rules the call engine, the call
 * panel and the Call buttons follow, and what the phone pushes carry. Kept free of React Native so it runs under
 * `node --test`.
 */
import type { ShopCall, ShopConversation, ShopViewer } from '../shared/classifieds';

/** What the call panel shows. */
export type CallPhase = 'idle' | 'starting' | 'microphone' | 'ringing' | 'incoming' | 'connecting' | 'connected' | 'ended';
/**
 * Why the microphone could not be used: the person refused it (`blocked`, then only the phone's settings allow it),
 * there is none (`missing`), or another app holds it (`in_use`).
 */
export type MicProblem = 'blocked' | 'missing' | 'in_use';
export type CallView = {
  phase: CallPhase;
  call: ShopCall | null;
  message: string | null;
  muted: boolean;
  speaker: boolean;
  connectedAt: number | null;
  microphone: MicProblem | null;
};

export const idleView: CallView = { phase: 'idle', call: null, message: null, muted: false, speaker: false, connectedAt: null, microphone: null };

/** A call rings this long before the API calls it missed (the API's `ringMs`). */
export const ringMs = 45_000;
/** An answered call a side has not looked at for this long is lost (the API's `quietMs`). */
export const quietMs = 30_000;
/** How long past `ring_until` the phone waits for the API to say the call was missed before ending it itself. */
export const ringGraceMs = 5_000;
/** Polling while connecting (and ringing out), once connected, and while a call rings here. */
export const fastMs = 1_000;
export const slowMs = 3_000;
export const incomingMs = 2_000;
/** How long the ended panel stays before it closes. */
export const endedMs = 4_000;
/** How often the open app says the customer is here and hears of a call ringing for them. */
export const presenceMs = 5_000;

/** The statuses after which a call is over. */
export const overStatuses = new Set<string>(['ended', 'missed', 'declined', 'cancelled', 'lost']);

/** Whether a phase is a call going on (anything but nothing, or the ended panel). */
export const isBusy = (phase: CallPhase) => phase !== 'idle' && phase !== 'ended';

/** How long to wait before reading the call again, by what the panel shows. */
export function pollDelay(phase: CallPhase) {
  if (phase === 'connected') return slowMs;
  if (phase === 'incoming' || phase === 'microphone') return incomingMs;
  return fastMs;
}

/** A call still ringing past its `ring_until` (and the grace): the API missed it, or never will say so. */
export function ringExpired(call: Pick<ShopCall, 'status' | 'ring_until' | 'created_at'>, now: number) {
  if (call.status !== 'ringing') return false;
  const until = call.ring_until ? Date.parse(call.ring_until) : Date.parse(call.created_at) + ringMs;
  return Number.isFinite(until) && now > until + ringGraceMs;
}

/** An answered call this side has not heard from the API about for `quietMs`: the API ends it as lost. */
export const lostFromQuiet = (lastHeard: number, now: number) => now - lastHeard > quietMs;

/** What went wrong with the microphone, from the error the permission step or `getUserMedia` threw. */
export function micProblem(error: unknown): MicProblem {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'missing';
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return 'in_use';
  return 'blocked';
}

/** What the microphone step says, and whether its button opens the phone's settings or simply tries again. */
export function micHelp(problem: MicProblem) {
  switch (problem) {
    case 'missing':
      return { text: 'We could not find a microphone on this phone. Plug in a headset, then try again.', settings: false, action: 'Try again' };
    case 'in_use':
      return { text: 'Another app is using your microphone. End the call there, then try again.', settings: false, action: 'Try again' };
    default:
      return { text: 'Udozo needs your microphone for the call. Allow it in your phone’s settings, then press Try again.', settings: true, action: 'Open settings' };
  }
}

/** Why a call ended, in the words of the side reading it. */
export function endedText(call: Pick<ShopCall, 'status' | 'role'>) {
  const caller = call.role === 'caller';
  switch (call.status) {
    case 'missed':
      return caller ? 'No answer. Ask them to call you back, or chat with them.' : 'You missed the call.';
    case 'declined':
      return caller ? 'They could not take your call just now.' : 'Call declined.';
    case 'cancelled':
      return caller ? 'Call cancelled.' : 'The caller hung up.';
    case 'lost':
      return 'The call dropped.';
    default:
      return 'Call ended.';
  }
}

/** "4:05" since the call connected. */
export function callTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** What the panel says under the name. */
export function statusText(view: CallView, now: number) {
  switch (view.phase) {
    case 'starting':
      return 'Starting the call…';
    case 'microphone':
      return view.call?.role === 'callee' ? 'Calling you: allow your microphone to answer' : 'Allow your microphone to call';
    case 'ringing':
      return 'Ringing…';
    case 'incoming':
      return 'Calling you on Udozo';
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return callTime(now - (view.connectedAt ?? now));
    case 'ended':
      return view.message ?? 'Call ended.';
    default:
      return '';
  }
}

/** Initials for the panel's circle: never a photo or a number. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

/** A Call button: whether to show it, whether it can be pressed, and what it says (or why not). */
export type CallButton = { show: boolean; ready: boolean; hint: string };

/** Call seller on a listing, from the viewer (`calls`: offered and set up; `seller_online`: Udozo open now). */
export function listingCallButton(viewer: Pick<ShopViewer, 'calls' | 'seller_online' | 'own' | 'can_contact'> | null, busy: boolean): CallButton {
  if (!viewer || viewer.own || !viewer.can_contact || !viewer.calls) return { show: false, ready: false, hint: '' };
  if (busy) return { show: true, ready: false, hint: 'You are already in a call.' };
  if (!viewer.seller_online) return { show: true, ready: false, hint: 'The seller is not on Udozo right now. Chat with them, or ask them to call you back.' };
  return { show: true, ready: true, hint: 'A private call on Udozo: no numbers shared.' };
}

/** Call in a chat's header (`can_call`: set up, nobody blocked, never a buyer to a messages-only seller). */
export function chatCallButton(chat: Pick<ShopConversation, 'can_call' | 'with'>, busy: boolean): CallButton {
  if (!chat.can_call) return { show: false, ready: false, hint: '' };
  if (busy) return { show: true, ready: false, hint: 'You are already in a call.' };
  if (!chat.with.online) return { show: true, ready: false, hint: `${chat.with.name} is not on Udozo right now. Write to them here instead.` };
  return { show: true, ready: true, hint: `Call ${chat.with.name} privately on Udozo: no numbers shared.` };
}

/**
 * What a phone push about a call carries (`native-push.ts`: FCM data on Android, the VoIP push's payload on iPhones):
 * `kind: 'call'` with `call_id`, `caller` (their public name) and `about` (the listing's title, left out when none), or
 * `kind: 'call_ended'` with `call_id` and `reason` (`answered` or `ended`). Anything else is null.
 */
export type CallPush = { kind: 'call'; callId: string; caller: string; about: string | null } | { kind: 'call_ended'; callId: string; reason: 'answered' | 'ended' };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function callPush(data: unknown): CallPush | null {
  let value = data;
  // expo-notifications' background task hands Android's data over as `dataString` too.
  if (value && typeof value === 'object' && typeof (value as { dataString?: unknown }).dataString === 'string') {
    try {
      value = { ...(value as object), ...JSON.parse((value as { dataString: string }).dataString) };
    } catch {
      // Keep the fields as they came.
    }
  }
  if (!value || typeof value !== 'object') return null;
  const fields = value as Record<string, unknown>;
  const callId = typeof fields.call_id === 'string' && uuid.test(fields.call_id) ? fields.call_id.toLowerCase() : null;
  if (!callId) return null;
  if (fields.kind === 'call') {
    const caller = typeof fields.caller === 'string' && fields.caller.trim() ? fields.caller.trim().slice(0, 80) : 'Someone on Udozo';
    const about = typeof fields.about === 'string' && fields.about.trim() ? fields.about.trim().slice(0, 120) : null;
    return { kind: 'call', callId, caller, about };
  }
  if (fields.kind === 'call_ended') return { kind: 'call_ended', callId, reason: fields.reason === 'answered' ? 'answered' : 'ended' };
  return null;
}

/** The call's line under the caller's name on the phone's own call screen. */
export const systemCallName = (push: { caller: string; about: string | null }) => (push.about ? `${push.caller} · ${push.about}` : push.caller);
