import type { HomeCard, ResolvedHomeRow, ResolvedHomeSection } from '@shared/home';
import { Image } from 'expo-image';
import { ChevronRight, LayoutGrid } from 'lucide-react-native';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ListingRail } from '@/components/listing-rail';
import { inter, ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openLink, photoUrl } from '@/lib/navigate';

/**
 * The market's home page as udozo.com draws it (`GET /v1/classifieds/home`), on a phone: each row's heading and See all,
 * then its blocks one under another. Listing blocks slide sideways (by hand: nothing moves by itself), categories are
 * tiles, banners and grids open what they link to through the app's own screens. Blocks a phone has no place for yet
 * (stores, countries, the trust bar, For you) are left out. While the hero reel shows above them (`withoutHero`), the page's own
 * hero is left out too, as udozo.com does.
 */
export function HomeRows({ rows, withoutHero }: { rows: ResolvedHomeRow[]; withoutHero?: boolean }) {
  // One row of category tiles on a phone: the first the page has (its spotlights), never a second of listing photos.
  const firstCategories = rows.flatMap(row => (row.hidden ? [] : row.blocks)).find(block => categoryBlocks.has(block.type) && shown(block))?.id;
  const visible = (block: ResolvedHomeSection) =>
    shown(block) && !(withoutHero && block.type === 'home_hero') && !(categoryBlocks.has(block.type) && block.id !== firstCategories);
  return (
    <View style={{ gap: Spacing.four }}>
      {rows
        .filter(row => !row.hidden && row.blocks.some(visible))
        .map(row => (
          <View key={row.id} style={{ gap: Spacing.two }}>
            {row.title ? <Heading title={row.title} href={row.view_all_href} /> : null}
            {row.blocks.filter(visible).map(block => (
              <Block key={block.id} block={block} titled={!row.title} rowHref={row.view_all_href} rowTitle={row.title} />
            ))}
          </View>
        ))}
    </View>
  );
}

const categoryBlocks = new Set(['category_masonry', 'category_spotlights']);
const listingBlocks = new Set(['deals_rail', 'sponsored_rail', 'top_selling_rail', 'listing_group', 'listing_marquee']);
const shown = (block: ResolvedHomeSection) => {
  if (block.hidden) return false;
  if (listingBlocks.has(block.type)) return ((block.data as { items: HomeCard[] }).items ?? []).length > 0;
  if (block.type === 'category_masonry' || block.type === 'category_spotlights' || block.type === 'masonry_grid') return (block.data as { tiles: unknown[] }).tiles.length > 0;
  if (block.type === 'banner') return block.data.items.length > 0;
  if (block.type === 'category_banner') return Boolean(block.data.category);
  if (block.type === 'home_hero') return block.style === 'carousel' && block.data.slides.length > 0;
  return false;
};

function Heading({ title, href }: { title: string; href?: string | null }) {
  return (
    <View style={styles.heading}>
      <ThemedText type="heading" accessibilityRole="header" style={{ flex: 1 }}>
        {title}
      </ThemedText>
      {href ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`See all ${title}`} onPress={() => openLink(href)} hitSlop={8} style={styles.seeAll}>
          <ThemedText type="link">See all</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function Block({ block, titled, rowHref, rowTitle }: { block: ResolvedHomeSection; titled: boolean; rowHref?: string | null; rowTitle?: string | null }) {
  const title = 'title' in block && typeof block.title === 'string' && titled ? block.title : null;
  switch (block.type) {
    case 'deals_rail':
    case 'sponsored_rail':
    case 'top_selling_rail':
    case 'listing_group':
    case 'listing_marquee': {
      const data = block.data as { items: HomeCard[]; view_all_href?: string | null; heading?: string };
      const heading = title ? (block.type === 'top_selling_rail' ? (data.heading ?? title) : title) : null;
      // The rail's last card opens where its heading's See all does: the block's own, else its row's.
      const more = data.view_all_href ?? rowHref ?? null;
      return (
        <View style={{ gap: Spacing.two }}>
          {heading ? <Heading title={heading} href={data.view_all_href} /> : null}
          <ListingRail items={data.items} testID={`rail-${block.id}`} seeAll={more ? { label: heading ?? rowTitle ?? 'listings', onPress: () => openLink(more) } : undefined} />
        </View>
      );
    }
    case 'category_masonry':
    case 'category_spotlights': {
      const tiles = block.data.tiles as { slug: string; name: string; listings: number; image: string | null; href: string }[];
      return (
        <View style={{ gap: Spacing.two }}>
          {title ? <Heading title={title} href={'view_all_href' in block.data ? block.data.view_all_href : null} /> : null}
          <FlatList horizontal data={tiles} keyExtractor={tile => tile.slug} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail} renderItem={({ item }) => <CategoryTile tile={item} />} />
        </View>
      );
    }
    case 'masonry_grid':
      return (
        <View style={{ gap: Spacing.two }}>
          {title ? <Heading title={title} /> : null}
          <View style={styles.grid}>
            {block.data.tiles.map((cell, index) => (
              <PhotoTile key={`${cell.href}-${index}`} title={cell.title} image={cell.image ?? cell.listing?.cover?.url ?? null} href={cell.href} />
            ))}
          </View>
        </View>
      );
    case 'banner':
      return (
        <View style={styles.side}>
          {block.data.items.map((item, index) => (
            <Banner key={index} title={item.title} body={item.body} image={item.image} href={item.href} />
          ))}
        </View>
      );
    case 'category_banner': {
      const category = block.data.category!;
      return (
        <View style={styles.side}>
          <Banner title={block.data.title || block.title || category.name} body={block.body || `${category.listings.toLocaleString('en-GB')} for sale`} image={block.data.image ?? block.image} href={block.data.href ?? `/`} />
        </View>
      );
    }
    case 'home_hero':
      return (
        <FlatList
          horizontal
          pagingEnabled
          data={block.data.slides}
          keyExtractor={(slide, index) => `${slide.image}-${index}`}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => <Banner title={item.title} body={item.subtitle} image={item.image} href={item.href} wide />}
        />
      );
    default:
      return null;
  }
}

