// Calls: the call panel, Call seller on a listing, Call in a chat, and a call ringing for the customer while the app is
// open. The phone's call screen and WebRTC are stand-ins (setup.ts); the API answers as udozo-api's calls do.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { Alert, NativeModules } from 'react-native';
import RNCallKeep from 'react-native-callkeep';

import ListingScreen from '@/app/listing/[ref]';
import { ChatCallButton } from '@/components/calls/call-button';
import { CallPanel } from '@/components/calls/call-panel';
import { CallProvider } from '@/components/calls/call-provider';
import { idleView, type CallView } from '@/lib/calls';

import { answers, mockedApi, renderScreen } from './helpers';

jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1', name: 'Ada Obi' }, pending: false }) }));
jest.mock('@/lib/market', () => ({ useMarket: () => ({ country: 'NG', markets: [], fixed: false, choose: jest.fn() }) }));

const callId = '0b6c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d';
const listingId = '11111111-1111-4111-8111-111111111111';
const call = (over: Record<string, unknown> = {}) => ({
  object: 'classified_call',
  id: callId,
  status: 'ringing',
  role: 'caller',
  with: { name: 'Chidi O.' },
  listing: { id: listingId, title: 'iPhone 13 Pro', path: '/ng/l/77-iphone-13-pro' },
  ring_until: new Date(Date.now() + 45_000).toISOString(),
  answered_at: null,
  ended_at: null,
  created_at: new Date().toISOString(),
  ...over,
});
const ice = [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }];
const presence = (incoming: unknown = null) => ({ object: 'classified_presence', calls: true, incoming });

const listing = {
  object: 'classified_listing_page',
  id: listingId,
  ref: 77,
  status: 'active',
  title: 'iPhone 13 Pro',
  slug: 'iphone-13-pro',
  description: null,
  price: { kind: 'fixed', amount: 65000000, currency: 'NGN' },
  condition: 'used',
  category: { slug: 'mobile-phones', name: 'Mobile phones', parent: null, safety_checklist: [] },
  area: { slug: 'ikeja', name: 'Ikeja', state: { slug: 'lagos', name: 'Lagos' } },
  features: [],
  brand: null,
  photos: [],
  video: null,
  delivery: 'none',
  reserved: false,
  contact: { chat: true, phone: true },
  seller: { name: 'Chidi O.', handle: 'abc123', username: null, member_since: '2025-01-10T00:00:00Z', badges: [], active_listings: 1, response_rate: null },
  published_at: '2026-11-10T10:00:00Z',
  sold_at: null,
};
const viewer = { object: 'classified_listing_viewer', own: false, can_contact: true, favourite: false, conversation_id: null, calls: true, seller_online: true };

beforeAll(() => {
  NativeModules.WebRTCModule = {};
  NativeModules.RNCallKeep = {};
});
afterAll(() => {
  delete NativeModules.WebRTCModule;
  delete NativeModules.RNCallKeep;
});
beforeEach(() => {
  jest.clearAllMocks();
});

const panel = (view: Partial<CallView>, handlers: Partial<Record<'onAnswer' | 'onHangUp' | 'onMute' | 'onSpeaker' | 'onClose' | 'onRetry', jest.Mock>> = {}) => (
  <CallPanel
    view={{ ...idleView, ...view }}
    onAnswer={handlers.onAnswer ?? jest.fn()}
    onHangUp={handlers.onHangUp ?? jest.fn()}
    onMute={handlers.onMute ?? jest.fn()}
    onSpeaker={handlers.onSpeaker ?? jest.fn()}
    onClose={handlers.onClose ?? jest.fn()}
    onRetry={handlers.onRetry ?? jest.fn()}
  />
);

