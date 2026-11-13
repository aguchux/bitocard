import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { BottomTabBarHeightCallbackContext } from 'expo-router/js-tabs';
import { CircleUser, House, MessageCircle, Plus, Search } from 'lucide-react-native';
import { useContext, useEffect, useState, type ComponentType } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';

import { inter, ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type Icon = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

const icons: Record<string, Icon> = { index: House, search: Search, chats: MessageCircle, me: CircleUser };

/** The Sell circle's size and how far it rises above the bar's top edge. */
export const SellCircle = { size: 60, raise: 18 } as const;

/** Whether the keyboard is up; only Android hides the bar for it (the iPhone keyboard covers the bar anyway). */
function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const up = Keyboard.addListener('keyboardDidShow', () => setShown(true));
    const down = Keyboard.addListener('keyboardDidHide', () => setShown(false));
    return () => {
      up.remove();
      down.remove();
    };
  }, []);
  return shown;
}

/**
 * The app's bottom bar (docs/UDOZO_MOBILE_APP_PLAN.md): Home, Search, Chats and Me as icons with their labels, and Sell
 * in the middle as a raised circle in the theme's colour with a white plus, as marketplaces draw it. Drawn in
 * JavaScript, since the phones' own tab bars cannot draw a button of their own; it tells the navigator its height so
 * screens can sit above it (`useBottomTabBarHeight`), keeps clear of the phone's gesture bar and steps aside for the
 * keyboard on Android.
 */
export function UdozoTabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const theme = useTheme();
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);
  const keyboard = useKeyboardShown();
  if (keyboard) return null;

  return (
    <View
      testID="tab-bar"
      role="tablist"
      onLayout={event => reportHeight?.(event.nativeEvent.layout.height)}
      style={[styles.bar, { backgroundColor: theme.background, borderTopColor: theme.line, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
      {state.routes.map((route, index) => {
        const focused = index === state.index;
        const options = descriptors[route.key]?.options ?? {};
        const label = typeof options.title === 'string' ? options.title : route.name;
        const badge = options.tabBarBadge;
        const press = () => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };
        const longPress = () => emitter.emit({ type: 'tabLongPress', target: route.key });
        const color = focused ? theme.primary : theme.textSecondary;

        if (route.name === 'sell') {
          return (
            <Pressable
              key={route.key}
              testID="tab-sell"
              role="tab"
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: focused }}
              onPress={press}
              onLongPress={longPress}
              hitSlop={{ top: SellCircle.raise }}
              style={styles.item}>
              {({ pressed }) => (
                <>
                  <View style={[styles.circle, { backgroundColor: theme.primary, borderColor: theme.background, opacity: pressed ? 0.85 : 1 }]}>
                    <Plus size={30} color={theme.onPrimary} strokeWidth={2.75} />
                  </View>
                  <ThemedText style={[styles.label, { color, fontFamily: focused ? inter.bold : inter.semibold }]} numberOfLines={1}>
                    {label}
                  </ThemedText>
                </>
              )}
            </Pressable>
          );
        }

        const TabIcon = icons[route.name] ?? House;
        return (
          <Pressable
            key={route.key}
            testID={`tab-${route.name}`}
            role="tab"
            accessibilityRole="tab"
            accessibilityLabel={badge ? `${label}, ${badge} new` : label}
            accessibilityState={{ selected: focused }}
            onPress={press}
            onLongPress={longPress}
            style={({ pressed }) => [styles.item, { opacity: pressed ? 0.7 : 1 }]}>
            <View style={[styles.pill, focused && { backgroundColor: theme.backgroundElement }]}>
              <TabIcon size={24} color={color} strokeWidth={focused ? 2.5 : 2} />
              {badge !== undefined && badge !== '' ? (
                <View style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.background }]}>
                  <ThemedText style={styles.badgeText}>{String(badge)}</ThemedText>
                </View>
              ) : null}
            </View>
            <ThemedText style={[styles.label, { color, fontFamily: focused ? inter.bold : inter.semibold }]} numberOfLines={1}>
              {label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, overflow: 'visible' },
  item: { flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'flex-end', paddingTop: 6, paddingBottom: 8, gap: 2 },
  pill: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  circle: {
    width: SellCircle.size,
    height: SellCircle.size,
    borderRadius: SellCircle.size / 2,
    borderWidth: 4,
    marginTop: -SellCircle.raise - 6,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#10212e',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  label: { fontSize: 12, lineHeight: 16 },
  badge: { position: 'absolute', top: -4, right: 6, minWidth: 18, height: 18, borderRadius: 9, borderWidth: 2, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontSize: 10, lineHeight: 12, fontFamily: inter.bold },
});
