import { useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';

const gap = Spacing.three;

/**
 * Cards side by side, swiped left and right a card at a time: each about 85% of the screen's width, so the next one
 * peeks in from the edge, with a dot per card below (each a button to its card). The first card shows by default;
 * nothing slides for reduced motion. `edge` is the page's own side padding, which the row runs into.
 */
export function SellCarousel({ cards, labels, edge = Spacing.three }: { cards: ReactNode[]; labels: string[]; edge?: number }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const cardWidth = Math.round(Math.min(width, MaxContentWidth) * 0.85);
  const step = cardWidth + gap;
  const row = useRef<ScrollViewInstance>(null);
  const [page, setPage] = useState(0);
  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.max(0, Math.min(cards.length - 1, Math.round(event.nativeEvent.contentOffset.x / step))));
  const go = (index: number) => {
    setPage(index);
    row.current?.scrollTo({ x: index * step, animated: !reduced });
  };

  return (
    <View style={{ gap: Spacing.two }}>
      <ScrollView
        ref={row}
        testID="sell-carousel"
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
        style={{ marginHorizontal: -edge }}
        contentContainerStyle={{ paddingHorizontal: edge, gap }}>
        {cards.map((card, index) => (
          <View key={labels[index] ?? index} style={{ width: cardWidth }}>
            {card}
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {cards.map((_, index) => (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityLabel={`${labels[index]}, ${index + 1} of ${cards.length}`}
            accessibilityState={{ selected: index === page }}
            hitSlop={14}
            onPress={() => go(index)}
            style={styles.dotTap}>
            <View style={[styles.dot, { backgroundColor: index === page ? theme.primary : theme.line, width: index === page ? 18 : 8 }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.one },
  dotTap: { minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  dot: { height: 8, borderRadius: 4 },
});
