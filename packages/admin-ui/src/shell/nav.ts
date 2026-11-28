import { AlertTriangle, Banknote, Landmark, Gift, Inbox, LifeBuoy, MessagesSquare, Cpu, Bot, ShieldEllipsis, Bell, CreditCard, MessageSquareWarning, BellRing, PlugZap, Plug, Percent, BadgePercent, Boxes, Building2, ChartNoAxesColumn, Clock, Globe2, History, House, KeyRound, Image, Images, BookImage, LayoutGrid, Shapes, ListChecks, Package, ReceiptText, Settings, ShieldCheck, ScanFace, Smartphone, ToggleRight, TrendingUp, Truck, Users, Wallet, type LucideIcon } from 'lucide-react';
import type { AdminRole } from '@bitocard/api-client/admin';

export type SectionKey = 'home' | 'orders' | 'catalog' | 'resellers' | 'verifications' | 'activity' | 'storefront' | 'reports' | 'support' | 'settings';

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
  { key: 'reports', label: 'Reports', href: '/reports', icon: TrendingUp },
  { key: 'support', label: 'Support', href: '/support', icon: LifeBuoy },
  { key: 'settings', label: 'Settings', href: '/settings', icon: Settings },
];

export type SubNavItem = { label: string; href: string; icon?: LucideIcon; count?: number; /** Empty means super admins only. */ roles?: AdminRole[] };

const everyone: AdminRole[] = ['operations', 'finance', 'support'];
const operators: AdminRole[] = ['operations'];
const operationsSupport: AdminRole[] = ['operations', 'support'];
const operationsFinance: AdminRole[] = ['operations', 'finance'];

/** Each section's menu (the second column). */
export const menus: Record<SectionKey, { title: string; items: SubNavItem[] }> = {
  support: {
    title: 'Support',
    items: [
      { label: 'Tickets', href: '/support', icon: Inbox, roles: operationsSupport },
      { label: 'Chats', href: '/support/chats', icon: MessagesSquare, roles: operationsSupport },
      { label: 'Assistants', href: '/support/assistants', icon: Bot, roles: operationsSupport },
      { label: 'AI usage', href: '/support/ai', icon: Cpu, roles: operationsSupport },
    ],
  },
  home: {
    title: 'Dashboard',
    items: [
      { label: 'Overview', href: '/', icon: ChartNoAxesColumn, roles: everyone },
      { label: 'Notifications', href: '/notifications', icon: Bell, roles: everyone },
      { label: 'Activity log', href: '/activity', icon: History, roles: everyone },
    ],
  },
  orders: {
    title: 'Orders',
    items: [
      { label: 'All orders', href: '/orders', icon: ReceiptText, roles: everyone },
      { label: 'Exception queue', href: '/orders/review', icon: AlertTriangle, roles: operationsSupport },
      { label: 'Processing', href: '/orders/processing', icon: Clock, roles: everyone },
      { label: 'Supplier notifications', href: '/orders/notifications', icon: BellRing, roles: operators },
      { label: 'Disputes', href: '/orders/disputes', icon: MessageSquareWarning, roles: everyone },
      { label: 'Chargebacks', href: '/orders/chargebacks', icon: CreditCard, roles: ['finance'] },
      { label: 'Fundings', href: '/orders/fundings', icon: Wallet, roles: everyone },
      { label: 'Static accounts', href: '/orders/reserved-accounts', icon: Landmark, roles: everyone },
      { label: 'VPN access', href: '/orders/vpn', icon: ShieldEllipsis, roles: everyone },
      { label: 'Airtime exchange', href: '/orders/airtime', icon: Smartphone, roles: operationsFinance },
      { label: 'Bank deposits', href: '/orders/bank-deposits', icon: Banknote, roles: everyone },
    ],
  },
  catalog: {
    title: 'Catalog',
    items: [
      { label: 'Products', href: '/catalog', icon: Package, roles: operationsFinance },
      { label: 'Stock', href: '/catalog/stock', icon: KeyRound, roles: operationsFinance },
      { label: 'Brands', href: '/catalog/brands', icon: Image, roles: operators },
      { label: 'Suppliers', href: '/catalog/suppliers', icon: Truck, roles: operationsFinance },
      { label: 'Pricing rules', href: '/catalog/pricing', icon: BadgePercent, roles: operationsFinance },
    ],
  },
  resellers: {
    title: 'Resellers',
    items: [
      { label: 'All resellers', href: '/resellers', icon: Building2, roles: everyone },
      { label: 'Identity checks', href: '/verifications', icon: ShieldCheck, roles: operationsSupport },
      { label: 'Own integrations', href: '/resellers/connections', icon: Plug, roles: operationsSupport },
      { label: 'Domains', href: '/resellers/domains', icon: Globe2, roles: operationsSupport },
    ],
  },
  verifications: {
    title: 'Identity',
    items: [
      { label: 'Needs review', href: '/verifications', icon: ListChecks, roles: operationsSupport },
      { label: 'All checks', href: '/verifications/all', icon: ShieldCheck, roles: operationsSupport },
      { label: 'BitoCard Verify', href: '/verifications/verify', icon: ScanFace, roles: operationsSupport },
    ],
  },
  activity: { title: 'Activity', items: [{ label: 'Activity log', href: '/activity', icon: History, roles: everyone }] },
  storefront: {
    title: 'Storefront',
    items: [
      { label: 'Home page', href: '/storefront', icon: LayoutGrid, roles: operationsSupport },
      { label: 'Brand registry', href: '/storefront/registry', icon: BookImage, roles: operationsSupport },
      { label: 'Categories', href: '/storefront/categories', icon: Shapes, roles: operationsSupport },
      { label: 'Media library', href: '/storefront/media', icon: Images, roles: operators },
      { label: 'Customers', href: '/storefront/customers', icon: Users, roles: everyone },
      { label: 'Spin and win', href: '/storefront/spins', icon: Gift, roles: operators },
      { label: 'Settings', href: '/storefront/settings', icon: Settings, roles: operationsSupport },
    ],
  },
  reports: {
    title: 'Reports',
    items: [
      { label: 'P&L', href: '/reports', icon: ChartNoAxesColumn, roles: operationsFinance },
      { label: 'Growth', href: '/reports/growth', icon: TrendingUp, roles: operationsFinance },
      { label: 'Supplier funding', href: '/reports/suppliers', icon: Wallet, roles: operationsFinance },
      { label: 'Statements', href: '/reports/statements', icon: ReceiptText, roles: ['finance'] },
    ],
  },
  settings: {
    title: 'Settings',
    items: [
      { label: 'Feature switches', href: '/settings', icon: ToggleRight, roles: operators },
      { label: 'Team', href: '/settings/team', icon: Users, roles: [] },
      { label: 'Markets', href: '/settings/markets', icon: Globe2, roles: operators },
      { label: 'Integrations', href: '/settings/integrations', icon: PlugZap, roles: operators },
      { label: 'pawaPay coverage', href: '/settings/pawapay', icon: Smartphone, roles: operators },
      { label: 'Platform fees', href: '/settings/fees', icon: Percent, roles: operationsFinance },
    ],
  },
};
