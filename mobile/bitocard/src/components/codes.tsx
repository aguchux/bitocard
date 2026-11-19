import * as Clipboard from 'expo-clipboard';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, inter, T, useTheme } from '@/components/ui';
import { confirmOnPhone } from '@/lib/biometrics';
import type { Delivery } from '@/lib/types';

/**
 * A delivered order's codes (gift card codes and PINs, licence keys, tokens): hidden until Reveal, which asks Face ID,
 * the fingerprint or the PIN; while shown, screenshots and screen recording are blocked. Each has a copy button.
 */
export function Codes({ deliveries, instructions }: { deliveries: Delivery[]; instructions?: string | null }) {
  const [shown, setShown] = useState(false);
  const secret = deliveries.filter(item => item.code || item.pin);
  if (!secret.length) return null;
  return (
    <Card>
      <T kind="heading">{secret.length > 1 ? `Your ${secret.length} codes` : 'Your code'}</T>
      {shown ? (
        <Revealed deliveries={secret} />
      ) : (
        <>
          {secret.map((item, index) => (
            <T key={index} style={styles.masked} accessibilityLabel="Hidden code">
              {mask(item.code ?? item.pin ?? '')}
            </T>
          ))}
          <Button
            label="Reveal"
            onPress={async () => {
              if (await confirmOnPhone('Show your codes')) setShown(true);
            }}
          />
        </>
      )}
      {instructions ? (
        <T kind="small" muted>
          {instructions}
        </T>
      ) : null}
    </Card>
  );
}

/** Mounted only while codes show, so screen capture is blocked exactly then. */
function Revealed({ deliveries }: { deliveries: Delivery[] }) {
  const theme = useTheme();
  usePreventScreenCapture();
  return (
    <View style={{ gap: 12 }}>
      {deliveries.map((item, index) => (
        <View key={index} style={[styles.code, { borderColor: theme.field }]}>
          {item.code ? (
            <>
              <T kind="small" muted>
                Code
              </T>
              <T selectable style={styles.value}>
                {item.code}
              </T>
              <Button kind="secondary" label="Copy code" onPress={() => void Clipboard.setStringAsync(item.code!)} />
            </>
          ) : null}
          {item.pin ? (
            <>
              <T kind="small" muted>
                PIN
              </T>
              <T selectable style={styles.value}>
                {item.pin}
              </T>
              <Button kind="secondary" label="Copy PIN" onPress={() => void Clipboard.setStringAsync(item.pin!)} />
            </>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** All but the last 4 characters as dots. */
export const mask = (value: string) => (value.length <= 4 ? '••••' : `${'•'.repeat(Math.min(12, value.length - 4))}${value.slice(-4)}`);

const styles = StyleSheet.create({
  masked: { fontFamily: inter.bold, fontSize: 18, letterSpacing: 2 },
  code: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, padding: 12, gap: 6 },
  value: { fontFamily: inter.extrabold, fontSize: 18, letterSpacing: 1 },
});
