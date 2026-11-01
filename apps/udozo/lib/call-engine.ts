import type { ShopCall, ShopCallSignal, ShopIceServer } from "@bitocard/api-client/classifieds";

/** What the call panel shows. */
export type CallPhase = "idle" | "starting" | "microphone" | "ringing" | "incoming" | "connecting" | "connected" | "ended";
/**
 * Why the microphone could not be used: the browser or the person refused it (`blocked`), there is none (`missing`),
 * another app holds it (`in_use`), or this browser cannot make calls (`unsupported`).
 */
export type MicProblem = "blocked" | "missing" | "in_use" | "unsupported";
export type CallView = { phase: CallPhase; call: ShopCall | null; message: string | null; muted: boolean; connectedAt: number | null; microphone?: MicProblem | null };

export type ApiAnswer<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** What the engine needs from the browser, given by the provider (and by tests, as fakes). */
export type CallDeps = {
  api: <T>(method: "GET" | "POST", path: string, body?: unknown) => Promise<ApiAnswer<T>>;
  microphone: () => Promise<MediaStream>;
  peer: (config: RTCConfiguration) => RTCPeerConnection;
  onView: (view: CallView) => void;
  onRemote: (stream: MediaStream | null) => void;
  later: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  now: () => number;
};

type CallWithIce = ShopCall & { ice_servers: ShopIceServer[] };
/** Who to call: the seller of a listing, or the other side of a chat. */
export type CallTarget = { listing_id: string } | { conversation_id: string };
type Polled = ShopCall & { signals: ShopCallSignal[] };

const idle: CallView = { phase: "idle", call: null, message: null, muted: false, connectedAt: null, microphone: null };
const over = new Set(["ended", "missed", "declined", "cancelled", "lost"]);
/** Polling while connecting, then once connected (only to keep the call alive and hear it end). */
const fastMs = 1000;
const slowMs = 3000;
/** How long the ended panel stays before it closes. */
const endedMs = 4000;

/** What went wrong with the microphone, from the browser's error. */
export function micProblem(error: unknown): MicProblem {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "missing";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "in_use";
  if (name === "TypeError") return "unsupported";
  return "blocked";
}

/** Why a call ended, in the words of the side reading it. */
export function endedText(call: Pick<ShopCall, "status" | "role">) {
  const caller = call.role === "caller";
  switch (call.status) {
    case "missed":
      return caller ? "No answer. Ask them to call you back, or chat with them." : "You missed the call.";
    case "declined":
      return caller ? "They could not take your call just now." : "Call declined.";
    case "cancelled":
      return caller ? "Call cancelled." : "The caller hung up.";
    case "lost":
      return "The call dropped.";
    default:
      return "Call ended.";
  }
}

/**
 * One call at a time in the browser: rings the seller (or rings here), takes the microphone only when calling or
 * answering, and connects the two browsers through the relay only (`iceTransportPolicy: relay`: neither side learns the
 * other's address). The two sides swap their connection details through Udozo, polled; the caller makes the offer once
 * the seller answers.
 */
export class CallEngine {
  private view: CallView = idle;
  private pc: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private ice: ShopIceServer[] = [];
  private after: string | undefined;
  private timer: unknown = null;
  private closer: unknown = null;
  private remoteSet = false;
  private pending: RTCIceCandidateInit[] = [];
  private polling = false;
  /** Who this side was calling, kept while it waits for the microphone so the call starts once it is allowed. */
  private target: CallTarget | null = null;

  constructor(private readonly deps: CallDeps) {}

  get current() {
    return this.view;
  }

  get busy() {
    return this.view.phase !== "idle" && this.view.phase !== "ended";
  }

  /** Calls the seller of a listing, or the other side of a chat. */
  async call(target: CallTarget) {
    if (this.busy) return;
    this.reset();
    this.target = target;
    this.set({ ...idle, phase: "starting" });
    if (!(await this.takeMicrophone())) return;
    this.target = null;
    const started = await this.deps.api<CallWithIce>("POST", "start", target);
    if (!started.ok) return this.finish(started.message);
    this.ice = started.data.ice_servers;
    this.set({ ...this.view, phase: "ringing", call: started.data });
    this.schedule(0);
  }

  /** A call ringing for this person (heard by the page's presence check). */
  ring(call: ShopCall) {
    if (this.busy || call.status !== "ringing" || call.role !== "callee") return;
    this.reset();
    this.set({ ...idle, phase: "incoming", call });
    this.schedule(2000);
  }

  async answer() {
    const call = this.view.call;
    if ((this.view.phase !== "incoming" && this.view.phase !== "microphone") || call?.role !== "callee") return;
    this.set({ ...this.view, phase: "connecting", microphone: null });
    // Without the microphone the call keeps ringing while the person allows it (or declines).
    if (!(await this.takeMicrophone())) return;
    const answered = await this.deps.api<CallWithIce>("POST", `${call.id}/answer`);
    if (!answered.ok) return this.finish(answered.message);
    this.ice = answered.data.ice_servers;
    this.set({ ...this.view, call: answered.data });
    this.connect();
    this.schedule(0);
  }

