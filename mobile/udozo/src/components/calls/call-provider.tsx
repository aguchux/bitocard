import type { ShopPresence } from '@shared/classifieds';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { CallPanel } from '@/components/calls/call-panel';
import { useRinger } from '@/components/calls/ringer';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { CallEngine, type ApiAnswer, type CallTarget } from '@/lib/call-engine';
import { audioSessionActivated, callsSupported, nativeCallSystem, openMicrophone, openPeer, registerVoipPush, setupCallSystem, systemCalls, systemKnows } from '@/lib/call-system';
import { onAnswerRequested } from '@/lib/call-task';
import { idleView, isBusy, presenceMs, type CallView } from '@/lib/calls';

type Calls = { available: boolean; busy: boolean; start: (target: CallTarget) => void };

const CallsContext = createContext<Calls | null>(null);

/** Calls, where this app has them (signed in, the account finished, a build with calls): null otherwise. */
export const useCalls = () => useContext(CallsContext);

/** Udozo's API as the engine wants it: never throwing, the refusal's words kept. */
async function callApi<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiAnswer<T>> {
  try {
    const data = await api<T>(`/v1/classifieds/${path}`, method === 'POST' ? { body: body ?? {} } : {});
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, status: error.status, message: error.message };
    return { ok: false, status: 0, message: 'We could not reach Udozo. Check your connection and try again.' };
  }
}

/**
 * Calls between buyers and sellers, once for the whole app (in the root layout, so a call carries on from screen to
 * screen): while the app is open it tells Udozo the customer is here every 5 seconds and hears of a call ringing for
 * them, it shows the call panel, and it follows the phone's own call screen (an answer or hang-up there, a VoIP push
 * that woke the app, Answer on Android's call notice). Calls go through Cloudflare's relay only, so neither side
 * learns the other's number or address, and nothing is recorded.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const { customer, pending } = useAccount();
  const ready = Boolean(customer && !pending) && callsSupported();
  return ready ? <CallsOn>{children}</CallsOn> : <>{children}</>;
}

function CallsOn({ children }: { children: ReactNode }) {
  const [view, setView] = useState<CallView>(idleView);
  const [available, setAvailable] = useState(false);
  const engine = useRef<CallEngine | null>(null);

  useEffect(() => {
    const created = new CallEngine({
      api: callApi,
      microphone: openMicrophone,
      peer: openPeer,
      system: nativeCallSystem,
      onView: setView,
      later: (fn, ms) => setTimeout(fn, ms),
      cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
    });
    engine.current = created;
    setupCallSystem().catch(() => undefined);
    registerVoipPush();

    // The phone's own call screen: answered or ended there, muted there, and the iPhone handing the call its audio.
    const keep = systemCalls();
    const lower = (id: string) => id.toLowerCase();
    const answer = (callId: string) => void created.answerById(lower(callId));
    const end = (callId: string) => void created.endById(lower(callId));
    const listeners = keep
      ? [
          keep.addEventListener('answerCall', ({ callUUID }) => answer(callUUID)),
          keep.addEventListener('endCall', ({ callUUID }) => end(callUUID)),
          keep.addEventListener('didPerformSetMutedCallAction', ({ muted, callUUID }) => {
            if (created.callId === lower(callUUID) && created.current.muted !== muted) created.setMuted(muted);
          }),
          keep.addEventListener('didActivateAudioSession', () => audioSessionActivated(true)),
          keep.addEventListener('didDeactivateAudioSession', () => audioSessionActivated(false)),
        ]
      : [];
    // What happened on the call screen before this ran (an iPhone woken by a VoIP push and answered on the lock screen).
    keep
      ?.getInitialEvents()
      .then(events => {
        for (const event of events) {
          if (event.name === 'RNCallKeepPerformAnswerCallAction') answer((event.data as { callUUID: string }).callUUID);
          if (event.name === 'RNCallKeepPerformEndCallAction') end((event.data as { callUUID: string }).callUUID);
          if (event.name === 'RNCallKeepDidActivateAudioSession') audioSessionActivated(true);
        }
        keep.clearInitialEvents();
      })
      .catch(() => undefined);
    const stopAnswers = onAnswerRequested(answer);

    // Presence while the app is in front: every 5 seconds, and at once on coming back.
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const beat = async () => {
      clearTimeout(timer);
      if (stopped || AppState.currentState === 'background') return;
      const result = await callApi<ShopPresence>('POST', 'presence');
      if (stopped) return;
      if (result.ok) {
        setAvailable(result.data.calls);
        if (result.data.incoming) created.ring(result.data.incoming);
      }
      // Signed out meanwhile: nothing more to say.
      if (!result.ok && (result.status === 401 || result.status === 403 || result.status === 404)) return;
      timer = setTimeout(() => void beat(), presenceMs);
    };
    void beat();
    const subscription = AppState.addEventListener('change', status => {
      if (status === 'active') void beat();
      else clearTimeout(timer);
    });

    return () => {
      stopped = true;
      clearTimeout(timer);
      subscription.remove();
      stopAnswers();
      for (const listener of listeners) listener.remove();
      created.dispose();
      engine.current = null;
    };
  }, []);

  // The iPhone's call screen rings for a call a push reported; the app rings for the rest, and rings back the caller.
  const incomingRings = view.phase === 'incoming' && !(view.call && systemKnows(view.call.id) && Platform.OS === 'ios');
  useRinger(incomingRings ? 'incoming' : view.phase === 'ringing' ? 'ringback' : null);

  const start = useCallback((target: CallTarget) => void engine.current?.call(target), []);
  const busy = isBusy(view.phase);
  const value = useMemo(() => ({ available, busy, start }), [available, busy, start]);

  return (
    <CallsContext.Provider value={value}>
      {children}
      <CallPanel
        view={view}
        onAnswer={() => void engine.current?.answer()}
        onHangUp={() => void engine.current?.hangUp()}
        onMute={() => engine.current?.toggleMute()}
        onSpeaker={() => engine.current?.toggleSpeaker()}
        onClose={() => engine.current?.dismiss()}
        onRetry={() => void engine.current?.retryMicrophone()}
      />
    </CallsContext.Provider>
  );
}
