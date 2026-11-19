import { Image, StyleSheet, View } from 'react-native';

import { inter, T } from '@/components/ui';
import type { StoreBrand } from '@/lib/types';

/** A brand's logo on a white tile over its colour, or its initials on its colour when there is no logo. */
export function BrandTile({ brand, logo, size = 44 }: { brand: StoreBrand; logo?: string | null; size?: number }) {
  const color = brand.color ?? '#070f4c';
  const url = logo ?? brand.logo_url;
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.28, backgroundColor: color }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {url ? (
        <View style={[styles.inner, { borderRadius: size * 0.2 }]}>
          <Image source={{ uri: url }} style={{ width: size * 0.62, height: size * 0.62 }} resizeMode="contain" />
        </View>
      ) : (
        <T color="#ffffff" style={{ fontFamily: inter.extrabold, fontSize: size * 0.34 }}>
          {brand.initials}
        </T>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  inner: { backgroundColor: '#ffffff', width: '84%', height: '84%', alignItems: 'center', justifyContent: 'center' },
});
