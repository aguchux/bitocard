// Home's rows on a phone: one row of category tiles (the first the page has), never a second of listing photos.
import { screen } from '@testing-library/react-native';

import { HomeRows } from '@/components/home-blocks';

import { answers, renderScreen } from './helpers';

const tiles = (names: string[]) => names.map(name => ({ slug: name.toLowerCase(), name, listings: 3, image: null, href: `/ng/c/${name.toLowerCase()}` }));
const row = (id: string, blocks: unknown[]) => ({ id, hidden: false, title: 'Shop by category', subtitle: '', viewAll: null, view_all_href: null, background: 'none', image: null, width: 'contained', spacing: 'normal', blocks });

test('a second row of category tiles is left out, the first kept', async () => {
  const rows = [
    row('r1', [{ id: 'c1', type: 'category_spotlights', hidden: false, title: '', data: { tiles: tiles(['Electronics', 'Vehicles']) } }]),
    row('r2', [{ id: 'c2', type: 'category_masonry', hidden: false, title: '', data: { tiles: tiles(['Hospital and medical']) } }]),
  ];
  answers({ 'GET /v1/theme': { colors: null } });
  await renderScreen(<HomeRows rows={rows as never} />);
  expect(screen.getAllByText('Shop by category')).toHaveLength(1);
  expect(screen.getByText('Electronics')).toBeTruthy();
  expect(screen.queryByText('Hospital and medical')).toBeNull();
});
