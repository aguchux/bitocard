// Calls: the rules the engine, the panel and the Call buttons follow, what pushes carry, and the engine itself with fakes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ShopCall } from '../src/shared/classifieds.ts';
import { CallEngine, type ApiAnswer, type CallDeps, type PeerLike } from '../src/lib/call-engine.ts';
import {
  callPush,
  callTime,
  chatCallButton,
  endedText,
  fastMs,
  idleView,
  incomingMs,
  listingCallButton,
  lostFromQuiet,
  micHelp,
  micProblem,
  pollDelay,
  quietMs,
  ringExpired,
  ringGraceMs,
  slowMs,
  statusText,
  systemCallName,
} from '../src/lib/calls.ts';

const id = '0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d';
const call = (over: Partial<ShopCall> = {}): ShopCall => ({
  object: 'classified_call',
  id,
  status: 'ringing',
  role: 'caller',
  with: { name: 'Ada O.' },
  listing: { id: 'l1', title: 'iPhone 13', path: '/ng/l/12-iphone-13' },
  ring_until: new Date(1_000_000 + 45_000).toISOString(),
  answered_at: null,
  ended_at: null,
  created_at: new Date(1_000_000).toISOString(),
  ...over,
});

test('polling is every second while connecting, every 3 once connected, every 2 while it rings here', () => {
  assert.equal(pollDelay('ringing'), fastMs);
  assert.equal(pollDelay('connecting'), 1000);
  assert.equal(pollDelay('connected'), slowMs);
  assert.equal(pollDelay('connected'), 3000);
  assert.equal(pollDelay('incoming'), incomingMs);
  assert.equal(pollDelay('microphone'), incomingMs);
});

test('a call rings 45 seconds, then a grace for the API, and an answered call is lost after 30 quiet seconds', () => {
  assert.equal(ringExpired(call(), 1_000_000 + 45_000 + ringGraceMs), false);
  assert.equal(ringExpired(call(), 1_000_000 + 45_000 + ringGraceMs + 1), true);
  assert.equal(ringExpired(call({ status: 'answered' }), 9_999_999), false);
  // Without ring_until, from when it was made.
  assert.equal(ringExpired(call({ ring_until: null }), 1_000_000 + 51_000), true);
  assert.equal(quietMs, 30_000);
  assert.equal(lostFromQuiet(0, 30_000), false);
  assert.equal(lostFromQuiet(0, 30_001), true);
});

test('the microphone step says what went wrong, and only a refusal opens settings', () => {
  assert.equal(micProblem({ name: 'NotAllowedError' }), 'blocked');
  assert.equal(micProblem(new Error('denied')), 'blocked');
  assert.equal(micProblem({ name: 'NotFoundError' }), 'missing');
  assert.equal(micProblem({ name: 'NotReadableError' }), 'in_use');
  assert.equal(micHelp('blocked').settings, true);
  assert.equal(micHelp('missing').settings, false);
});

test('why a call ended, in each side’s words', () => {
  assert.match(endedText({ status: 'missed', role: 'caller' }), /No answer/);
  assert.equal(endedText({ status: 'missed', role: 'callee' }), 'You missed the call.');
  assert.equal(endedText({ status: 'cancelled', role: 'callee' }), 'The caller hung up.');
  assert.equal(endedText({ status: 'lost', role: 'caller' }), 'The call dropped.');
});

test('the panel’s status and timer', () => {
  assert.equal(callTime(65_000), '1:05');
  assert.equal(callTime(3_725_000), '1:02:05');
  assert.equal(statusText({ ...idleView, phase: 'incoming' }, 0), 'Calling you on Udozo');
  assert.equal(statusText({ ...idleView, phase: 'connected', connectedAt: 1000 }, 6000), '0:05');
});

