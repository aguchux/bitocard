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
  AndroidImportance: { DEFAULT: 3 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
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
  return { router, Stack, useLocalSearchParams: jest.fn(() => ({})), Link: ({ children }: { children: unknown }) => React.createElement(React.Fragment, null, children) };
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