test('the panel: an incoming call is answered or declined, by the caller’s public name only', async () => {
  const onAnswer = jest.fn();
  const onHangUp = jest.fn();
  await renderScreen(panel({ phase: 'incoming', call: call({ role: 'callee' }) as never }, { onAnswer, onHangUp }));
  expect(screen.getByText('Chidi O.')).toBeTruthy();
  expect(screen.getByText('Calling you on Udozo')).toBeTruthy();
  expect(screen.getByText('About iPhone 13 Pro')).toBeTruthy();
  expect(screen.getByText(/no numbers are shared/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Answer'));
  await fireEvent.press(screen.getByLabelText('Decline'));
  expect(onAnswer).toHaveBeenCalledTimes(1);
  expect(onHangUp).toHaveBeenCalledTimes(1);
});

test('the panel: once connected, the timer, Mute, Speaker and End', async () => {
  const onMute = jest.fn();
  const onSpeaker = jest.fn();
  const onHangUp = jest.fn();
  await renderScreen(panel({ phase: 'connected', connectedAt: Date.now() - 65_000, call: call({ status: 'answered' }) as never }, { onMute, onSpeaker, onHangUp }));
  expect(screen.getByText('1:05')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Mute'));
  await fireEvent.press(screen.getByLabelText('Speaker'));
  await fireEvent.press(screen.getByLabelText('End the call'));
  expect(onMute).toHaveBeenCalled();
  expect(onSpeaker).toHaveBeenCalled();
  expect(onHangUp).toHaveBeenCalled();
});

test('the panel: a refused microphone sends the customer to the phone’s settings, then Try again', async () => {
  const onRetry = jest.fn();
  await renderScreen(panel({ phase: 'microphone', microphone: 'blocked' }, { onRetry }));
  expect(screen.getByText(/Allow it in your phone’s settings/)).toBeTruthy();
  expect(screen.getByLabelText('Open settings')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Try again'));
  expect(onRetry).toHaveBeenCalled();
});

test('Call seller rings the seller through the relay and shows the call; cancelling ends it', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ ref: '77', country: 'NG' });
  const posted: string[] = [];
  answers({
    'POST /v1/classifieds/presence': presence(),
    'GET /v1/classifieds/listings/77': listing,
    [`GET /v1/classifieds/listings/${listingId}/viewer`]: viewer,
    [`POST /v1/classifieds/listings/${listingId}/calls`]: () => (posted.push('start'), { ...call(), ice_servers: ice }),
    [`GET /v1/classifieds/calls/${callId}`]: { ...call(), signals: [] },
    [`POST /v1/classifieds/calls/${callId}/end`]: () => (posted.push('end'), call({ status: 'cancelled' })),
  });
  const view = await renderScreen(
    <CallProvider>
      <ListingScreen />
    </CallProvider>,
  );
  await fireEvent.press(await screen.findByLabelText('Call seller'));
  expect(await screen.findByText('Ringing…')).toBeTruthy();
  expect(posted).toEqual(['start']);
  expect(RNCallKeep.startCall).toHaveBeenCalledWith(callId, 'Udozo', 'Chidi O.', 'generic', false);
  await fireEvent.press(screen.getByLabelText('Cancel the call'));
  await waitFor(() => expect(posted).toEqual(['start', 'end']));
  expect(await screen.findByText('Call ended.')).toBeTruthy();
  expect(RNCallKeep.reportEndCallWithUUID).toHaveBeenCalledWith(callId, 2);
  view.unmount();
});

test('Call seller is greyed while the seller is away, and says why', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ ref: '77', country: 'NG' });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  answers({
    'POST /v1/classifieds/presence': presence(),
    'GET /v1/classifieds/listings/77': listing,
    [`GET /v1/classifieds/listings/${listingId}/viewer`]: { ...viewer, seller_online: false },
  });
  const view = await renderScreen(
    <CallProvider>
      <ListingScreen />
    </CallProvider>,
  );
  const button = await screen.findByLabelText('Call seller');
  expect(button.props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(button);
  expect(alert).toHaveBeenCalledWith('Call seller', expect.stringMatching(/not on Udozo right now/));
  view.unmount();
});

test('Call in a chat is greyed while they are away, and says why', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  answers({
    'POST /v1/classifieds/presence': presence(),
    'POST /v1/classifieds/conversations/chat-1/calls': () => {
      const { ApiError } = jest.requireActual('@/lib/api-core');
      return new ApiError(409, { type: 'conflict_error', code: 'buyer_busy', message: 'The buyer is on another call. Try again in a few minutes.' });
    },
  });
  const chat = { id: 'chat-1', can_call: true, with: { name: 'Bola A.', online: false } };
  const away = await renderScreen(
    <CallProvider>
      <ChatCallButton chat={chat} />
    </CallProvider>,
  );
  await fireEvent.press(await screen.findByLabelText('Call Bola A.'));
  expect(alert).toHaveBeenCalledWith('Call Bola A.', 'Bola A. is not on Udozo right now. Write to them here instead.');
  away.unmount();
});

test('Call in a chat rings them, and the API’s refusal is said in words', async () => {
  answers({
    'POST /v1/classifieds/presence': presence(),
    'POST /v1/classifieds/conversations/chat-1/calls': () => {
      const { ApiError } = jest.requireActual('@/lib/api-core');
      return new ApiError(409, { type: 'conflict_error', code: 'buyer_busy', message: 'The buyer is on another call. Try again in a few minutes.' });
    },
  });
  const chat = { id: 'chat-1', can_call: true, with: { name: 'Bola A.', online: true } };
  const view = await renderScreen(
    <CallProvider>
      <ChatCallButton chat={chat} />
    </CallProvider>,
  );
  await fireEvent.press(await screen.findByLabelText('Call Bola A.'));
  expect(await screen.findByText('The buyer is on another call. Try again in a few minutes.')).toBeTruthy();
  view.unmount();
});

test('no Call button where the chat cannot call', async () => {
  answers({ 'POST /v1/classifieds/presence': presence() });
  const view = await renderScreen(
    <CallProvider>
      <ChatCallButton chat={{ id: 'chat-1', can_call: false, with: { name: 'Bola A.', online: true } }} />
    </CallProvider>,
  );
  expect(screen.queryByLabelText('Call Bola A.')).toBeNull();
  view.unmount();
});

test('a call ringing for the customer while the app is open is answered from the panel', async () => {
  const posted: string[] = [];
  answers({
    'POST /v1/classifieds/presence': presence(call({ role: 'callee', with: { name: 'Bola A.' } })),
    [`GET /v1/classifieds/calls/${callId}`]: { ...call({ role: 'callee', status: 'answered' }), signals: [] },
    [`POST /v1/classifieds/calls/${callId}/answer`]: () => (posted.push('answer'), { ...call({ role: 'callee', status: 'answered', with: { name: 'Bola A.' } }), ice_servers: ice }),
  });
  const view = await renderScreen(<CallProvider>{null}</CallProvider>);
  await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/v1/classifieds/presence', { body: {} }));
  expect(await screen.findByText('Calling you on Udozo')).toBeTruthy();
  expect(screen.getByText('Bola A.')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Answer'));
  await waitFor(() => expect(posted).toEqual(['answer']));
  expect(await screen.findByText('Connecting…')).toBeTruthy();
  expect(RNCallKeep.answerIncomingCall).toHaveBeenCalledWith(callId);
  view.unmount();
});