test('Call seller shows where the viewer offers calls, and says why it cannot be pressed', () => {
  const viewer = { calls: true, seller_online: true, own: false, can_contact: true };
  assert.deepEqual(listingCallButton(viewer, false), { show: true, ready: true, hint: 'A private call on Udozo: no numbers shared.' });
  assert.equal(listingCallButton({ ...viewer, calls: false }, false).show, false);
  assert.equal(listingCallButton({ ...viewer, own: true }, false).show, false);
  assert.equal(listingCallButton(null, false).show, false);
  assert.match(listingCallButton({ ...viewer, seller_online: false }, false).hint, /not on Udozo right now/);
  assert.equal(listingCallButton({ ...viewer, seller_online: false }, false).ready, false);
  assert.match(listingCallButton(viewer, true).hint, /already in a call/);
});

test('Call in a chat follows can_call and whether they are online', () => {
  assert.equal(chatCallButton({ can_call: false, with: { name: 'Ada O.', online: true } }, false).show, false);
  assert.equal(chatCallButton({ can_call: true, with: { name: 'Ada O.', online: true } }, false).ready, true);
  assert.match(chatCallButton({ can_call: true, with: { name: 'Ada O.', online: false } }, false).hint, /Ada O\. is not on Udozo/);
});

test('pushes are read exactly as the API sends them (native-push.ts)', () => {
  assert.deepEqual(callPush({ kind: 'call', call_id: id, caller: 'Ada O.', about: 'iPhone 13' }), { kind: 'call', callId: id, caller: 'Ada O.', about: 'iPhone 13' });
  // FCM leaves out a null `about`.
  assert.deepEqual(callPush({ kind: 'call', call_id: id, caller: 'Ada O.' }), { kind: 'call', callId: id, caller: 'Ada O.', about: null });
  assert.deepEqual(callPush({ kind: 'call_ended', call_id: id, reason: 'answered' }), { kind: 'call_ended', callId: id, reason: 'answered' });
  assert.deepEqual(callPush({ dataString: JSON.stringify({ kind: 'call_ended', call_id: id, reason: 'ended' }) }), { kind: 'call_ended', callId: id, reason: 'ended' });
  assert.equal(callPush({ kind: 'call', call_id: 'not-a-uuid' }), null);
  assert.equal(callPush({ id: 'n1', type: 'customer.classifieds.message', link: '/account' }), null);
  assert.equal(callPush(null), null);
  assert.equal(systemCallName({ caller: 'Ada O.', about: 'iPhone 13' }), 'Ada O. · iPhone 13');
});

