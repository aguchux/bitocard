/**
 * Udozo POS's role matrix (docs/UDOZO_POS_PLAN.md, milestone 5; the design's Settings > Staff and roles): what each
 * role may do at the POS, as data, mirrored by pos.udozo.com only to hide controls (the API decides).
 *
 * The owner may do everything, through their Udozo account. Four roles are fixed (Manager, Cashier, Stock keeper,
 * Accountant) and the owner may make their own. Whatever the role, staff never reach the owner's Udozo account: plan and
 * billing, shops, collection accounts and the settlement account, listings, the wallet and payouts stay the owner's.
 */

/** Each thing a role may do. `yes`, `approval` (with a manager's PIN at the till) or `no`; `staff` is `no` or `cashiers`. */
export const posPermissions = [
  'sell',
  'refund',
  'till',
  'stock_view',
  'stock_adjust',
  'prices',
  'own_sales',
  'all_sales',
  'cash_up',
  'export',
  'customers',
  'transfers',
  'staff',
  'settings',
] as const;
export type PosPermission = (typeof posPermissions)[number];
export type PermissionLevel = 'yes' | 'approval' | 'no' | 'cashiers';
export type PermissionSet = Record<PosPermission, PermissionLevel>;

/** The permissions that may take `approval`, and the one (`staff`) that takes `cashiers`; the rest are yes or no. */
export const approvable: readonly PosPermission[] = ['refund', 'stock_adjust'];

/** How each permission reads in the matrix, grouped as the design shows them. */
export const permissionGroups: Array<{ group: string; items: Array<{ key: PosPermission; label: string }> }> = [
  {
    group: 'Selling',
    items: [
      { key: 'sell', label: 'Make sales and take payments' },
      { key: 'refund', label: 'Refund or void a sale' },
      { key: 'till', label: 'Open and close a till' },
      { key: 'customers', label: "Add the shop's customers and take what they owe" },
    ],
  },
  {
    group: 'Stock',
    items: [
      { key: 'stock_view', label: 'View stock levels' },
      { key: 'stock_adjust', label: 'Receive deliveries and adjust stock' },
      { key: 'prices', label: 'Change prices in the shop' },
    ],
  },
  {
    group: 'Reports and money',
    items: [
      { key: 'own_sales', label: 'See own sales' },
      { key: 'all_sales', label: 'See all sales and reports' },
      { key: 'cash_up', label: 'End-of-day totals and cash-up' },
      { key: 'export', label: 'Export for bookkeeping (CSV, PDF)' },
      { key: 'transfers', label: 'Match transfers that came in to their sales' },
    ],
  },
  {
    group: 'Admin',
    items: [
      { key: 'staff', label: 'Invite staff and assign roles' },
      { key: 'settings', label: 'Change POS settings (shop details, tills, devices)' },
    ],
  },
];

const none: PermissionSet = Object.fromEntries(posPermissions.map(key => [key, 'no'])) as PermissionSet;
const allowing = (...keys: PosPermission[]) => ({ ...none, ...Object.fromEntries(keys.map(key => [key, 'yes'])) }) as PermissionSet;

export type SystemRoleKey = 'manager' | 'cashier' | 'stock_keeper' | 'accountant';

/** A role as the API works with it: a fixed one (`key`) or the owner's own (`id`). */
export type ResolvedRole = { key: SystemRoleKey | null; id: string | null; name: string; description: string | null; permissions: PermissionSet; discountLimitBps: number | null; system: boolean };

/** The four fixed roles, as the design's matrix has them. */
export const systemRoles: Record<SystemRoleKey, Omit<ResolvedRole, 'id'>> = {
  manager: {
    key: 'manager',
    name: 'Manager',
    description: 'Everything in the shop, including refunds, reports and inviting cashiers.',
    permissions: { ...allowing('sell', 'refund', 'till', 'stock_view', 'stock_adjust', 'prices', 'own_sales', 'all_sales', 'cash_up', 'customers', 'transfers', 'settings'), staff: 'cashiers' },
    discountLimitBps: null,
    system: true,
  },
  cashier: {
    key: 'cashier',
    name: 'Cashier',
    description: 'Sells, takes payments and prints receipts. Small discounts only.',
    permissions: { ...allowing('sell', 'till', 'stock_view', 'own_sales', 'customers'), refund: 'approval' },
    discountLimitBps: 500,
    system: true,
  },
  stock_keeper: {
    key: 'stock_keeper',
    name: 'Stock keeper',
    description: 'Receives deliveries and updates stock. Cannot sell.',
    permissions: allowing('stock_view', 'stock_adjust', 'own_sales'),
    discountLimitBps: 0,
    system: true,
  },
  accountant: {
    key: 'accountant',
    name: 'Accountant',
    description: 'Sees all sales, end-of-day totals and exports. Cannot sell or change stock.',
    permissions: allowing('stock_view', 'all_sales', 'cash_up', 'export'),
    discountLimitBps: 0,
    system: true,
  },
};
export const systemRoleKeys = Object.keys(systemRoles) as SystemRoleKey[];

