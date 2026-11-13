import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { pagedListProps, usePagedList } from '@/components/paged-list';
import { ThemedText } from '@/components/themed-text';
import { Button, Chip, Empty, Failed, Loading } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { wantedWhen, type WantedForYou, type WantedList, type WantedRequest } from '@/lib/wanted';

/**
 * Wanted requests (udozo.com's /account/wanted): the requests the reader made, each with how long it has and how many
 * sellers answered, and requests sent to them as a seller who may have it; more load as they scroll. Post a request at
 * the top.
 */
export default function WantedScreen() {
  const theme = useTheme();
  const [tab, setTab] = useState<'mine' | 'for-you'>('mine');
  const paged = usePagedList<WantedRequest | WantedForYou, WantedList<WantedRequest | WantedForYou>>({
    queryKey: ['wanted', 'list', tab],
    path: tab === 'mine' ? '/v1/classifieds/me/wanted' : '/v1/classifieds/me/wanted-for-you',
    paging: 'offset',
  });
  const list = paged.list;
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={styles.chips}>
        <Chip label="Requests I made" selected={tab === 'mine'} onPress={() => setTab('mine')} />
        <Chip label="Requests for you" selected={tab === 'for-you'} onPress={() => setTab('for-you')} />
      </View>
      {list.isPending ? (
        <Loading />
      ) : list.isLoadingError ? (
        <Failed error={list.error} retry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={paged.items}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
          {...pagedListProps(paged, theme.primary)}
          ListHeaderComponent={tab === 'mine' ? <Button title="Post a request" onPress={() => router.push('/wanted/new')} style={{ marginBottom: Spacing.two }} /> : undefined}
          ListEmptyComponent={
            <Empty
              title={tab === 'mine' ? 'No requests yet' : 'No requests for you yet'}
              body={tab === 'mine' ? 'Can’t find something? Post a request and sellers who have it answer in your chats.' : 'When a buyer asks for something you sell, it shows here for you to answer with a listing.'}
            />
          }
          renderItem={({ item }) => {
            const answered = 'answered' in item ? item.answered : null;
            const detail = [item.number, wantedWhen(item), item.place, item.budget.text].filter(Boolean).join(' · ');
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.words}, ${detail}`}
                onPress={() => router.push({ pathname: '/wanted/[id]', params: { id: item.id } })}
                style={({ pressed }) => [styles.row, { borderColor: theme.line, opacity: pressed ? 0.85 : 1 }]}>
                <ThemedText type="smallBold" numberOfLines={2}>
                  {item.words}
                </ThemedText>
                <ThemedText type="caption">{detail}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {answered === null
                    ? item.responses
                      ? `${item.responses} answer${item.responses === 1 ? '' : 's'} from sellers`
                      : 'No answers yet'
                    : answered
                      ? 'You answered'
                      : `${item.buyer} is looking for this`}
                </ThemedText>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  row: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, gap: 2 },
});