/** The engine with a fake API, microphone, peer connection and clock. */
function harness(routes: Record<string, (body?: unknown) => ApiAnswer<unknown>>, options: { microphone?: () => Promise<never> } = {}) {
  let clock = 1_000_000;
  const timers: { fn: () => void; at: number; handle: number }[] = [];
  let next = 0;
  const calls: string[] = [];
  const system: string[] = [];
  const views: string[] = [];
  const peerListeners: Record<string, (event: { candidate?: unknown }) => void> = {};
  const peer = {
    connectionState: 'new',
    addTrack: () => undefined,
    createOffer: async () => ({ type: 'offer', sdp: 'offer-sdp' }),
    createAnswer: async () => ({ type: 'answer', sdp: 'answer-sdp' }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
    addIceCandidate: async () => undefined,
    close: () => void system.push('peer closed'),
    addEventListener: (type: string, listener: (event: { candidate?: unknown }) => void) => void (peerListeners[type] = listener),
  };
  let config: unknown = null;
  const track = { enabled: true, stop: () => void system.push('track stopped') };
  const deps: CallDeps = {
    api: async <T>(method: 'GET' | 'POST', path: string, body?: unknown) => {
      calls.push(`${method} ${path}`);
      const route = routes[`${method} ${path.split('?')[0]}`];
      return (route ? route(body) : { ok: false, status: 404, message: 'No such call.' }) as ApiAnswer<T>;
    },
    microphone: options.microphone ?? (async () => ({ getTracks: () => [track], getAudioTracks: () => [track] })),
    peer: given => {
      config = given;
      return peer as unknown as PeerLike;
    },
    system: {
      outgoing: c => void system.push(`outgoing ${c.id}`),
      answered: c => void system.push(`answered ${c.id}`),
      connected: c => void system.push(`connected ${c.id}`),
      ended: c => void system.push(`ended ${c}`),
      mute: (_c, muted) => void system.push(`mute ${muted}`),
      speaker: (_c, on) => void system.push(`speaker ${on}`),
    },
    onView: view => void views.push(view.phase),
    later: (fn, ms) => {
      const handle = ++next;
      timers.push({ fn, at: clock + ms, handle });
      return handle;
    },
    cancel: handle => {
      const index = timers.findIndex(timer => timer.handle === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    now: () => clock,
  };
  const engine = new CallEngine(deps);
  /** Moves the clock on and runs what is due, waiting for each poll to settle. */
  const advance = async (ms: number) => {
    clock += ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const due = timers[0];
      if (!due || due.at > clock) break;
      timers.shift();
      due.fn();
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
    }
  };
  return { engine, calls, system, views, peer, peerListeners, advance, config: () => config, delays: () => timers.map(timer => timer.at - clock) };
}

const ice = [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }];

test('calling: rings out, connects through the relay only once answered, then ends', async () => {
  let status = 'ringing';
  const h = harness({
    'POST listings/l1/calls': () => ({ ok: true, data: { ...call(), ice_servers: ice } }),
    'GET calls/0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d': () => ({ ok: true, data: { ...call({ status: status as ShopCall['status'] }), signals: status === 'answered' ? [{ id: '7', kind: 'answer', payload: { type: 'answer', sdp: 'their-sdp' } }] : [] } }),
    'POST calls/0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d/signals': () => ({ ok: true, data: {} }),
    'POST calls/0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d/end': () => ({ ok: true, data: call({ status: 'ended' }) }),
  });
  await h.engine.call({ listing_id: 'l1' });
  assert.equal(h.engine.current.phase, 'ringing');
  assert.deepEqual(h.system, [`outgoing ${id}`]);
  await h.advance(0);
  // Still ringing: read again a second later.
  assert.deepEqual(h.delays(), [fastMs]);
  status = 'answered';
  await h.advance(fastMs);
  assert.deepEqual(h.config(), { iceServers: ice, iceTransportPolicy: 'relay' });
  assert.ok(h.calls.includes(`POST calls/${id}/signals`));
  h.peer.connectionState = 'connected';
  h.peerListeners.connectionstatechange({});
  assert.equal(h.engine.current.phase, 'connected');
  assert.ok(h.system.includes(`connected ${id}`));
  // The next poll asks only for signals after the last one read, then every 3 seconds.
  await h.advance(fastMs);
  assert.ok(h.calls.some(line => line === `GET calls/${id}?after=7`));
  assert.deepEqual(h.delays(), [slowMs]);
  h.engine.toggleMute();
  assert.equal(h.engine.current.muted, true);
  h.engine.toggleSpeaker();
  assert.equal(h.engine.current.speaker, true);
  await h.engine.hangUp();
  assert.equal(h.engine.current.phase, 'ended');
  assert.ok(h.system.includes(`ended ${id}`));
  assert.ok(h.system.includes('track stopped'));
  await h.advance(4000);
  assert.equal(h.engine.current.phase, 'idle');
});

test('the API’s refusal ends the call with its words, and the microphone is let go', async () => {
  const h = harness({ 'POST conversations/c1/calls': () => ({ ok: false, status: 409, message: 'The buyer is not on Udozo right now. Write to them here instead.' }) });
  await h.engine.call({ conversation_id: 'c1' });
  assert.equal(h.engine.current.phase, 'ended');
  assert.match(h.engine.current.message!, /not on Udozo right now/);
  assert.ok(h.system.includes('track stopped'));
});

test('without the microphone the call waits on the microphone step, and nothing is started', async () => {
  const h = harness({}, { microphone: async () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) });
  await h.engine.call({ listing_id: 'l1' });
  assert.equal(h.engine.current.phase, 'microphone');
  assert.equal(h.engine.current.microphone, 'blocked');
  assert.deepEqual(h.calls, []);
  await h.engine.hangUp();
  assert.equal(h.engine.current.phase, 'idle');
});

