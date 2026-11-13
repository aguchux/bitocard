// Cards on a rail keep their own size: a fixed width, no flex, the row lined up at the top. With flex (the grid's), a
// sideways list stretched each card down past the bottom of the screen.
import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { HomeRows } from '@/components/home-blocks';
import { ListingCard } from '@/components/listing-card';
import { railCardWidth } from '@/components/listing-rail';

import { renderScreen } from './helpers';

const card = (id: string, title: string) => ({
  object: 'classified_listing_card' as const,
  id,
  ref: Number(id),
  title,
  slug: 'item',
  country: 'NG',
  url: `https://udozo.com/ng/l/${id}-item`,
  price: { kind: 'fixed' as const, amount: 1000000, currency: 'NGN' },
  condition: 'used' as const,
  category: null,
  area: { slug: 'ikeja', name: 'Ikeja', state: { slug: 'lagos', name: 'Lagos' } },
  cover: null,
  photo_count: 0,
  has_video: false,
  highlights: [],
  delivery: 'none' as const,
  seller: { name: 'Ada O.', badges: [] },
  published_at: null,
});

const rows = [
  {
    id: 'row-1',
    title: 'Trending',
    view_all_href: null,
    blocks: [{ id: 'block-1', type: 'listing_group', hidden: false, title: 'Trending', data: { items: [card('1', 'Short'), card('2', 'A much longer title that wraps onto a second line')] } }],
  },
];

test('a home rail gives each card its width and no flex, and lines the row up at the top', async () => {
  await renderScreen(<HomeRows rows={rows as never} />);
  for (const name of [/^Short/, /^A much longer/]) {
    const style = StyleSheet.flatten(screen.getByLabelText(name).props.style);
    expect(style.width).toBe(railCardWidth);
    expect(style.flex).toBeUndefined();
  }
  const list = screen.getByTestId('rail-block-1');
  expect(StyleSheet.flatten(list.props.contentContainerStyle ?? list.children[0]?.props?.style).alignItems).toBe('flex-start');
});

test('only a grid lets a card fill its column', async () => {
  await renderScreen(<ListingCard listing={card('3', 'In a grid')} fill />);
  const style = StyleSheet.flatten(screen.getByLabelText(/^In a grid/).props.style);
  expect(style.flex).toBe(1);
  expect(style.width).toBeUndefined();
});
