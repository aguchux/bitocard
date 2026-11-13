// Home's rows on a phone: one row of category tiles (the first the page has), never a second of listing photos; banners in
// one sliding row, with auctions where the market has them.
import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

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

const banners = (id: string, items: { title: string; href: string; image?: string | null }[]) => ({
  id,
  type: 'banner',
  hidden: false,
  title: '',
  data: { items: items.map(item => ({ title: item.title, body: 'Find out more', image: item.image ?? null, tone: 'brand', link: { kind: 'page', path: item.href }, href: item.href })) },
});
const cta = [
  { title: 'Sell what you no longer use', href: '/sell' },
  { title: 'Pay safely with UdozoPay', href: '/legal/udozopay' },
];

test('banners slide in one row with a dot each, auctions last where the market has them, opening its auctions', async () => {
  answers({ 'GET /v1/theme': { colors: null } });
  await renderScreen(<HomeRows rows={[{ ...row('r1', [banners('b1', cta)]), title: '' }] as never} auctions="NG" />);
  expect(screen.getByTestId('banners-b1')).toBeTruthy();
  expect(screen.getByLabelText('Sell what you no longer use, 1 of 3')).toBeTruthy();
  expect(screen.getByLabelText('Bid on auctions, 3 of 3')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Bid on auctions. Win items at the price you choose.'));
  expect(router.push).toHaveBeenCalledWith('/search?country=NG&sale=auction');
});

test('without auctions in the market the row holds only the page’s own banners, and one banner alone does not slide', async () => {
  answers({ 'GET /v1/theme': { colors: null } });
  await renderScreen(<HomeRows rows={[{ ...row('r1', [banners('b1', cta), banners('b2', [{ title: 'Only one', href: '/ng/c/phones' }])]), title: '' }] as never} auctions={null} />);
  expect(screen.queryByText('Bid on auctions')).toBeNull();
  expect(screen.getByLabelText('Pay safely with UdozoPay, 2 of 2')).toBeTruthy();
  expect(screen.queryByTestId('banners-b2')).toBeNull();
  expect(screen.getByText('Only one')).toBeTruthy();
});
