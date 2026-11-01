// Getting in touch on a listing without anyone's details on the page: Request contact, Request call back, and calls in
// the browser (the call route's allowlist, the call engine connecting through the relay only, and the call panel).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { ShopCall, ShopViewer } from "@bitocard/api-client/classifieds";
import { CallEngine, type CallDeps, type CallView, endedText, micProblem } from "@/lib/call-engine";
import { callRoute } from "@/lib/calls";
import { callLine, requestOutcome } from "@/lib/requests";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/ng/l/1-tv", useSearchParams: () => new URLSearchParams() }));

const { ListingActions, requestState } = await import("@/components/listing-actions");
const { CallProvider } = await import("@/components/calls/call-provider");
const { CallPanel, callTime, micHelp, statusText } = await import("@/components/calls/call-panel");

const id = "6f1c2e8a-1b2c-4d3e-8f90-1234567890ab";

describe("the microphone on udozo.com", () => {
  test("the site's own pages may use it (the shared headers block it; udozo.com's, sent last, win), never a frame from elsewhere", async () => {
    const { default: config } = await import("../next.config");
    const rules = await config.headers!();
    const policies = rules.flatMap(rule => rule.headers).filter(header => header.key === "Permissions-Policy");
    expect(policies.at(-1)?.value).toContain("microphone=(self)");
    expect(policies.at(-1)?.value).toContain("camera=()");
  });
});

describe("the call route", () => {
  const none = new URLSearchParams();
  test("passes only presence, starting, polling, answering, ending and connection details", () => {
    expect(callRoute("POST", ["presence"], {}, none)).toEqual({ method: "POST", path: "/v1/classifieds/presence" });
    expect(callRoute("POST", ["start"], { listing_id: id }, none)).toEqual({ method: "POST", path: `/v1/classifieds/listings/${id}/calls`, body: {} });
    expect(callRoute("POST", ["start"], { conversation_id: id }, none)).toEqual({ method: "POST", path: `/v1/classifieds/conversations/${id}/calls`, body: {} });
    expect(callRoute("GET", [id], {}, new URLSearchParams("after=42"))).toEqual({ method: "GET", path: `/v1/classifieds/calls/${id}?after=42` });
    expect(callRoute("POST", [id, "answer"], {}, none)?.path).toBe(`/v1/classifieds/calls/${id}/answer`);
    expect(callRoute("POST", [id, "end"], {}, none)?.path).toBe(`/v1/classifieds/calls/${id}/end`);
    expect(callRoute("POST", [id, "signals"], { kind: "offer", payload: { type: "offer", sdp: "x" }, extra: 1 }, none)).toEqual({ method: "POST", path: `/v1/classifieds/calls/${id}/signals`, body: { kind: "offer", payload: { type: "offer", sdp: "x" } } });
  });

  test("refuses anything else before asking the API", () => {
    expect(callRoute("POST", ["start"], { listing_id: "../admin" }, none)).toBeNull();
    expect(callRoute("GET", ["../admin"], {}, none)).toBeNull();
    expect(callRoute("GET", [id], {}, new URLSearchParams("after=1;drop"))).toBeNull();
    expect(callRoute("POST", [id, "delete"], {}, none)).toBeNull();
    expect(callRoute("POST", [id, "signals"], { kind: "bye" }, none)).toBeNull();
    expect(callRoute("GET", [id, "answer"], {}, none)).toBeNull();
    expect(callRoute("POST", [id, "end", "x"], {}, none)).toBeNull();
  });
});

const call = (over: Partial<ShopCall> = {}): ShopCall => ({
  object: "classified_call",
  id,
  status: "ringing",
  role: "caller",
  with: { name: "Obi N." },
  listing: { id, title: "Haier 32 inch TV", path: "/ng/l/1-haier" },
  ring_until: null,
  answered_at: null,
  ended_at: null,
  created_at: "2026-11-01T10:00:00.000Z",
  ...over,
});