/** A role's permissions from what was stored or sent: anything unknown or out of place is `no`. */
export function permissionSet(raw: unknown): PermissionSet {
  const given = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const set = { ...none };
  for (const key of posPermissions) {
    const value = given[key];
    if (value === 'yes') set[key] = 'yes';
    else if (value === 'approval' && approvable.includes(key)) set[key] = 'approval';
    else if (value === 'cashiers' && key === 'staff') set[key] = 'cashiers';
  }
  return set;
}

/**
 * Why a role's permissions cannot be saved as sent, or null. Custom roles never manage staff beyond cashiers (staff
 * and roles stay the owner's, as for a manager).
 */
export function permissionsProblem(raw: unknown): { message: string; param: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { message: 'Give each permission as yes, approval or no.', param: 'permissions' };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(posPermissions as readonly string[]).includes(key)) return { message: `There is no permission called ${key}.`, param: `permissions.${key}` };
    const ok = value === 'yes' || value === 'no' || (value === 'approval' && approvable.includes(key as PosPermission)) || (value === 'cashiers' && key === 'staff');
    if (!ok) return { message: key === 'staff' ? 'Staff is no, or cashiers (invite and manage cashiers only).' : approvable.includes(key as PosPermission) ? `${key} is yes, approval or no.` : `${key} is yes or no.`, param: `permissions.${key}` };
    if (key === 'staff' && value === 'yes') return { message: 'Only the owner manages every member of staff: give cashiers instead.', param: 'permissions.staff' };
  }
  return null;
}

/** What a role may do with a permission. */
export const levelOf = (role: Pick<ResolvedRole, 'permissions'>, permission: PosPermission): PermissionLevel => role.permissions[permission] ?? 'no';

/** Whether a role's limit covers a discount: `limit` null is any amount. */
export const discountCovered = (limit: number | null, discountBps: number) => limit === null || discountBps <= limit;

/** A discount as a share of the subtotal, in basis points, rounded up (so 5.01% is over a 5% limit). */
export function discountBps(discount: bigint, subtotal: bigint) {
  if (discount <= 0n) return 0;
  if (subtotal <= 0n) return 10_000;
  return Number((discount * 10_000n + subtotal - 1n) / subtotal);
}

/**
 * Whether a role may invite and manage someone with `target` role: only the owner does it for every role; a role with
 * `staff: cashiers` (a manager) only for the fixed Cashier.
 */
export const managesRole = (role: Pick<ResolvedRole, 'permissions'>, target: { key: string | null }) => levelOf(role, 'staff') === 'cashiers' && target.key === 'cashier';

/** A short line of what a role allows, for the invite page ("Make sales and take payments; …"). */
export function allowedLines(role: Pick<ResolvedRole, 'permissions' | 'discountLimitBps'>) {
  const lines: string[] = [];
  for (const group of permissionGroups) {
    for (const item of group.items) {
      const level = levelOf(role, item.key);
      if (level === 'yes') lines.push(item.label);
      else if (level === 'approval') lines.push(`${item.label}, with a manager's approval`);
      else if (level === 'cashiers') lines.push('Invite and manage cashiers');
    }
  }
  if (levelOf(role, 'sell') === 'yes') {
    const limit = role.discountLimitBps;
    lines.splice(1, 0, limit === null ? 'Give any discount' : limit > 0 ? `Give discounts up to ${limit / 100}%` : 'No discounts without a manager');
  }
  return lines;
}

/** A staff PIN: 6 digits. */
export const pinDigits = 6;
export const pinPattern = /^\d{6}$/;
/** What sign-in and a manager's approval accept: 6 digits, or 4 for a PIN set before PINs were 6 digits. */
export const signInPinPattern = /^(?:\d{4}|\d{6})$/;

/**
 * Easy PINs a shop's staff may not choose: one or two digits only, a run up or down (123456, 654321), the same three
 * twice (123123) or two digits three times (121212).
 */
export function weakPin(pin: string) {
  if (!pinPattern.test(pin)) return true;
  if (new Set(pin).size <= 2) return true;
  const digits = [...pin].map(Number);
  const up = digits.every((digit, index) => index === 0 || digit === (digits[index - 1]! + 1) % 10);
  const down = digits.every((digit, index) => index === 0 || digit === (digits[index - 1]! + 9) % 10);
  if (up || down) return true;
  if (pin.slice(0, 3) === pin.slice(3)) return true;
  if (pin.slice(0, 2) === pin.slice(2, 4) && pin.slice(2, 4) === pin.slice(4)) return true;
  return false;
}
