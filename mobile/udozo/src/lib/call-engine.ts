/**
 * One call at a time on this phone, as udozo.com's `CallEngine` (apps/udozo/lib/call-engine.ts): it rings the other
 * side (or rings here), takes the microphone only when calling or answering, and connects the two through Cloudflare's
 * relay only (`iceTransportPolicy: 'relay'`: neither side learns the other's number or address). The two sides swap
 * their connection details through Udozo, polled (every second while connecting, every 3 once connected); the caller
 * makes the offer once the other side answers. What it needs from the phone (react-native-webrtc, the API, the phone's
 * own call screen) is given to it, so it is free of React Native and runs under `node --test` with fakes.
 */
import type { ShopCall, ShopCallSignal, ShopIceServer } from '../shared/classifieds';
import { endedText, idleView, isBusy, lostFromQuiet, micProblem, overStatuses, pollDelay, ringExpired, endedMs, incomingMs, type CallView } from './calls.ts';

export type ApiAnswer<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** The parts of a media track, stream and peer connection the engine uses (react-native-webrtc's, or fakes). */
export type TrackLike = { enabled: boolean; stop: () => void };
export type StreamLike = { getTracks: () => TrackLike[]; getAudioTracks: () => TrackLike[] };
export type DescriptionLike = { type: string; sdp?: string };
export type CandidateLike = { candidate?: string | null; sdpMid?: string | null; sdpMLineIndex?: number | null; toJSON?: () => Record<string, unknown> };
export type PeerLike = {
  connectionState: string;
  addTrack: (track: TrackLike, stream: StreamLike) => unknown;
  createOffer: () => Promise<DescriptionLike>;
  createAnswer: () => Promise<DescriptionLike>;
  setLocalDescription: (description: DescriptionLike) => Promise<void>;
  setRemoteDescription: (description: DescriptionLike) => Promise<void>;
  addIceCandidate: (candidate: Record<string, unknown>) => Promise<void>;
  close: () => void;
  addEventListener: (type: 'icecandidate' | 'connectionstatechange', listener: (event: { candidate?: CandidateLike | null }) => void) => void;
};
export type PeerConfig = { iceServers: ShopIceServer[]; iceTransportPolicy: 'relay' };

/**
 * The phone's own call screen (CallKit on iPhones, ConnectionService on Android), told of each step so the call shows
 * there, the audio is routed as a call, and the speaker can be switched. Every method may do nothing (tests, Expo Go).
 */
export type CallSystem = {
  outgoing: (call: ShopCall) => void;
  answered: (call: ShopCall) => void;
  connected: (call: ShopCall) => void;
  ended: (callId: string) => void;
  mute: (callId: string, muted: boolean) => void;
  speaker: (callId: string, on: boolean) => void;
};

export type CallDeps = {
  /** Udozo's API with the customer's session: a path under `/v1/classifieds/`. */
  api: <T>(method: 'GET' | 'POST', path: string, body?: unknown) => Promise<ApiAnswer<T>>;
  /** The microphone, after asking for it if need be; throws (`NotAllowedError`, `NotFoundError`…) when it cannot. */
  microphone: () => Promise<StreamLike>;
  peer: (config: PeerConfig) => PeerLike;
  system: CallSystem;
  onView: (view: CallView) => void;
  later: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  now: () => number;
};

type CallWithIce = ShopCall & { ice_servers: ShopIceServer[] };
type Polled = ShopCall & { signals: ShopCallSignal[] };
/** Who to call: the seller of a listing, or the other side of a chat. */
export type CallTarget = { listing_id: string } | { conversation_id: string };

const startPath = (target: CallTarget) => ('listing_id' in target ? `listings/${target.listing_id}/calls` : `conversations/${target.conversation_id}/calls`);

export class CallEngine {
  private view: CallView = idleView;
  private pc: PeerLike | null = null;
  private stream: StreamLike | null = null;
  private ice: ShopIceServer[] = [];
  private after: string | undefined;
  private timer: unknown = null;
  private closer: unknown = null;
  private remoteSet = false;
  private pending: Record<string, unknown>[] = [];
  private polling = false;
  private lastHeard = 0;
  private disposed = false;
  /** Who this side was calling, kept while it waits for the microphone so the call starts once it is allowed. */
  private target: CallTarget | null = null;

  private readonly deps: CallDeps;

  constructor(deps: CallDeps) {
    this.deps = deps;
  }

  get current() {
    return this.view;
  }

  get busy() {
    return isBusy(this.view.phase);
  }

  /** The call going on (or ringing here), if any. */
  get callId() {
    return this.busy ? (this.view.call?.id ?? null) : null;
  }

  /** Calls the seller of a listing, or the other side of a chat. */
  async call(target: CallTarget) {
    if (this.busy) return;
    this.reset();
    this.target = target;
    this.set({ ...idleView, phase: 'starting' });
    if (!(await this.takeMicrophone())) return;
    this.target = null;
    const started = await this.deps.api<CallWithIce>('POST', startPath(target), {});
    if (!started.ok) return this.finish(started.message, null);
    this.ice = started.data.ice_servers;
    this.lastHeard = this.deps.now();
    this.set({ ...this.view, phase: 'ringing', call: strip(started.data) });
    this.deps.system.outgoing(this.view.call!);
    this.schedule(0);
  }

  /** A call ringing for this person (heard by the app's presence check, or a push). */
  ring(call: ShopCall) {
    if (call.status !== 'ringing' || call.role !== 'callee') return;
    if (this.busy) return;
    this.reset();
    this.lastHeard = this.deps.now();
    this.set({ ...idleView, phase: 'incoming', call });
    this.schedule(incomingMs);
  }

  /**
   * Answers a call the phone's own call screen was told of by a push (the app may have just opened): reads it first,
   * then answers it if it still rings for this person.
   */
  async answerById(callId: string) {
    if (this.view.call?.id !== callId || !this.busy) {
      if (this.busy) return;
      const read = await this.deps.api<Polled>('GET', `calls/${callId}`);
      if (!read.ok) return this.finish('The call has ended.', null);
      const { signals: _signals, ...call } = read.data;
      if (overStatuses.has(call.status)) return this.finish(endedText(call), call.id);
      this.ring(call);
    }
    await this.answer();
  }

  async answer() {
    const call = this.view.call;
    if ((this.view.phase !== 'incoming' && this.view.phase !== 'microphone') || call?.role !== 'callee') return;
    this.set({ ...this.view, phase: 'connecting', microphone: null });
    // Without the microphone the call keeps ringing while the person allows it (or declines).
    if (!(await this.takeMicrophone())) return;
    const answered = await this.deps.api<CallWithIce>('POST', `calls/${call.id}/answer`, {});
    if (!answered.ok) return this.finish(answered.message, call.id);
    this.ice = answered.data.ice_servers;
    this.lastHeard = this.deps.now();
    this.set({ ...this.view, call: strip(answered.data) });
    this.deps.system.answered(this.view.call!);
    this.connect();
    this.schedule(0);
  }

  /** Tries the microphone again once the person has allowed it: starts the call they were making, or answers. */
  async retryMicrophone() {
    if (this.view.phase !== 'microphone') return;
    if (this.view.call) return this.answer();
    const target = this.target;
    this.set(idleView);
    if (target) await this.call(target);
  }

  /** Declines a ringing call, cancels one still ringing out, or ends one in progress. */
  async hangUp() {
    const call = this.view.call;
    if (!this.busy) return;
    // Still waiting for the microphone before calling: nothing was started.
    if (this.view.phase === 'microphone' && !call) {
      this.target = null;
      return this.set(idleView);
    }
    const declining = this.view.phase === 'incoming' || (this.view.phase === 'microphone' && call?.role === 'callee');
    if (call) await this.deps.api<ShopCall>('POST', `calls/${call.id}/end`, {});
    this.finish(declining ? 'Call declined.' : 'Call ended.', call?.id ?? null);
  }

  /** Ends a call by its id: this phone's call (as `hangUp`), or one only the phone's own call screen knew of. */
  async endById(callId: string) {
    if (this.view.call?.id === callId && this.busy) return this.hangUp();
    await this.deps.api<ShopCall>('POST', `calls/${callId}/end`, {});
  }

  /** The other side has gone (a push said the call ended): read it now rather than at the next poll. */
  heardEnded(callId: string) {
    if (this.view.call?.id === callId && this.busy) this.schedule(0);
  }

  toggleMute() {
    if (!this.stream || !this.view.call) return;
    this.setMuted(!this.view.muted);
  }

  /** Mute set from the phone's own call screen. */
  setMuted(muted: boolean) {
    if (!this.stream) return;
    for (const track of this.stream.getAudioTracks()) track.enabled = !muted;
    if (this.view.call) this.deps.system.mute(this.view.call.id, muted);
    this.set({ ...this.view, muted });
  }

  toggleSpeaker() {
    const call = this.view.call;
    if (!call || !this.busy) return;
    const speaker = !this.view.speaker;
    this.deps.system.speaker(call.id, speaker);
    this.set({ ...this.view, speaker });
  }

  /**
   * Stops for good (signed out, or the app's calls unmounted): no more polls or timers, the connection and the
   * microphone let go. A call going on is left to the API, which ends it once this side stops looking.
   */
  dispose() {
    for (const handle of [this.timer, this.closer]) if (handle !== null) this.deps.cancel(handle);
    this.timer = null;
    this.closer = null;
    this.pc?.close();
    this.pc = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.disposed = true;
  }

  /** Closes the ended panel at once. */
  dismiss() {
    if (this.view.phase === 'ended') this.set(idleView);
  }

  private set(view: CallView) {
    if (this.disposed) return;
    this.view = view;
    this.deps.onView(view);
  }

  private async takeMicrophone() {
    try {
      this.stream = await this.deps.microphone();
      return true;
    } catch (error) {
      // The call waits here: the panel says how to allow the microphone, then tries again.
      this.set({ ...this.view, phase: 'microphone', microphone: micProblem(error) });
      return false;
    }
  }

  private schedule(ms: number) {
    if (this.disposed) return;
    if (this.timer !== null) this.deps.cancel(this.timer);
    this.timer = this.deps.later(() => {
      this.timer = null;
      void this.poll();
    }, ms);
  }

  private async poll() {
    const call = this.view.call;
    if (!call || !this.busy || this.polling) return;
    this.polling = true;
    try {
      const read = await this.deps.api<Polled>('GET', `calls/${call.id}${this.after ? `?after=${this.after}` : ''}`);
      if (!this.busy || this.view.call?.id !== call.id) return;
      const now = this.deps.now();
      if (read.ok) {
        this.lastHeard = now;
        const { signals, ...fresh } = read.data;
        if (overStatuses.has(fresh.status)) return this.finish(endedText(fresh), fresh.id);
        if (ringExpired(fresh, now)) return this.finish(endedText({ status: 'missed', role: fresh.role }), fresh.id);
        this.set({ ...this.view, call: fresh });
        if (fresh.role === 'caller' && fresh.status === 'answered' && !this.pc) {
          this.set({ ...this.view, phase: 'connecting' });
          this.connect();
          await this.offer();
        }
        for (const signal of signals) {
          this.after = signal.id;
          await this.receive(signal);
        }
      } else if (read.status === 404 || read.status === 401) {
        return this.finish('The call has ended.', call.id);
      } else if (ringExpired(call, now) || (call.status === 'answered' && lostFromQuiet(this.lastHeard, now))) {
        // Udozo cannot be reached: past the ring, or quiet for as long as the API allows, the call is over.
        return this.finish(endedText({ status: call.status === 'answered' ? 'lost' : 'missed', role: call.role }), call.id);
      }
    } finally {
      this.polling = false;
    }
    if (this.busy) this.schedule(pollDelay(this.view.phase));
  }

  /** The connection, through the relay only, with this side's microphone. */
  private connect() {
    const call = this.view.call!;
    const pc = this.deps.peer({ iceServers: this.ice, iceTransportPolicy: 'relay' });
    this.pc = pc;
    for (const track of this.stream?.getTracks() ?? []) pc.addTrack(track, this.stream!);
    pc.addEventListener('icecandidate', event => {
      const candidate = event.candidate;
      if (!candidate) return;
      const payload = candidate.toJSON?.() ?? { candidate: candidate.candidate ?? null, sdpMid: candidate.sdpMid ?? null, sdpMLineIndex: candidate.sdpMLineIndex ?? null };
      void this.deps.api('POST', `calls/${call.id}/signals`, { kind: 'candidate', payload });
    });
    pc.addEventListener('connectionstatechange', () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === 'connected' && this.view.phase !== 'connected') {
        this.set({ ...this.view, phase: 'connected', connectedAt: this.deps.now() });
        if (this.view.call) this.deps.system.connected(this.view.call);
      }
      if (pc.connectionState === 'failed') void this.fail();
    });
  }

  private async fail() {
    const call = this.view.call;
    if (call) await this.deps.api('POST', `calls/${call.id}/end`, {});
    this.finish('The call could not connect. Check your connection and try again.', call?.id ?? null);
  }

  private async offer() {
    const pc = this.pc!;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.deps.api('POST', `calls/${this.view.call!.id}/signals`, { kind: 'offer', payload: { type: 'offer', sdp: offer.sdp } });
  }

  private async receive(signal: ShopCallSignal) {
    const pc = this.pc;
    if (!pc) return;
    if (signal.kind === 'offer' && this.view.call?.role === 'callee') {
      await pc.setRemoteDescription({ type: 'offer', sdp: String(signal.payload.sdp) });
      await this.flush();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.deps.api('POST', `calls/${this.view.call.id}/signals`, { kind: 'answer', payload: { type: 'answer', sdp: answer.sdp } });
    } else if (signal.kind === 'answer' && this.view.call?.role === 'caller') {
      await pc.setRemoteDescription({ type: 'answer', sdp: String(signal.payload.sdp) });
      await this.flush();
    } else if (signal.kind === 'candidate') {
      const candidate = signal.payload;
      if (this.remoteSet) await pc.addIceCandidate(candidate).catch(() => undefined);
      else this.pending.push(candidate);
    }
  }

  /** Candidates that came before the other side's description. */
  private async flush() {
    this.remoteSet = true;
    for (const candidate of this.pending.splice(0)) await this.pc?.addIceCandidate(candidate).catch(() => undefined);
  }

  private finish(message: string | null, callId: string | null) {
    if (this.timer !== null) this.deps.cancel(this.timer);
    this.timer = null;
    this.pc?.close();
    this.pc = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (callId) this.deps.system.ended(callId);
    this.set({ ...this.view, phase: 'ended', message, microphone: null });
    if (this.closer !== null) this.deps.cancel(this.closer);
    this.closer = this.deps.later(() => {
      this.closer = null;
      if (this.view.phase === 'ended') this.set(idleView);
    }, endedMs);
  }

  private reset() {
    if (this.closer !== null) this.deps.cancel(this.closer);
    this.closer = null;
    this.after = undefined;
    this.target = null;
    this.remoteSet = false;
    this.pending = [];
    this.ice = [];
  }
}

/** The call without its relay credentials, which only the connection needs. */
function strip(call: CallWithIce): ShopCall {
  const { ice_servers: _ice, ...rest } = call;
  return rest;
}
