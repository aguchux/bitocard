import type { ShopListingPage } from '@shared/classifieds';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Play, X } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { photoUrl } from '@/lib/navigate';

/** The gallery's size: 4:3 across the width, never taller than 60% of the screen, so the price and contact row show too. */
export function gallerySize(width: number, height: number) {
  const across = Math.min(width, MaxContentWidth);
  return { width: across, height: Math.round(Math.min(across * 0.75, height * 0.6)) };
}

/**
 * The listing's photos, swiped sideways with dots and a counter; a tap opens them full screen (swiped, and pinched on
 * iPhones). Then its video, where it has one ready, opened in the in-app browser.
 */
export function Gallery({ photos, video, title }: { photos: ShopListingPage['photos']; video: ShopListingPage['video']; title: string }) {
  const theme = useTheme();
  const window = useWindowDimensions();
  const size = gallerySize(window.width, window.height);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <View style={{ alignSelf: 'center', width: size.width }}>
      {photos.length ? (
        <View style={{ height: size.height }}>
          <FlatList
            horizontal
            pagingEnabled
            data={photos}
            keyExtractor={(photo, position) => `${photo.url}-${position}`}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={event => setIndex(Math.round(event.nativeEvent.contentOffset.x / size.width))}
            style={{ width: size.width, height: size.height, flexGrow: 0 }}
            renderItem={({ item, index: position }) => (
              <Pressable accessibilityRole="imagebutton" accessibilityLabel={`${title}, photo ${position + 1} of ${photos.length}. Open full screen`} onPress={() => setOpen(position)}>
                <Image source={{ uri: photoUrl(item.url, 960)! }} style={{ width: size.width, height: size.height, backgroundColor: theme.backgroundElement }} contentFit="cover" />
              </Pressable>
            )}
          />
          {photos.length > 1 && photos.length <= 10 ? (
            <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {photos.map((photo, position) => (
                <View key={`${photo.url}-${position}`} style={[styles.dot, { backgroundColor: position === index ? '#fff' : 'rgba(255,255,255,0.5)' }]} />
              ))}
            </View>
          ) : null}
          <View style={styles.counter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <ThemedText type="caption" style={{ color: '#fff' }}>{`${index + 1} / ${photos.length}`}</ThemedText>
          </View>
        </View>
      ) : (
        <View style={{ width: size.width, height: size.height, backgroundColor: theme.backgroundElement }} accessibilityLabel="No photos" />
      )}
      {video ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Watch the video"
          onPress={() => WebBrowser.openBrowserAsync(video.url).catch(() => undefined)}
          style={[styles.video, { borderColor: theme.line }]}>
          <View style={[styles.poster, { backgroundColor: theme.backgroundElement }]}>
            {video.poster_url ? <Image source={{ uri: video.poster_url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
            <Play size={20} color={theme.primary} />
          </View>
          <ThemedText type="smallBold" style={{ flex: 1 }}>
            {video.duration_ms ? `Watch the video (${clock(video.duration_ms)})` : 'Watch the video'}
          </ThemedText>
        </Pressable>
      ) : null}
      <PhotoViewer photos={photos} title={title} start={open} onClose={() => setOpen(null)} />
    </View>
  );
}

const clock = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** The photos full screen on black: swiped page by page, each pinched to zoom where the phone's scroll view allows it. */
function PhotoViewer({ photos, title, start, onClose }: { photos: ShopListingPage['photos']; title: string; start: number | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [opened, setOpened] = useState<number | null>(null);
  if (start !== opened) {
    setOpened(start);
    if (start !== null) setIndex(start);
  }
  return (
    <Modal visible={start !== null} animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
        <FlatList
          horizontal
          pagingEnabled
          data={photos}
          initialScrollIndex={start ?? 0}
          getItemLayout={(_, position) => ({ length: width, offset: width * position, index: position })}
          keyExtractor={(photo, position) => `${photo.url}-${position}`}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={event => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
          renderItem={({ item, index: position }) => (
            <ScrollView style={{ width, height }} contentContainerStyle={styles.page} maximumZoomScale={3} minimumZoomScale={1} centerContent showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
              <Image source={{ uri: photoUrl(item.url, 1600)! }} style={{ width, height: height * 0.8 }} contentFit="contain" accessibilityLabel={`${title}, photo ${position + 1} of ${photos.length}`} />
            </ScrollView>
          )}
        />
        <View style={styles.viewerBar}>
          <ThemedText style={{ color: '#fff' }}>{`${index + 1} / ${photos.length}`}</ThemedText>
          <Pressable accessibilityRole="button" accessibilityLabel="Close photos" hitSlop={12} onPress={onClose} style={styles.close}>
            <X size={24} color="#fff" />
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  counter: { position: 'absolute', right: Spacing.three, bottom: Spacing.three, backgroundColor: 'rgba(16,33,46,0.7)', borderRadius: Radius.round, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  dots: { position: 'absolute', left: 0, right: 0, bottom: Spacing.three, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  video: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, margin: Spacing.three, marginBottom: 0, padding: Spacing.two, borderWidth: 1, borderRadius: Radius.medium },
  poster: { width: 64, height: 48, borderRadius: Radius.small, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  page: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  viewerBar: { position: 'absolute', top: Spacing.five, left: Spacing.three, right: Spacing.three, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
