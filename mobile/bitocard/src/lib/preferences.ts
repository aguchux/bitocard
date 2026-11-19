import * as SecureStore from 'expo-secure-store';
import { Appearance } from 'react-native';

/** The customer's own choices kept on this phone: the theme (else the phone's), applied when the app opens. */
export type ThemeChoice = 'system' | 'light' | 'dark';

const themeKey = 'bitocard.theme';

export async function savedTheme(): Promise<ThemeChoice> {
  try {
    const value = await SecureStore.getItemAsync(themeKey);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice) {
  Appearance.setColorScheme(choice === 'system' ? 'unspecified' : choice);
}

export async function chooseTheme(choice: ThemeChoice) {
  applyTheme(choice);
  try {
    await SecureStore.setItemAsync(themeKey, choice);
  } catch {
    // Kept for this session only.
  }
}