  /** Tries the microphone again once the person has allowed it: starts the call they were making, or answers. */
  async retryMicrophone() {
    if (this.view.phase !== "microphone") return;
    if (this.view.call) return this.answer();
    const target = this.target;
    this.set(idle);
    if (target) await this.call(target);
  }

  /** Declines a ringing call, cancels one still ringing out, or ends one in progress. */
  async hangUp() {
    const call = this.view.call;
    if (!this.busy) return;
    // Still waiting for the microphone before calling: nothing was started.
    if (this.view.phase === "microphone" && !call) {
      this.target = null;
      return this.set(idle);
    }
    const declining = this.view.phase === "incoming" || (this.view.phase === "microphone" && call?.role === "callee");
    if (call) await this.deps.api<ShopCall>("POST", `${call.id}/end`);
    this.finish(declining ? "Call declined." : "Call ended.");
  }

  toggleMute() {
    if (!this.stream) return;
    const muted = !this.view.muted;
    for (const track of this.stream.getAudioTracks()) track.enabled = !muted;
    this.set({ ...this.view, muted });
  }

  /** Closes the ended panel at once. */
  dismiss() {
    if (this.view.phase === "ended") this.set(idle);
  }

  private set(view: CallView) {
    this.view = view;
    this.deps.onView(view);
  }

  private async takeMicrophone() {
    try {
      this.stream = await this.deps.microphone();
      return true;
    } catch (error) {
      // The call waits here: the panel says how to allow the microphone, then tries again.
      this.set({ ...this.view, phase: "microphone", microphone: micProblem(error) });
      return false;
    }
  }

  private schedule(ms: number) {
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
      const read = await this.deps.api<Polled>("GET", `${call.id}${this.after ? `?after=${this.after}` : ""}`);
      if (!this.busy || this.view.call?.id !== call.id) return;
      if (read.ok) {
        const { signals, ...fresh } = read.data;
        if (over.has(fresh.status)) return this.finish(endedText(fresh));
        this.set({ ...this.view, call: fresh });
        if (fresh.role === "caller" && fresh.status === "answered" && !this.pc) {
          this.set({ ...this.view, phase: "connecting" });
          this.connect();
          await this.offer();
        }
        for (const signal of signals) {
          this.after = signal.id;
          await this.receive(signal);
        }
      } else if (read.status === 404 || read.status === 401) {
        return this.finish("The call has ended.");
      }
    } finally {
      this.polling = false;
    }
    if (this.busy) this.schedule(this.view.phase === "connected" ? slowMs : this.view.phase === "incoming" || this.view.phase === "microphone" ? 2000 : fastMs);
  }

  /** The connection, through the relay only, with this side's microphone. */
  private connect() {
    const call = this.view.call!;
    const pc = this.deps.peer({ iceServers: this.ice as RTCIceServer[], iceTransportPolicy: "relay" });
    this.pc = pc;
    for (const track of this.stream?.getTracks() ?? []) pc.addTrack(track, this.stream!);
    pc.onicecandidate = event => {
      if (event.candidate) void this.deps.api("POST", `${call.id}/signals`, { kind: "candidate", payload: event.candidate.toJSON() });
    };
    pc.ontrack = event => this.deps.onRemote(event.streams[0] ?? null);
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === "connected" && this.view.phase !== "connected") this.set({ ...this.view, phase: "connected", connectedAt: this.deps.now() });
      if (pc.connectionState === "failed") void this.fail();
    };
  }

  private async fail() {
    const call = this.view.call;
    if (call) await this.deps.api("POST", `${call.id}/end`);
    this.finish("The call could not connect. Check your connection and try again.");
  }

  private async offer() {
    const pc = this.pc!;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.deps.api("POST", `${this.view.call!.id}/signals`, { kind: "offer", payload: { type: "offer", sdp: offer.sdp } });
  }

  private async receive(signal: ShopCallSignal) {
    const pc = this.pc;
    if (!pc) return;
    if (signal.kind === "offer" && this.view.call?.role === "callee") {
      await pc.setRemoteDescription({ type: "offer", sdp: String(signal.payload.sdp) });
      await this.flush();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.deps.api("POST", `${this.view.call.id}/signals`, { kind: "answer", payload: { type: "answer", sdp: answer.sdp } });
    } else if (signal.kind === "answer" && this.view.call?.role === "caller") {
      await pc.setRemoteDescription({ type: "answer", sdp: String(signal.payload.sdp) });
      await this.flush();
    } else if (signal.kind === "candidate") {
      const candidate = signal.payload as RTCIceCandidateInit;
      if (this.remoteSet) await pc.addIceCandidate(candidate).catch(() => undefined);
      else this.pending.push(candidate);
    }
  }

  /** Candidates that came before the other side's description. */
  private async flush() {
    this.remoteSet = true;
    for (const candidate of this.pending.splice(0)) await this.pc?.addIceCandidate(candidate).catch(() => undefined);
  }

  private finish(message: string | null) {
    if (this.timer !== null) this.deps.cancel(this.timer);
    this.timer = null;
    this.pc?.close();
    this.pc = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.deps.onRemote(null);
    this.set({ ...this.view, phase: "ended", message });
    if (this.closer !== null) this.deps.cancel(this.closer);
    this.closer = this.deps.later(() => {
      this.closer = null;
      if (this.view.phase === "ended") this.set(idle);
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
