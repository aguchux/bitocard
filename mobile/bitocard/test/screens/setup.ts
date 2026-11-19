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

jest.mock('expo-router', () => {
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
  const Stack = Object.assign(() => null, { Screen: () => null });
  return { router, Stack, Redirect: () => null, useLocalSearchParams: jest.fn(() => ({})) };
});

jest.mock('@/lib/api', () => {
  const core = jest.requireActual('@/lib/api-core');
  return { api: jest.fn(), ApiError: core.ApiError, newIdempotencyKey: () => 'key' };
});

// Icons draw nothing in tests (their package is ES modules only).
jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (target, name) => (name === '__esModule' ? true : () => null) }));

// Money steps: Face ID or the fingerprint says yes unless a test says otherwise.
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(async () => 3),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