test('a call ringing here is answered, and the callee answers the caller’s offer', async () => {
  const h = harness({
    'POST calls/0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d/answer': () => ({ ok: true, data: { ...call({ role: 'callee', status: 'answered' }), ice_servers: ice } }),
    'GET calls/0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d': () => ({ ok: true, data: { ...call({ role: 'callee', status: 'answered' }), signals: [{ id: '3', kind: 'offer', payload: { type: 'offer', sdp: 'offer' } }] } }),
    'POST calls/0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d/signals': body => ({ ok: true, data: body }),
  });
  h.engine.ring(call({ role: 'callee' }));
  assert.equal(h.engine.current.phase, 'incoming');
  await h.engine.answer();
  assert.equal(h.engine.current.phase, 'connecting');
  assert.ok(h.system.includes(`answered ${id}`));
  await h.advance(0);
  assert.equal(h.calls.filter(line => line === `POST calls/${id}/signals`).length, 1);
});

test('a call the push woke the app for is read, then answered', async () => {
  const h = harness({
    'GET calls/0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d': () => ({ ok: true, data: { ...call({ role: 'callee' }), signals: [] } }),
    'POST calls/0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d/answer': () => ({ ok: true, data: { ...call({ role: 'callee', status: 'answered' }), ice_servers: ice } }),
  });
  await h.engine.answerById(id);
  assert.deepEqual(h.calls.slice(0, 2), [`GET calls/${id}`, `POST calls/${id}/answer`]);
  assert.equal(h.engine.current.phase, 'connecting');
});

test('a call that ended before the app opened is not answered', async () => {
  const h = harness({ 'GET calls/0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d': () => ({ ok: true, data: { ...call({ role: 'callee', status: 'cancelled' }), signals: [] } }) });
  await h.engine.answerById(id);
  assert.equal(h.engine.current.phase, 'ended');
  assert.equal(h.engine.current.message, 'The caller hung up.');
  assert.ok(!h.calls.some(line => line.endsWith('/answer')));
  assert.ok(h.system.includes(`ended ${id}`));
});

test('ringing out past 45 seconds ends as missed, even while Udozo cannot be reached', async () => {
  const h = harness({
    'POST listings/l1/calls': () => ({ ok: true, data: { ...call(), ice_servers: ice } }),
    'GET calls/0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d': () => ({ ok: false, status: 0, message: 'offline' }),
  });
  await h.engine.call({ listing_id: 'l1' });
  await h.advance(0);
  assert.equal(h.engine.current.phase, 'ringing');
  for (let i = 0; i < 60 && h.engine.current.phase === 'ringing'; i++) await h.advance(fastMs);
  assert.equal(h.engine.current.phase, 'ended');
  assert.match(h.engine.current.message!, /No answer/);
});

test('an answered call quiet for 30 seconds (Udozo unreachable) has dropped', async () => {
  let reachable = true;
  const h = harness({
    'POST listings/l1/calls': () => ({ ok: true, data: { ...call(), ice_servers: ice } }),
    'GET calls/0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d': () => (reachable ? { ok: true, data: { ...call({ status: 'answered' }), signals: [] } } : { ok: false, status: 0, message: 'offline' }),
    'POST calls/0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d/signals': () => ({ ok: true, data: {} }),
  });
  await h.engine.call({ listing_id: 'l1' });
  await h.advance(0);
  h.peer.connectionState = 'connected';
  h.peerListeners.connectionstatechange({});
  reachable = false;
  await h.advance(27_000);
  assert.equal(h.engine.current.phase, 'connected');
  await h.advance(6_000);
  assert.equal(h.engine.current.phase, 'ended');
  assert.equal(h.engine.current.message, 'The call dropped.');
});

test('the app is at least the version the API rings phones from (callsFromAppVersion in apps/udozo-api)', async () => {
  const { readFileSync } = await import('node:fs');
  const { compareVersions } = await import('../src/lib/version.ts');
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as { expo: { version: string } };
  const api = readFileSync(new URL('../../../apps/udozo-api/src/notifications/push.service.ts', import.meta.url), 'utf8').match(/callsFromAppVersion = '([\d.]+)'/)?.[1];
  assert.ok(api, 'callsFromAppVersion in the API');
  assert.ok(compareVersions(app.expo.version, api) >= 0, `app.json's ${app.expo.version} is below ${api}`);
});
