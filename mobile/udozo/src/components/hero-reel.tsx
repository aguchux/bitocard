import { Image } from 'expo-image';
import { useEffect, useMemo, useRef } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, useWindowDimensions, View } from 'react-native';

import { inter, ThemedText } from '@/components/themed-text';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { collageOf, columnWidth, filledSlides, reelAdvance, reelSettle, type ShownSlide, type ShownTile } from '@/lib/hero';
import { openLink, photoUrl } from '@/lib/navigate';

/** The gap between columns and between a column's banners, as udozo.com's 6 px. */
const gap = 6;
/** How long the reel stands on a column before moving on, and how long it waits after a touch before going on. */
const stepMs = 4000;
const resumeMs = 2000;

/**
 * udozo.com's hero reel at the top of Home (`HeroReel` there): columns three rows high, each one banner, a third over
 * two thirds (either way up) or three thirds, 6 points apart with small rounded corners. A banner without an image
 * shows photos of what it links to under its words; Ad only where it is marked an ad. It moves on a column at a time
 * by itself, stops while a finger is on it and goes on two seconds after, and never moves by itself for reduced motion.
 * It loops through repeated copies of its columns, hidden from screen readers.
 */
export function HeroReel({ slides, height }: { slides: ShownSlide[]; height: number }) {
  const { width: screen } = useWindowDimensions();
  const width = columnWidth(screen);
  const step = width + gap;
  const columns = useMemo(() => filledSlides(slides), [slides]);
  const count = slides.length;
  const reduced = useReducedMotion();
  const scroller = useRef<ScrollViewInstance>(null);
  const at = useRef(0);
  const held = useRef(false);
  const resume = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reduced || count === 0) return;
    const timer = setInterval(() => {
      if (held.current) return;
      const next = reelAdvance(at.current, count);
      if (next.jump !== null) scroller.current?.scrollTo({ x: next.jump * step, animated: false });
      scroller.current?.scrollTo({ x: next.to * step, animated: true });
      at.current = next.to;
    }, stepMs);
    return () => clearInterval(timer);
  }, [reduced, count, step]);
  useEffect(() => () => void (resume.current && clearTimeout(resume.current)), []);

  const hold = () => {
    held.current = true;
    if (resume.current) clearTimeout(resume.current);
  };
  const letGo = () => {
    if (resume.current) clearTimeout(resume.current);
    resume.current = setTimeout(() => (held.current = false), resumeMs);
  };
  const settled = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / step);
    const home = reelSettle(index, count);
    if (home !== index) scroller.current?.scrollTo({ x: home * step, animated: false });
    at.current = home;
    letGo();
  };

  return (
    <ScrollView
      ref={scroller}
      horizontal
      testID="hero-reel"
      accessibilityLabel="Featured on Udozo"
      showsHorizontalScrollIndicator={false}
      snapToInterval={step}
      decelerationRate="fast"
      onTouchStart={hold}
      onScrollBeginDrag={hold}
      onTouchEnd={letGo}
      onMomentumScrollEnd={settled}
      contentContainerStyle={styles.reel}>
      {columns.map(({ slide, repeat }) => {
        const hidden = repeat > 0;
        return (
          <View
            key={`${slide.id}-${repeat}`}
            testID={hidden ? undefined : `hero-slide-${slide.id}`}
            accessibilityElementsHidden={hidden}
            importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
            style={[styles.column, { width, height }]}>
            {slide.tiles.map(tile => (
              <Tile key={tile.id} tile={tile} hidden={hidden} />
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

function Tile({ tile, hidden }: { tile: ShownTile; hidden: boolean }) {
  const collage = tile.image_url ? null : collageOf(tile.photos, tile.rows);
  const ad = tile.ad ? (
    <View style={[styles.ad, collage ? styles.adTop : styles.adBottom]}>
      <ThemedText style={styles.adText}>Ad</ThemedText>
    </View>
  ) : null;
  const picture = collage ? (
    <>
      <View style={styles.collage}>
        {Array.from({ length: collage.rows }, (_, row) => (
          <View key={row} style={styles.collageRow}>
            {collage.photos.slice(row * collage.columns, (row + 1) * collage.columns).map((src, index) => (
              <Image key={`${src}-${index}`} source={{ uri: photoUrl(src, 480)! }} style={styles.collagePhoto} contentFit="cover" accessibilityIgnoresInvertColors />
            ))}
          </View>
        ))}
      </View>
      <View style={styles.words} pointerEvents="none">
        <ThemedText type="smallBold" numberOfLines={2} style={{ color: '#fff' }}>
          {tile.alt}
        </ThemedText>
      </View>
      {ad}
    </>
  ) : (
    <>
      <Image source={{ uri: tile.image_url! }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
      {ad}
    </>
  );
  const label = tile.ad ? `${tile.alt}, ad` : tile.alt;
  const box = [styles.tile, { flex: tile.rows }];
  if (!tile.href) {
    return (
      <View style={box} accessible={!hidden} accessibilityRole="image" accessibilityLabel={label}>
        {picture}
      </View>
    );
  }
  const href = tile.href;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={() => openLink(href)} style={({ pressed }) => [box, pressed && { opacity: 0.85 }]}>
      {picture}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  reel: { gap, paddingHorizontal: gap },
  column: { gap },
  tile: {
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#dfe7ed',
    minHeight: 0,
  },
  collage: { flex: 1, gap: 1, backgroundColor: '#fff' },
  collageRow: { flex: 1, flexDirection: 'row', gap: 1 },
  collagePhoto: { flex: 1, height: '100%' },
  words: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 24,
    paddingBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  ad: {
    position: 'absolute',
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  adTop: { top: 6 },
  adBottom: { bottom: 6 },
  adText: {
    color: '#fff',
    fontSize: 11,
    lineHeight: 13,
    fontFamily: inter.bold,
  },
});
