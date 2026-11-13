import { conditionLabels, sortLabels, type ShopCondition, type ShopSort, type ShopSuggestions } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { MapPin, Search, Sparkles, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListingResults } from '@/components/listing-results';
import { inter, ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useShopAssistant } from '@/lib/assistant';
import { useMarket } from '@/lib/market';

const sorts: ShopSort[] = ['relevant', 'newest', 'price_asc', 'price_desc'];
const conditions: ShopCondition[] = ['new', 'used', 'untested', 'parts'];

/**
 * Search: the words (with suggestions as they are typed), how to sort, the condition, then the market's listings two to
 * a row; Ask (where the market's assistant answers) asks Anjio what was typed. A link may carry the words, a category,
 * a place (a listing's area and state, local first: `area`, `state`, its name `place`) or another market (`/search?country=&q=&category=`).
 */
export default function SearchScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ q?: string; category?: string; country?: string; area?: string; state?: string; place?: string }>();
  const market = useMarket();
  const country = (params.country ?? market.country ?? '').toUpperCase();
  const [typed, setTyped] = useState(params.q ?? '');
  const [q, setQ] = useState(params.q ?? '');
  const [sort, setSort] = useState<ShopSort>('relevant');
  const [condition, setCondition] = useState<ShopCondition[]>([]);
  const [focused, setFocused] = useState(false);
  const assistant = useShopAssistant(country);

  // A link with other words (a suggestion, a notice) starts that search.
  const [given, setGiven] = useState(params.q);
  if (params.q !== given) {
    setGiven(params.q);
    setTyped(params.q ?? '');
    setQ(params.q ?? '');
  }

  const suggest = useQuery({
    queryKey: ['suggest', country, typed],
    enabled: focused && typed.trim().length >= 2 && Boolean(country),
    queryFn: () => api<ShopSuggestions>(`/v1/classifieds/search/suggest?country=${country}&q=${encodeURIComponent(typed.trim())}`),
  });

  const area = params.area || undefined;
  const state = params.state || undefined;
  const search = useMemo(() => (country ? { country, q: q || undefined, category: params.category, area, state, sort, condition } : null), [country, q, params.category, area, state, sort, condition]);
  const submit = (words = typed) => {
    setQ(words.trim());
    setTyped(words);
    setFocused(false);
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[styles.bar, { borderColor: theme.line, backgroundColor: theme.backgroundElement }]}>
        <Search size={18} color={theme.textSecondary} />
        <TextInput
          value={typed}
          onChangeText={setTyped}
          onFocus={() => setFocused(true)}
          onSubmitEditing={() => submit()}
          returnKeyType="search"
          placeholder="Search Udozo"
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Search Udozo"
          autoCorrect={false}
          style={[styles.input, { color: theme.text }]}
        />
        {typed ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear" hitSlop={10} onPress={() => submit('')}>
            <X size={18} color={theme.textSecondary} />
          </Pressable>
        ) : null}
        {assistant?.assistant ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ask ${assistant.assistant.name}`}
            hitSlop={10}
            onPress={() => router.push({ pathname: '/assistant', params: { country, ...(typed.trim() ? { question: typed.trim() } : {}) } })}
            style={styles.ask}>
            <Sparkles size={16} color={theme.primary} />
            <ThemedText type="smallBold" style={{ color: theme.primary }}>Ask</ThemedText>
          </Pressable>
        ) : null}
      </View>
      {focused && suggest.data && (suggest.data.queries.length || suggest.data.categories.length) ? (
        <View style={[styles.suggestions, { borderColor: theme.line }]}>
          {suggest.data.categories.slice(0, 4).map(category => (
            <Pressable
              key={category.slug}
              accessibilityRole="link"
              onPress={() => {
                setFocused(false);
                router.push({ pathname: '/category/[slug]', params: { slug: category.slug, country } });
              }}
              style={styles.suggestion}>
              <ThemedText>
                {category.name}
                <ThemedText type="caption"> in {category.parent?.name ?? 'Categories'}</ThemedText>
              </ThemedText>
            </Pressable>
          ))}
          {suggest.data.queries.slice(0, 5).map(words => (
            <Pressable key={words} accessibilityRole="button" onPress={() => submit(words)} style={styles.suggestion}>
              <ThemedText>{words}</ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}
      <ListingResults
        params={search}
        header={
          <View style={{ gap: Spacing.two, paddingVertical: Spacing.two }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {sorts.map(item => (
                <Chip key={item} label={sortLabels[item]} selected={sort === item} onPress={() => setSort(item)} />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {conditions.map(item => (
                <Chip
                  key={item}
                  label={conditionLabels[item]}
                  selected={condition.includes(item)}
                  onPress={() => setCondition(current => (current.includes(item) ? current.filter(value => value !== item) : [...current, item]))}
                />
              ))}
            </ScrollView>
            {area || state ? (
              <View style={styles.place}>
                <MapPin size={16} color={theme.textSecondary} />
                <ThemedText type="smallBold" style={{ flex: 1 }}>{`Near ${params.place || area || state}`}</ThemedText>
                <Pressable accessibilityRole="button" accessibilityLabel="Search everywhere" hitSlop={10} onPress={() => router.setParams({ area: '', state: '', place: '' })}>
                  <X size={18} color={theme.textSecondary} />
                </Pressable>
              </View>
            ) : null}
            {q ? <ThemedText type="small" themeColor="textSecondary" style={{ fontFamily: inter.semibold }}>{`Results for “${q}”`}</ThemedText> : null}
          </View>
        }
        empty={{ title: q ? `Nothing for “${q}” yet` : 'Nothing here yet', body: 'Try fewer words, or another condition.' }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: { margin: Spacing.three, minHeight: 48, borderWidth: 1, borderRadius: Radius.medium, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three },
  input: { flex: 1, fontFamily: inter.regular, fontSize: 16, minHeight: 44 },
  suggestions: { marginHorizontal: Spacing.three, borderWidth: 1, borderRadius: Radius.medium, marginBottom: Spacing.two },
  suggestion: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three },
  chips: { gap: Spacing.two },
  place: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 36 },
  ask: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
});
