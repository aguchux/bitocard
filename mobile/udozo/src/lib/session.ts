import * as SecureStore from 'expo-secure-store';

/**
 * The customer's session token, in the Keychain (iPhone) or Keystore (Android), readable only while the phone is
 * unlocked and never moved to another phone. Never logged.
 */
const key = 'udozo.session';
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const readSession = () => SecureStore.getItemAsync(key, options);
export const saveSession = (token: string) => SecureStore.setItemAsync(key, token, options);
export const clearSession = () => SecureStore.deleteItemAsync(key, options);
