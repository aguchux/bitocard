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
  const vpn = secret.some(item => item.kind === 'vpn_account');
  return (
    <Card>
      <T kind="heading">{vpn ? 'Your VPN sign-in' : secret.length > 1 ? `Your ${secret.length} codes` : 'Your code'}</T>
      <T kind="small" muted>
        {vpn ? 'Your username and password for the VPN app. Keep them private: anyone with them can use your access.' : 'Keep these safe: anyone with a code can use it.'}
      </T>
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
              if (await confirmOnPhone(vpn ? 'Show your VPN sign-in' : 'Show your codes')) setShown(true);
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
      {deliveries.map((item, index) => {
        const vpn = item.kind === 'vpn_account';
        return (
          <View key={index} style={[styles.code, { borderColor: theme.field }]}>
            {vpn && item.serial ? <Secret label="Username" value={item.serial} /> : null}
            {item.code ? <Secret label={vpn ? 'Password' : item.kind === 'licence_key' ? 'Licence key' : item.kind === 'token' ? 'Token' : 'Code'} value={item.code} /> : null}
            {item.pin ? <Secret label="PIN" value={item.pin} /> : null}
            {!vpn && item.serial ? (
              <T kind="small" muted>
                Serial: {item.serial}
              </T>
            ) : null}
            {detailsOf(item).map(([label, value]) => (
              <T key={label} kind="small" muted>
                {label}: {value}
              </T>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function Secret({ label, value }: { label: string; value: string }) {
  return (
    <>
      <T kind="small" muted>
        {label}
      </T>
      <T selectable style={styles.value}>
        {value}
      </T>
      <Button kind="secondary" label={`Copy ${label.toLowerCase()}`} onPress={() => void Clipboard.setStringAsync(value)} />
    </>
  );
}

/** The details shown beside a code, as bitocard.com shows them: a licence's term, when it expires, where to redeem, a token's units. */
const detailLabels: Record<string, string> = { duration: 'Licence term', expires_at: 'Expires', redemption_url: 'Redeem at', units: 'Units' };

export function detailsOf(item: Delivery): [string, string][] {
  return Object.entries(item.details ?? {})
    .filter(([key, value]) => detailLabels[key] && (typeof value === 'string' || typeof value === 'number'))
    .map(([key, value]) => [detailLabels[key]!, String(value)]);
}

/** All but the last 4 characters as dots. */
export const mask = (value: string) => (value.length <= 4 ? '••••' : `${'•'.repeat(Math.min(12, value.length - 4))}${value.slice(-4)}`);

const styles = StyleSheet.create({
  masked: { fontFamily: inter.bold, fontSize: 18, letterSpacing: 2 },
  code: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, padding: 12, gap: 6 },
  value: { fontFamily: inter.extrabold, fontSize: 18, letterSpacing: 1 },
});