function CategoryTile({ tile }: { tile: { name: string; listings: number; image: string | null; href: string } }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${tile.name}, ${tile.listings} for sale`} onPress={() => openLink(tile.href)} style={styles.category}>
      <View style={[styles.categoryImage, { backgroundColor: theme.backgroundElement }]}>
        {tile.image ? <Image source={{ uri: tile.image }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityIgnoresInvertColors /> : <LayoutGrid color={theme.primary} size={28} />}
      </View>
      <ThemedText type="smallBold" numberOfLines={2} style={styles.centre}>
        {tile.name}
      </ThemedText>
    </Pressable>
  );
}

function PhotoTile({ title, image, href }: { title: string; image: string | null; href: string }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={title} onPress={() => openLink(href)} style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
      {image ? <Image source={{ uri: photoUrl(image, 480)! }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
      <View style={styles.tileLabel}>
        <ThemedText type="smallBold" numberOfLines={2} style={{ color: '#fff' }}>
          {title}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function Banner({ title, body, image, href, wide }: { title: string; body?: string; image: string | null; href: string; wide?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={[title, body].filter(Boolean).join('. ')} onPress={() => openLink(href)} style={[styles.banner, wide && styles.wide, { backgroundColor: theme.primary }]}>
      {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
      <View style={styles.bannerText}>
        <ThemedText style={{ color: '#fff', fontFamily: inter.extrabold, fontSize: 18 }} numberOfLines={2}>
          {title}
        </ThemedText>
        {body ? (
          <ThemedText type="small" style={{ color: '#fff' }} numberOfLines={2}>
            {body}
          </ThemedText>
        ) : null}
      </View>
      <ChevronRight color="#fff" size={20} style={styles.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, gap: Spacing.two },
  seeAll: { minHeight: 44, justifyContent: 'center' },
  rail: { paddingHorizontal: Spacing.three, gap: Spacing.three, alignItems: 'flex-start' },
  side: { paddingHorizontal: Spacing.three, gap: Spacing.three },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, paddingHorizontal: Spacing.three },
  category: { width: 88, alignItems: 'center', gap: Spacing.one },
  categoryImage: { width: 72, height: 72, borderRadius: 36, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  centre: { textAlign: 'center' },
  tile: { width: '47%', aspectRatio: 1, borderRadius: Radius.medium, overflow: 'hidden', justifyContent: 'flex-end' },
  tileLabel: { padding: Spacing.two, backgroundColor: 'rgba(16,33,46,0.55)' },
  banner: { minHeight: 120, borderRadius: Radius.medium, overflow: 'hidden', justifyContent: 'flex-end' },
  wide: { width: 340, marginLeft: Spacing.three },
  bannerText: { padding: Spacing.three, gap: 2, backgroundColor: 'rgba(16,33,46,0.45)', paddingRight: Spacing.five },
  chevron: { position: 'absolute', right: Spacing.three, bottom: Spacing.three },
});
