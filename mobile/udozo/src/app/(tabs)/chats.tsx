import { postedAgo, type ShopConversation, type ShopConversations } from '@shared/classifieds';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountPending } from '@/components/account-pending';
import { pagedListProps, usePagedList } from '@/components/paged-list';
import { SignedOut } from '@/components/signed-out';
import { inter, ThemedText } from '@/components/themed-text';
import { Chip, Empty, Failed, Loading } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { photoUrl } from '@/lib/navigate';

type Role = 'all' | 'buying' | 'selling';

/** The customer's chats, newest first, Buying and Selling apart, older ones as they scroll; read again every 15 seconds while open. */
export default function ChatsScreen() {
  const theme = useTheme();
  const { customer } = useAccount();
  const [role, setRole] = useState<Role>('all');
  const paged = usePagedList<ShopConversation, ShopConversations>({
    queryKey: ['chats', 'list', role],
    enabled: Boolean(customer),
    path: `/v1/classifieds/conversations${role === 'all' ? '' : `?role=${role}`}`,
    paging: 'offset',
    refetchInterval: 15_000,
  });
  const chats = paged.list;
  if (customer === undefined) return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <AccountPending />
    </SafeAreaView>
  );
  if (customer === null) return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <SignedOut title="Chats" body="Sign in to chat with buyers and sellers. Your number stays private." />
    </SafeAreaView>
  );
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={styles.head}>
        <ThemedText type="subtitle" accessibilityRole="header">
          Chats
        </ThemedText>
        <View style={styles.tabs}>
          {(['all', 'buying', 'selling'] as Role[]).map(item => (
            <Chip key={item} label={item === 'all' ? 'All' : item === 'buying' ? 'Buying' : 'Selling'} selected={role === item} onPress={() => setRole(item)} />
          ))}
        </View>
      </View>
      <FlatList
        data={paged.items}
        keyExtractor={chat => chat.id}
        {...pagedListProps(paged, theme.primary)}
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.line, marginLeft: 80 }} />}
        renderItem={({ item }) => {
          const last = item.last_message;
          const preview = !last ? '' : last.kind === 'photo' ? 'Photo' : last.kind === 'offer' ? 'Offer' : last.body;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.with.name}, about ${item.listing.title ?? 'a listing'}${item.unread ? `, ${item.unread} unread` : ''}`}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
              style={styles.row}>
              <View style={[styles.cover, { backgroundColor: theme.backgroundElement }]}>
                {item.listing.cover_url ? <Image source={{ uri: photoUrl(item.listing.cover_url, 480)! }} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors /> : null}
                {item.with.online ? <View style={[styles.online, { backgroundColor: theme.success, borderColor: theme.background }]} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.line}>
                  <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
                    {item.with.name}
                  </ThemedText>
                  <ThemedText type="caption">{postedAgo(item.last_message_at)}</ThemedText>
                </View>
                <ThemedText type="caption" numberOfLines={1}>
                  {item.listing.title}
                </ThemedText>
                <View style={styles.line}>
                  <ThemedText type="small" numberOfLines={1} style={[{ flex: 1 }, item.unread ? { fontFamily: inter.semibold } : null]}>
                    {last?.from === 'me' ? `You: ${preview}` : preview}
                  </ThemedText>
                  {item.unread ? (
                    <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                      <ThemedText type="caption" style={{ color: theme.onPrimary, fontFamily: inter.bold }}>
                        {item.unread}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          chats.isPending ? <Loading /> : chats.isError ? <Failed error={chats.error} retry={() => void chats.refetch()} /> : <Empty title="No chats yet" body="Find something you like and chat with its seller." />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, gap: Spacing.two },
  tabs: { flexDirection: 'row', gap: Spacing.two, paddingBottom: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, minHeight: 72 },
  cover: { width: 52, height: 52, borderRadius: Radius.medium, overflow: 'visible' },
  online: { position: 'absolute', right: -3, bottom: -3, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
});
