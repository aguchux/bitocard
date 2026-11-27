import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const key = 'bitocard_transaction_pin_v1';
let activePin: string | null = null;

export const activeTransactionPin = () => activePin;
export const setActiveTransactionPin = (pin: string | null) => {
  activePin = pin;
};

export async function rememberTransactionPin(pin: string) {
  activePin = pin;
  await SecureStore.setItemAsync(key, pin, { keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY });
}

export async function forgetTransactionPin() {
  activePin = null;
  await SecureStore.deleteItemAsync(key).catch(() => undefined);
}

export const savedTransactionPin = () => SecureStore.getItemAsync(key).catch(() => null);

/** Face, fingerprint, or the device passcode. Any native error or an unsecured device fails closed. */
export async function authenticateDevice(reason: string) {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return false;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Use device passcode',
      cancelLabel: 'Use transaction PIN',
      disableDeviceFallback: false,
      biometricsSecurityLevel: 'strong',
    });
    return result.success;
  } catch {
    return false;
  }
}
