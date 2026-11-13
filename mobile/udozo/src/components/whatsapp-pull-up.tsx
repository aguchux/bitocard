import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ChevronUp, HelpCircle, LogIn, Megaphone, MessageCircle, Search, ShieldCheck, Sparkles, Tag, UserPlus, X } from 'lucide-react-native';
import { type ReactNode, useMemo, useState } from 'react';
import { Animated, Linking, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { inter, ThemedText } from '@/components/themed-text';
import { BottomTabInset, Radius, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { type Channels, startChatHref, whatsappFeatures, whatsappGreen, whatsappHref, whatsappSafety } from '@/lib/whatsapp';

/** WhatsApp's darker greens, for words and icons on white and on its own green. */
const deepGreen = '#128C7E';
const onGreen = '#06361c';

const featureIcons: Record<(typeof whatsappFeatures)[number]['icon'], (color: string) => ReactNode> = {
  find: color => <Search size={20} color={color} />,
  sell: color => <Tag size={20} color={color} />,
  want: color => <Megaphone size={20} color={color} />,
  chats: color => <MessageCircle size={20} color={color} />,
  assistant: color => <Sparkles size={20} color={color} />,
  help: color => <HelpCircle size={20} color={color} />,
};

/** How far a finger drags the handle up, or the sheet down, before it opens or closes. */
const openPull = 24;
const closePull = 90;

/**
 * udozo.com's WhatsApp tab as a pull-up on Home, where Udozo is on WhatsApp in the market
 * (`GET /v1/classifieds/channels?country=`): a small WhatsApp-green handle on the right, just above the tab bar,
 * dragged up (or tapped) into a sheet: Start a chat with Udozo, Sign up or Sign in with WhatsApp (signed out) or Connect
 * your WhatsApp (signed in), what Udozo does there, each opening the chat with its word, and the safety note. The sheet
 * closes on a drag down, the backdrop, its close button or Back; nothing slides for reduced motion.
 */
export function WhatsappPullUp({ country }: { country: string | null }) {
  const theme = useTheme();
  const { customer } = useAccount();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const channels = useQuery({
    queryKey: ['channels', country],
    enabled: Boolean(country),
    staleTime: 5 * 60_000,
    queryFn: () => api<Channels>(`/v1/classifieds/channels?country=${country}`),
  });
  const number = channels.data?.whatsapp.available ? channels.data.whatsapp.number : null;

  // The handle follows the finger up a little, then opens; the sheet follows it down, then closes.
  const [lift] = useState(() => new Animated.Value(0));
  const [drop] = useState(() => new Animated.Value(0));
  const { handlePan, sheetPan, close } = useMemo(() => {
    const settle = (value: Animated.Value) => (reduced ? value.setValue(0) : Animated.spring(value, { toValue: 0, useNativeDriver: true }).start());
    const vertical = (move: { dx: number; dy: number }) => Math.abs(move.dy) > 6 && Math.abs(move.dy) > Math.abs(move.dx);
    const shut = () => {
      setOpen(false);
      drop.setValue(0);
    };
    return {
      close: shut,
      handlePan: PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, move) => vertical(move),
        onPanResponderMove: (_, move) => lift.setValue(Math.max(-40, Math.min(0, move.dy))),
        onPanResponderRelease: (_, move) => {
          settle(lift);
          if (move.dy < -openPull || move.vy < -0.8) setOpen(true);
        },
        onPanResponderTerminate: () => settle(lift),
      }),
      sheetPan: PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, move) => vertical(move) && move.dy > 0,
        onPanResponderMove: (_, move) => drop.setValue(Math.max(0, move.dy)),
        onPanResponderRelease: (_, move) => {
          if (move.dy > closePull || move.vy > 1) shut();
          else settle(drop);
        },
        onPanResponderTerminate: () => settle(drop),
      }),
    };
  }, [reduced, lift, drop]);

  if (!number) return null;
  const go = (path: Parameters<typeof router.push>[0]) => {
    close();
    router.push(path);
  };
  const chat = (text: string) => {
    const href = text === 'Hi' ? startChatHref(number) : whatsappHref(number, text);
    if (href) Linking.openURL(href).catch(() => undefined);
  };
  // Above the tab bar: Android lays Home out above it; on iPhones the bar floats over the screen's foot.
  const bottom = Spacing.three + (Platform.OS === 'ios' ? BottomTabInset + insets.bottom : 0);

  return (
    <>
      <Animated.View {...handlePan.panHandlers} style={[styles.handleWrap, { bottom, transform: [{ translateY: lift }] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Udozo on WhatsApp"
          accessibilityHint="Opens what you can do with Udozo on WhatsApp"
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.handle, { backgroundColor: whatsappGreen, opacity: pressed ? 0.85 : 1 }]}>
          <View style={styles.grabber} />
          <View style={styles.handleRow}>
            <MessageCircle size={18} color={onGreen} />
            <ThemedText style={styles.handleText}>WhatsApp</ThemedText>
            <ChevronUp size={16} color={onGreen} />
          </View>
        </Pressable>
      </Animated.View>

      <Modal visible={open} transparent animationType={reduced ? 'none' : 'slide'} onRequestClose={close} statusBarTranslucent>
        <Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel="Close" onPress={close} />
        <Animated.View testID="whatsapp-sheet" accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.background, transform: [{ translateY: drop }] }]}>
          <View {...sheetPan.panHandlers} style={[styles.sheetHead, { backgroundColor: whatsappGreen }]}>
            <View style={[styles.grabber, styles.sheetGrabber]} />
            <View style={styles.headRow}>
              <View style={styles.badge}>
                <MessageCircle size={22} color={deepGreen} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText accessibilityRole="header" style={styles.title}>
                  Udozo on WhatsApp
                </ThemedText>
                <ThemedText type="small" style={{ color: onGreen }}>
                  Find, sell and chat without the app.
                </ThemedText>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} hitSlop={8} style={styles.close}>
                <X size={20} color={onGreen} />
              </Pressable>
            </View>
          </View>
          <SafeAreaView edges={['bottom']} style={{ flexShrink: 1 }}>
            <ScrollView contentContainerStyle={styles.body}>
              <Row icon={<MessageCircle size={20} color={deepGreen} />} title="Start a chat with Udozo" onPress={() => chat('Hi')} />
              {customer ? (
                <Row icon={<MessageCircle size={20} color={deepGreen} />} title="Connect your WhatsApp" onPress={() => go('/whatsapp')} />
              ) : (
                <>
                  <Row icon={<UserPlus size={20} color={deepGreen} />} title="Sign up with WhatsApp" onPress={() => go({ pathname: '/signup', params: { method: 'whatsapp' } })} />
                  <Row icon={<LogIn size={20} color={deepGreen} />} title="Sign in with WhatsApp" onPress={() => go({ pathname: '/signin', params: { method: 'whatsapp' } })} />
                </>
              )}
              <View style={[styles.section, { borderColor: theme.line }]}>
                <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
                  WHAT YOU CAN DO THERE
                </ThemedText>
                {whatsappFeatures.map(feature => (
                  <Row key={feature.title} icon={featureIcons[feature.icon](deepGreen)} title={feature.title} word={feature.word} detail={feature.detail} onPress={() => chat(feature.word)} />
                ))}
              </View>
              <View style={[styles.safety, { backgroundColor: theme.backgroundElement }]}>
                <ShieldCheck size={18} color={deepGreen} />
                <ThemedText type="small" style={{ flex: 1 }}>
                  {whatsappSafety}
                </ThemedText>
              </View>
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </Modal>
    </>
  );
}