/** A fake RTCPeerConnection: records what the engine did with it. */
function fakePeer(config: RTCConfiguration) {
  const peer = {
    config,
    tracks: 0,
    remote: [] as RTCSessionDescriptionInit[],
    candidates: [] as RTCIceCandidateInit[],
    closed: false,
    connectionState: "new",
    onicecandidate: null as ((event: { candidate: { toJSON: () => RTCIceCandidateInit } | null }) => void) | null,
    ontrack: null as unknown,
    onconnectionstatechange: null as (() => void) | null,
    addTrack: () => void (peer.tracks += 1),
    createOffer: async () => ({ type: "offer", sdp: "offer-sdp" }),
    createAnswer: async () => ({ type: "answer", sdp: "answer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async (description: RTCSessionDescriptionInit) => void peer.remote.push(description),
    addIceCandidate: async (candidate: RTCIceCandidateInit) => void peer.candidates.push(candidate),
    close: () => void (peer.closed = true),
  };
  return peer;
}

function harness(replies: (method: string, path: string, body: unknown) => unknown) {
  const sent: Array<{ method: string; path: string; body: unknown }> = [];
  const peers: ReturnType<typeof fakePeer>[] = [];
  const views: CallView[] = [];
  const timers: Array<() => void> = [];
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  const deps: CallDeps = {
    api: async <T,>(method: "GET" | "POST", path: string, body?: unknown) => {
      sent.push({ method, path, body });
      const data = replies(method, path, body);
      return (data instanceof Error ? { ok: false, status: 409, message: data.message } : { ok: true, data: data as T }) as never;
    },
    microphone: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream,
    peer: config => {
      const peer = fakePeer(config);
      peers.push(peer);
      return peer as unknown as RTCPeerConnection;
    },
    onView: view => void views.push(view),
    onRemote: () => undefined,
    later: fn => timers.push(fn),
    cancel: () => undefined,
    now: () => 1000,
  };
  const engine = new CallEngine(deps);
  const tick = async () => {
    const due = timers.splice(0);
    for (const fn of due) fn();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  return { engine, sent, peers, views, tick, track };
}

const relay = [{ urls: ["turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" }];

describe("the call engine", () => {
  test("the caller rings, then on an answer offers through the relay only, and takes the answer and candidates", async () => {
    let status = "ringing";
    let signals: unknown[] = [];
    const { engine, sent, peers, tick, track } = harness((method, path) => {
      if (path === "start") return { ...call(), ice_servers: relay };
      if (method === "GET") return { ...call({ status: status as ShopCall["status"] }), signals };
      return { object: "ok" };
    });
    await engine.call({ listing_id: id });
    expect(engine.current.phase).toBe("ringing");
    expect(sent[0]).toEqual({ method: "POST", path: "start", body: { listing_id: id } });
    await tick();
    expect(peers).toHaveLength(0);

    status = "answered";
    await tick();
    expect(peers).toHaveLength(1);
    expect(peers[0]!.config).toEqual({ iceServers: relay, iceTransportPolicy: "relay" });
    expect(peers[0]!.tracks).toBe(1);
    expect(sent.find(item => item.path === `${id}/signals`)?.body).toEqual({ kind: "offer", payload: { type: "offer", sdp: "offer-sdp" } });

    // A candidate before the answer waits for it.
    signals = [
      { id: "7", kind: "candidate", payload: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 } },
      { id: "8", kind: "answer", payload: { type: "answer", sdp: "answer-sdp" } },
    ];
    await tick();
    expect(peers[0]!.remote).toEqual([{ type: "answer", sdp: "answer-sdp" }]);
    expect(peers[0]!.candidates).toEqual([{ candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 }]);
    signals = [];
    await tick();
    expect(sent.filter(item => item.method === "GET").at(-1)?.path).toBe(`${id}?after=8`);

    peers[0]!.connectionState = "connected";
    peers[0]!.onconnectionstatechange?.();
    expect(engine.current).toMatchObject({ phase: "connected", connectedAt: 1000 });
    engine.toggleMute();
    expect([engine.current.muted, track.enabled]).toEqual([true, false]);

    await engine.hangUp();
    expect(sent.at(-1)).toMatchObject({ method: "POST", path: `${id}/end` });
    expect(engine.current).toMatchObject({ phase: "ended", message: "Call ended." });
    expect([peers[0]!.closed, track.stopped]).toEqual([true, true]);
  });

  test("the seller answers a ringing call, then answers the offer", async () => {
    let signals: unknown[] = [];
    const { engine, sent, peers, tick } = harness((method, path) => {
      if (path.endsWith("/answer")) return { ...call({ status: "answered", role: "callee" }), ice_servers: relay };
      if (method === "GET") return { ...call({ status: "answered", role: "callee" }), signals };
      return { object: "ok" };
    });
    engine.ring(call({ role: "caller" }));
    expect(engine.current.phase).toBe("idle");
    engine.ring(call({ role: "callee" }));
    expect(engine.current.phase).toBe("incoming");
    await engine.answer();
    expect(peers[0]!.config.iceTransportPolicy).toBe("relay");
    signals = [{ id: "3", kind: "offer", payload: { type: "offer", sdp: "offer-sdp" } }];
    await tick();
    expect(peers[0]!.remote).toEqual([{ type: "offer", sdp: "offer-sdp" }]);
    expect(sent.find(item => item.path === `${id}/signals`)?.body).toEqual({ kind: "answer", payload: { type: "answer", sdp: "answer-sdp" } });
  });

  test("without the microphone the call waits to be allowed: calling starts once it is, a ringing call keeps ringing", async () => {
    const refused = (name: string) => Object.assign(new Error(name), { name });
    const caller = harness((method, path) => (path === "start" ? { ...call(), ice_servers: relay } : { ...call(), signals: [] }));
    const deps = (caller.engine as unknown as { deps: CallDeps }).deps;
    const allow = deps.microphone;
    deps.microphone = async () => {
      throw refused("NotAllowedError");
    };
    await caller.engine.call({ conversation_id: id });
    expect(caller.engine.current).toMatchObject({ phase: "microphone", microphone: "blocked" });
    expect(caller.engine.busy).toBe(true);
    expect(caller.sent).toHaveLength(0);
    deps.microphone = allow;
    await caller.engine.retryMicrophone();
    expect(caller.sent[0]).toMatchObject({ method: "POST", path: "start", body: { conversation_id: id } });
    expect(caller.engine.current.phase).toBe("ringing");

    // Cancelling before anything started asks Udozo nothing.
    const cancelled = harness(() => ({}));
    (cancelled.engine as unknown as { deps: CallDeps }).deps.microphone = async () => {
      throw refused("NotFoundError");
    };
    await cancelled.engine.call({ listing_id: id });
    expect(cancelled.engine.current.microphone).toBe("missing");
    await cancelled.engine.hangUp();
    expect(cancelled.engine.current.phase).toBe("idle");
    expect(cancelled.sent).toHaveLength(0);

    const seller = harness((method, path) => (path.endsWith("/answer") ? { ...call({ status: "answered", role: "callee" }), ice_servers: relay } : method === "GET" ? { ...call({ role: "callee" }), signals: [] } : { object: "ok" }));
    const sellerDeps = (seller.engine as unknown as { deps: CallDeps }).deps;
    const sellerAllow = sellerDeps.microphone;
    sellerDeps.microphone = async () => {
      throw refused("NotReadableError");
    };
    seller.engine.ring(call({ role: "callee" }));
    await seller.engine.answer();
    expect(seller.engine.current).toMatchObject({ phase: "microphone", microphone: "in_use" });
    expect(seller.sent.some(item => item.path.endsWith("/end") || item.path.endsWith("/answer"))).toBe(false);
    sellerDeps.microphone = sellerAllow;
    await seller.engine.retryMicrophone();
    expect(seller.sent.some(item => item.path === `${id}/answer`)).toBe(true);
    expect(seller.peers[0]!.config.iceTransportPolicy).toBe("relay");

    // Declining from the microphone step ends the ringing call as declined.
    const decline = harness(() => ({ ...call({ status: "declined", role: "callee" }) }));
    (decline.engine as unknown as { deps: CallDeps }).deps.microphone = async () => {
      throw refused("NotAllowedError");
    };
    decline.engine.ring(call({ role: "callee" }));
    await decline.engine.answer();
    await decline.engine.hangUp();
    expect(decline.sent.map(item => item.path)).toEqual([`${id}/end`]);
    expect(decline.engine.current).toMatchObject({ phase: "ended", message: "Call declined." });
    expect([micProblem(new TypeError("x")), micProblem({ name: "SecurityError" }), micProblem(null)]).toEqual(["unsupported", "blocked", "blocked"]);
  });

  test("a refusal or a missed call end it with words for the side reading", async () => {
    const offline = harness(() => new Error("The seller is not on Udozo right now."));
    await offline.engine.call({ listing_id: id });
    expect(offline.engine.current).toMatchObject({ phase: "ended", message: "The seller is not on Udozo right now." });

    const missed = harness((method, path) => (path === "start" ? { ...call(), ice_servers: relay } : { ...call({ status: "missed" }), signals: [] }));
    await missed.engine.call({ conversation_id: id });
    await missed.tick();
    expect(missed.engine.current.message).toBe("No answer. Ask them to call you back, or chat with them.");
  });

  test("ended in each side's words", () => {
    expect(endedText({ status: "declined", role: "caller" })).toBe("They could not take your call just now.");
    expect(endedText({ status: "cancelled", role: "callee" })).toBe("The caller hung up.");
    expect(endedText({ status: "lost", role: "callee" })).toBe("The call dropped.");
    expect(callTime(65_000)).toBe("1:05");
    expect(callTime(3_725_000)).toBe("1:02:05");
  });
});

describe("the call panel", () => {
  const view = (over: Partial<CallView>): CallView => ({ phase: "idle", call: null, message: null, muted: false, connectedAt: null, ...over });
  const panel = (value: CallView) => renderToStaticMarkup(createElement(CallPanel, { view: value, onAnswer: () => undefined, onHangUp: () => undefined, onMute: () => undefined, onClose: () => undefined, onRetry: () => undefined }));

  test("without the microphone: what is wrong, how to allow it, and Allow microphone or Try again", () => {
    const blocked = panel(view({ phase: "microphone", microphone: "blocked" }));
    expect(blocked).toContain("Allow your microphone to call");
    expect(blocked).toContain("blocking the microphone for udozo.com");
    expect(blocked).toContain("On iPhone or iPad:");
    expect(blocked).toContain("Try again");
    expect(blocked).toContain(">Cancel<");
    const ringing = panel(view({ phase: "microphone", microphone: "blocked", call: call({ role: "callee", with: { name: "Zainab M." } }) }));
    expect(ringing).toContain("allow your microphone to answer");
    expect(ringing).toContain(">Decline<");

    expect(micHelp("blocked", "prompt")).toMatchObject({ steps: false, action: "Allow microphone" });
    expect(micHelp("blocked", "denied")).toMatchObject({ steps: true, action: "Try again" });
    expect(micHelp("missing", null).text).toContain("could not find a microphone");
    expect(micHelp("in_use", null).text).toContain("Another app is using your microphone");
    expect(micHelp("unsupported", null).action).toBeNull();
  });

  test("rings with Answer and Decline, names the caller by their public name, never a number", () => {
    const html = panel(view({ phase: "incoming", call: call({ role: "callee", with: { name: "Zainab M." } }) }));
    expect(html).toContain('aria-label="Incoming call from Zainab M."');
    expect(html).toContain('aria-label="Answer"');
    expect(html).toContain('aria-label="Decline"');
    expect(html).toContain('href="/ng/l/1-haier"');
    expect(html).toContain("no numbers are shared");
    expect(panel(view({}))).toBe("");
  });

  test("in a call: the time, Mute and End", () => {
    const html = panel(view({ phase: "connected", call: call({ status: "answered" }), connectedAt: Date.now() - 5000 }));
    expect(html).toMatch(/0:0[45]/);
    expect(html).toContain('aria-label="Mute"');
    expect(html).toContain('aria-label="End the call"');
    expect(statusText(view({ phase: "ringing" }), 0)).toBe("Ringing…");
  });
});

describe("the listing's ways to get in touch", () => {
  const listing = { id, title: "Haier 32 inch TV", url: "https://udozo.com/ng/l/1-haier", currency: "NGN", active: true, chat: true, phone: true, buyPath: "/ng/l/1/buy", buyHref: null, buyLabel: "" };
  const viewer = (over: Partial<ShopViewer> = {}): ShopViewer => ({
    object: "classified_listing_viewer",
    listing_id: id,
    own: false,
    favourite: false,
    conversation_id: null,
    order: null,
    can_contact: true,
    contact: { available: true, shared: null, request: null },
    callback: { available: true, request: null },
    seller_online: true,
    calls: true,
    ...over,
  });
  const render = (props: Partial<Parameters<typeof ListingActions>[0]>, calls = true) => {
    const actions = createElement(ListingActions, { listing, viewer: viewer(), signedIn: true, chat: null, messagesHref: "/account/messages", myPhone: "+2348031234567", ...props });
    return renderToStaticMarkup(calls ? createElement(CallProvider, null, actions) : actions);
  };

  test("Chat with seller, Call seller (online), Request call back and Request contact; no phone on the page", () => {
    const html = render({});
    for (const label of ["Chat with seller", "Call seller", "Request call back", "Request contact"]) expect(html).toContain(label);
    expect(html).toContain("The seller is on Udozo now");
    expect(html).not.toContain("Show phone");
    expect(html).toContain("ending 4567");
    expect(html).not.toContain("+2348031234567");
  });

  test("offline, Call seller waits; on a store (no calls) it is not offered", () => {
    const offline = render({ viewer: viewer({ seller_online: false }) });
    expect(offline).toMatch(/<button type="button" disabled=""[^>]*title="The seller is not on Udozo right now"/);
    expect(offline).toContain("ask them to call you back, or chat");
    expect(render({}, false)).not.toContain("Call seller");
  });

  test("once shared, the seller's phone and email show here; requests show their state", () => {
    const shared = render({ viewer: viewer({ contact: { available: true, shared: { phone: "+2348031120001", email: "seller@example.com" }, request: null } }) });
    expect(shared).toContain('href="tel:+2348031120001"');
    expect(shared).toContain('href="mailto:seller@example.com"');
    expect(shared).not.toContain("Request contact");
    const waiting = render({ viewer: viewer({ contact: { available: true, shared: null, request: { id, status: "pending", ask_again_at: null } }, callback: { available: true, request: { id, status: "pending", created_at: "" } } }) });
    expect(waiting).toContain("Contact requested");
    expect(waiting).toContain("Call back asked");
    expect(requestState({ status: "declined", ask_again_at: new Date(Date.now() + 86_400_000).toISOString() })).toBe("declined");
    expect(requestState({ status: "declined", ask_again_at: new Date(Date.now() - 1000).toISOString() })).toBe("none");
  });

  test("signed out, each asks to sign in and comes back", () => {
    const html = render({ signedIn: false, viewer: null });
    expect(html).toContain("for=call");
    expect(html).toContain("for=phone");
    expect(html).toContain("Request contact");
  });

  test("the seller's lists read in plain words", () => {
    expect(requestOutcome({ kind: "contact", status: "accepted" })).toBe("You shared your contact");
    expect(callLine({ role: "callee", status: "missed" })).toBe("Missed call");
    expect(callLine({ role: "caller", status: "missed" })).toBe("No answer");
  });
});
