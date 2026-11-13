import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { HelpCircle, LogIn, Megaphone, MessageCircle, Search, ShieldCheck, Sparkles, Tag, UserPlus, X } from 'lucide-react-native';
import { type ReactNode, useMemo, useState } from 'react';
import { Animated, Linking, Modal, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { inter, ThemedText } from '@/components/themed-text';
import { WhatsappMark } from '@/components/whatsapp-mark';
import { Radius, Spacing } from '@/constants/theme';
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

/** How far a finger drags the sheet down before it closes. */
const closePull = 90;

/**
 * udozo.com's WhatsApp tab on Home, where Udozo is on WhatsApp in the market (`GET /v1/classifieds/channels?country=`):
 * WhatsApp's own mark in the header, beside the bell, pulling up a sheet: Start a chat with Udozo, Sign up or Sign in with WhatsApp (signed out) or Connect
 * your WhatsApp (signed in), what Udozo does there, each opening the chat with its word, and the safety note. The sheet
 * closes on a drag down, the backdrop, its close button or Back; nothing slides for reduced motion.
 */
export function WhatsappButton({ country }: { country: string | null }) {
  const theme = useTheme();
  const { customer } = useAccount();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const channels = useQuery({
    queryKey: ['channels', country],
    enabled: Boolean(country),
    staleTime: 5 * 60_000,
    queryFn: () => api<Channels>(`/v1/classifieds/channels?country=${country}`),
  });
  const number = channels.data?.whatsapp.available ? channels.data.whatsapp.number : null;

  // The sheet follows a finger down, then closes.
  const [drop] = useState(() => new Animated.Value(0));
  const { sheetPan, close } = useMemo(() => {
    const settle = (value: Animated.Value) => (reduced ? value.setValue(0) : Animated.spring(value, { toValue: 0, useNativeDriver: true }).start());
    const vertical = (move: { dx: number; dy: number }) => Math.abs(move.dy) > 6 && Math.abs(move.dy) > Math.abs(move.dx);
    const shut = () => {
      setOpen(false);
      drop.setValue(0);
    };
    return {
      close: shut,
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
  }, [reduced, drop]);

  if (!number) return null;
  const go = (path: Parameters<typeof router.push>[0]) => {
    close();
    router.push(path);
  };
  const chat = (text: string) => {
    const href = text === 'Hi' ? startChatHref(number) : whatsappHref(number, text);
    if (href) Linking.openURL(href).catch(() => undefined);
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Udozo on WhatsApp"
        accessibilityHint="Opens what you can do with Udozo on WhatsApp"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.button, { opacity: pressed ? 0.7 : 1 }]}>
        <WhatsappMark size={24} color={whatsappGreen} />
      </Pressable>

      <Modal visible={open} transparent animationType={reduced ? 'none' : 'slide'} onRequestClose={close} statusBarTranslucent>
        <Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel="Close" onPress={close} />
        <Animated.View testID="whatsapp-sheet" accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.background, transform: [{ translateY: drop }] }]}>
          <View {...sheetPan.panHandlers} style={[styles.sheetHead, { backgroundColor: whatsappGreen }]}>
            <View style={[styles.grabber, styles.sheetGrabber]} />
            <View style={styles.headRow}>
              <View style={styles.badge}>
                <WhatsappMark size={22} color={deepGreen} />
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
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 28, height: 4, borderRadius: 2, backgroundColor: 'rgba(6,54,28,0.35)' },
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