function Row({ icon, title, word, detail, onPress }: { icon: ReactNode; title: string; word?: string; detail?: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={word ? `${title}, sends ${word}` : title} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundElement }]}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.rowTitle}>
          <ThemedText type="smallBold">{title}</ThemedText>
          {word ? (
            <View style={[styles.word, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="caption">{word}</ThemedText>
            </View>
          ) : null}
        </View>
        {detail ? (
          <ThemedText type="small" themeColor="textSecondary">
            {detail}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  handleWrap: { position: 'absolute', right: 0 },
  handle: { minHeight: 48, paddingLeft: Spacing.three, paddingRight: Spacing.two, paddingTop: 4, paddingBottom: Spacing.two, borderTopLeftRadius: Radius.medium, borderBottomLeftRadius: Radius.medium, alignItems: 'center', gap: 4, elevation: 4, shadowColor: '#06361c', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: -2, height: 3 } },
  grabber: { width: 28, height: 4, borderRadius: 2, backgroundColor: 'rgba(6,54,28,0.35)' },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  handleText: { color: onGreen, fontFamily: inter.bold, fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { maxHeight: '85%', borderTopLeftRadius: Radius.large, borderTopRightRadius: Radius.large, overflow: 'hidden' },
  sheetHead: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.three, gap: Spacing.two },
  sheetGrabber: { alignSelf: 'center', width: 40 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  badge: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  title: { color: onGreen, fontFamily: inter.extrabold, fontSize: 18 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { padding: Spacing.two, gap: Spacing.one },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Radius.medium },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  word: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: Spacing.two, paddingTop: Spacing.two },
  sectionTitle: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.one, letterSpacing: 0.5 },
  safety: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.medium, margin: Spacing.two },
});
