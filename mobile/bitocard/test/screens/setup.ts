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
  return { router, Redirect: () => null, useLocalSearchParams: jest.fn(() => ({})) };
});

jest.mock('@/lib/api', () => {
  const core = jest.requireActual('@/lib/api-core');
  return { api: jest.fn(), ApiError: core.ApiError, newIdempotencyKey: () => 'key' };
});

// Icons draw nothing in tests (their package is ES modules only).
jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (target, name) => (name === '__esModule' ? true : () => null) }));
