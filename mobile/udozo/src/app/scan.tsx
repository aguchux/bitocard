import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Loading, Page } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { scannedPayToken } from '@/lib/money';

/**
 * Scan to pay at a shop: the camera reads a Udozo POS till's QR code and opens its payment (`/pay/<token>`). Anything
 * else is said to be not Udozo's, and never opened. The camera is asked for here, with why.
 */
export default function ScanScreen() {
  const [permission, ask] = useCameraPermissions();
  const [wrong, setWrong] = useState(false);
  const handled = useRef(false);
  if (!permission) return <Loading />;
  if (!permission.granted) {
    return (
      <Page edges={[]}>
        <ThemedText>Udozo uses the camera to read the shop’s code, so you can pay from your wallet.</ThemedText>
        {permission.canAskAgain ? <Button title="Allow the camera" onPress={() => void ask()} /> : <Button title="Open the phone’s settings" onPress={() => void Linking.openSettings()} />}
      </Page>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          const token = scannedPayToken(data);
          if (!token) return setWrong(true);
          handled.current = true;
          router.replace({ pathname: '/pay/[token]', params: { token } });
        }}
      />
      <View style={styles.caption}>
        <ThemedText style={{ color: '#fff', textAlign: 'center' }} accessibilityLiveRegion="polite">
          {wrong ? 'That code is not a Udozo payment. Point at the code on the shop’s till.' : 'Point at the code on the shop’s till.'}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { position: 'absolute', left: Spacing.three, right: Spacing.three, bottom: Spacing.six, padding: Spacing.three, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)' },
});
