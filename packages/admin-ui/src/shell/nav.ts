import { AlertTriangle, Bell, BellRing, PlugZap, Plug, Percent, BadgePercent, Boxes, Building2, ChartNoAxesColumn, Clock, Globe2, History, House, Image, Images, LayoutGrid, Shapes, ListChecks, Package, ReceiptText, Settings, ShieldCheck, ToggleRight, Truck, Users, type LucideIcon } from 'lucide-react';

export type SectionKey = 'home' | 'orders' | 'catalog' | 'resellers' | 'verifications' | 'activity' | 'storefront' | 'settings';

export type NavItem<K extends string = SectionKey> = { key: K; label: string; href: string; icon: LucideIcon };

/** The left rail, in order. */
export const sections: NavItem[] = [
  { key: 'home', label: 'Home', href: '/', icon: House },
  { key: 'orders', label: 'Orders', href: '/orders', icon: ReceiptText },
  { key: 'catalog', label: 'Catalog', href: '/catalog', icon: Boxes },
  { key: 'resellers', label: 'Resellers', href: '/resellers', icon: Users },
  { key: 'verifications', label: 'Identity', href: '/verifications', icon: ShieldCheck },
  { key: 'activity', label: 'Activity', href: '/activity', icon: History },
  { key: 'storefront', label: 'Storefront', href: '/storefront', icon: LayoutGrid },
  { key: 'settings', label: 'Settings', href: '/settings', icon: Settings },
];

export type SubNavItem = { label: string; href: string; icon?: LucideIcon; count?: number };

/** Each section's menu (the second column). */
export const menus: Record<SectionKey, { title: string; items: SubNavItem[] }> = {
  home: {
    title: 'Dashboard',
    items: [
      { label: 'Overview', href: '/', icon: ChartNoAxesColumn },
      { label: 'Notifications', href: '/notifications', icon: Bell },
      { label: 'Activity log', href: '/activity', icon: History },
    ],
  },
  orders: {
    title: 'Orders',
    items: [
      { label: 'All orders', href: '/orders', icon: ReceiptText },
      { label: 'Exception queue', href: '/orders/review', icon: AlertTriangle },
      { label: 'Processing', href: '/orders/processing', icon: Clock },
      { label: 'Supplier notifications', href: '/orders/notifications', icon: BellRing },
    ],
  },
  catalog: {
    title: 'Catalog',
    items: [
      { label: 'Products', href: '/catalog', icon: Package },
      { label: 'Suppliers', href: '/catalog/suppliers', icon: Truck },
      { label: 'Pricing rules', href: '/catalog/pricing', icon: BadgePercent },
    ],
  },
  resellers: {
    title: 'Resellers',
    items: [
      { label: 'All resellers', href: '/resellers', icon: Building2 },
      { label: 'Identity checks', href: '/verifications', icon: ShieldCheck },
      { label: 'Own integrations', href: '/resellers/connections', icon: Plug },
    ],
  },
  verifications: {
    title: 'Identity',
    items: [
      { label: 'Needs review', href: '/verifications', icon: ListChecks },
      { label: 'All checks', href: '/verifications/all', icon: ShieldCheck },
    ],
  },
  activity: { title: 'Activity', items: [{ label: 'Activity log', href: '/activity', icon: History }] },
  storefront: {
    title: 'Storefront',
    items: [
      { label: 'Home page', href: '/storefront', icon: LayoutGrid },
      { label: 'Brands', href: '/storefront/brands', icon: Image },
      { label: 'Categories', href: '/storefront/categories', icon: Shapes },
      { label: 'Media library', href: '/storefront/media', icon: Images },
    ],
  },
  settings: {
    title: 'Settings',
    items: [
      { label: 'Feature switches', href: '/settings', icon: ToggleRight },
      { label: 'Markets', href: '/settings/markets', icon: Globe2 },
      { label: 'Integrations', href: '/settings/integrations', icon: PlugZap },
      { label: 'Platform fees', href: '/settings/fees', icon: Percent },
    ],
  },
};
