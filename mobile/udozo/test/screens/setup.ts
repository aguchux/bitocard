/* Screen tests: the API, navigation and the phone's stores are stand-ins; each test says what the API answers. */

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
  };
});

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3, MAX: 5 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  AndroidNotificationPriority: { MAX: 'max' },
  BackgroundNotificationTaskResult: { NewData: 0, NoData: 1, Failed: 2 },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationCategoryAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async () => 'notice'),
  dismissNotificationAsync: jest.fn(async () => undefined),
  registerTaskAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: 'android', data: 'fcm-test-token-0000000000' })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-router', () => {
  const React = require('react');
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), setParams: jest.fn() };
  const Stack = Object.assign(({ children }: { children?: unknown }) => children ?? null, { Screen: () => null });
  // A focused screen's effect runs once it is drawn, as on a phone.
  const useFocusEffect = (effect: () => void | (() => void)) => React.useEffect(effect, [effect]);
  return { router, Stack, useFocusEffect, useLocalSearchParams: jest.fn(() => ({})), Link: ({ children }: { children: unknown }) => React.createElement(React.Fragment, null, children) };
});

// The JavaScript tabs: the bar reports its height to nobody in tests.
jest.mock('expo-router/js-tabs', () => {
  const React = require('react');
  return { BottomTabBarHeightCallbackContext: React.createContext(undefined), useBottomTabBarHeight: () => 0 };
});

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));
jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: jest.fn(async () => false), AppleAuthenticationButton: () => null, AppleAuthenticationButtonType: {}, AppleAuthenticationButtonStyle: {}, AppleAuthenticationScope: {} }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })) }));

jest.mock('@/lib/api', () => {
  const core = jest.requireActual('@/lib/api-core');
  return { api: jest.fn(), apiUpload: jest.fn(), privateImage: (path: string) => ({ uri: path }), ApiError: core.ApiError, newIdempotencyKey: (() => {
    let made = 0;
    return () => `key-${++made}`;
  })() };
});

// Icons draw nothing in tests (their package is ES modules only).
jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (target, name) => (name === '__esModule' ? true : () => null) }));


// Money steps: Face ID or the fingerprint says yes unless a test says otherwise.
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  hasHardwareAsync: jest.fn(async () => true),
  getEnrolledLevelAsync: jest.fn(async () => 3),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));
jest.mock('expo-screen-capture', () => ({ usePreventScreenCapture: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: jest.fn(() => [{ granted: true, canAskAgain: true }, jest.fn()]) }));

// Calls: the phone's call screen, WebRTC and PushKit are stand-ins (the tests that need calls also set their native
// modules, which `callsSupported` looks for); the ring tones play nothing.
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(() => ({ loop: false, play: jest.fn(), remove: jest.fn() })) }));
jest.mock('react-native-webrtc', () => {
  const track = { enabled: true, stop: jest.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  class RTCPeerConnection {
    static made: unknown[] = [];
    connectionState = 'new';
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
      RTCPeerConnection.made.push(this);
    }
    addTrack = jest.fn();
    addEventListener = jest.fn();
    createOffer = jest.fn(async () => ({ type: 'offer', sdp: 'offer-sdp' }));
    createAnswer = jest.fn(async () => ({ type: 'answer', sdp: 'answer-sdp' }));
    setLocalDescription = jest.fn(async () => undefined);
    setRemoteDescription = jest.fn(async () => undefined);
    addIceCandidate = jest.fn(async () => undefined);
    close = jest.fn();
  }
  return {
    RTCPeerConnection,
    mediaDevices: { getUserMedia: jest.fn(async () => stream) },
    permissions: { request: jest.fn(async () => true) },
    RTCAudioSession: { audioSessionDidActivate: jest.fn(), audioSessionDidDeactivate: jest.fn() },
  };
});
jest.mock('react-native-callkeep', () => ({
  __esModule: true,
  default: {
    setup: jest.fn(async () => true),
    setAvailable: jest.fn(),
    displayIncomingCall: jest.fn(),
    answerIncomingCall: jest.fn(),
    startCall: jest.fn(),
    reportConnectedOutgoingCallWithUUID: jest.fn(),
    reportEndCallWithUUID: jest.fn(),
    setCurrentCallActive: jest.fn(),
    setMutedCall: jest.fn(),
    toggleAudioRouteSpeaker: jest.fn(),
    setAudioRoute: jest.fn(async () => undefined),
    getAudioRoutes: jest.fn(async () => []),
    getInitialEvents: jest.fn(async () => []),
    clearInitialEvents: jest.fn(),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));
jest.mock('react-native-voip-push-notification', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(), registerVoipToken: jest.fn(), RNVoipPushRemoteNotificationsRegisteredEvent: 'register', RNVoipPushRemoteNotificationReceivedEvent: 'notification' },
}));
