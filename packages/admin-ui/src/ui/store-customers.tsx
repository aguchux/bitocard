'use client';

import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { DataTable } from './data';
import { Badge, Notice, StatusBadge } from './status';
import { Button, Card, CardHeader, Input, KeyValue, Toggle } from './primitives';
import { formatDateTime, formatMoney, formatRelative } from '../format';

/** A hosted store's customer, as its owner sees them (the same shape in SHQ and the admin app). */
export type StoreCustomerRow = {
  id: string;
  name: string;
  email: string;
  email_confirmed: boolean;
  status: 'active' | 'disabled';
  identity_check: boolean;
  identity_checked: boolean;
  purchases: number;
  created_at: string;
};

export type StoreCustomerPurchase = {
  id: string;
  order_id: string | null;
  status: string;
  mode: 'test' | 'live';
  product: string | null;
  quantity: number;
  amount: number;
  currency: string;
  created_at: string;
};

export type StoreCustomerDetailView = StoreCustomerRow & {
  last_sign_in_at: string | null;
  locked_until: string | null;
  signed_in_sessions: number;
  disputes: number;
  purchases_list: StoreCustomerPurchase[];
};

/** Stops a click on a control inside a clickable row from opening the row. */
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

/**
 * A store's customers with a switch each for the identity check: on, they are asked where the rules require it; off,
 * they are not. Whether they passed the check is shown, never set: only the check itself marks a customer checked.
 */
export function StoreCustomersTable({
  customers,
  loading,
  error,
  onRetry,
  search,
  onSearch,
  editable,
  onIdentityCheck,
  onOpen,
  hasMore,
}: {
  customers: StoreCustomerRow[] | undefined;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  search: string;
  onSearch: (value: string) => void;
  editable: boolean;
  onIdentityCheck: (customer: StoreCustomerRow, on: boolean) => void;
  /** Opens the customer's page. */
  onOpen?: (customer: StoreCustomerRow) => void;
  hasMore?: boolean;
}) {
  return (
    <div>
      <label className="relative m-4 flex items-center sm:m-5">
        <span className="sr-only">Search customers</span>
        <Search className="pointer-events-none absolute left-4 size-4 text-subtle" aria-hidden />
        <Input type="search" placeholder="Search by name or email…" value={search} onChange={event => onSearch(event.target.value)} className="pl-11" />
      </label>
      <DataTable
        caption="Customers"
        rows={customers}
        loading={loading}
        error={error}
        onRetry={onRetry}
        rowKey={customer => customer.id}
        onRowClick={onOpen}
        empty={search ? 'No customer matches.' : 'No customers yet.'}
        columns={[
          {
            key: 'customer',
            header: 'Customer',
            cell: customer => (
              <span className="block min-w-0">
                <span className="flex items-center gap-2 font-semibold text-ink">
                  {customer.name}
                  {customer.status === 'disabled' ? <Badge tone="red">Disabled</Badge> : null}
                </span>
                <span className="block break-all text-sm text-muted">{customer.email}</span>
              </span>
            ),
          },
          { key: 'purchases', header: 'Purchases', align: 'right', cell: customer => customer.purchases.toLocaleString('en-GB') },
          {
            key: 'checked',
            header: 'Identity',
            cell: customer => (customer.identity_checked ? <StatusBadge status="approved" label="Checked" /> : <Badge tone="grey">Not checked</Badge>),
          },
          {
            key: 'check',
            header: 'Identity check',
            cell: customer => (
              <span className="flex items-center gap-2 text-sm" onClick={stop} onKeyDown={stop}>
                <Toggle label={`Ask ${customer.name} for the identity check`} checked={customer.identity_check} disabled={!editable} onChange={on => onIdentityCheck(customer, on)} />
                {customer.identity_check ? 'Asked' : 'Off'}
              </span>
            ),
          },
          { key: 'joined', header: 'Joined', hideOnMobile: true, cell: customer => formatRelative(customer.created_at) },
        ]}
      />
      {hasMore ? <p className="border-t border-line p-4 text-center text-sm text-muted">Showing the newest 100. Search to find others.</p> : null}
    </div>
  );
}

const purchaseLabels: Record<string, string> = { paid: 'Paid', completed: 'Delivered', refund_pending: 'Refund on its way', refunded: 'Refunded' };

/**
 * One customer for the store's owner: their account, identity check and purchases, with the owner's actions: the
 * identity check on or off, disable or re-enable the account, unlock it and sign it out everywhere.
 */
export function StoreCustomerView({
  customer,
  canChange,
  canUnlock,
  busy,
  error,
  onUpdate,
  onUnlock,
  onSignOut,
  orderLink,
  storeChecksOff,
}: {
  customer: StoreCustomerDetailView;
  /** Identity check and account status. */
  canChange: boolean;
  /** Unlock and sign out. */
  canUnlock: boolean;
  busy?: boolean;
  error?: string | null;
  onUpdate: (change: { identity_check?: boolean; status?: 'active' | 'disabled' }) => void;
  onUnlock: () => void;
  onSignOut: () => void;
  /** A link to a purchase's order, or null where there is none. */
  orderLink: (purchase: StoreCustomerPurchase) => ReactNode;
  /** The whole store asks nobody, whatever is set for this customer. */
  storeChecksOff?: boolean;
}) {
  const disabled = customer.status === 'disabled';
  return (
    <div className="space-y-6">
      {error ? <Notice tone="red">{error}</Notice> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Account"
            description={disabled ? 'Disabled: cannot sign in or buy.' : 'Active.'}
            actions={
              canChange ? (
                <Button size="sm" variant={disabled ? 'primary' : 'secondary'} loading={busy} onClick={() => onUpdate({ status: disabled ? 'active' : 'disabled' })}>
                  {disabled ? 'Re-enable' : 'Disable'}
                </Button>
              ) : null
            }
          />
          <div className="space-y-4 p-5 sm:p-6">
            <KeyValue
              items={[
                { label: 'Email', value: <span className="break-all">{customer.email}</span> },
                { label: 'Email confirmed', value: customer.email_confirmed ? 'Yes' : 'Not yet' },
                { label: 'Joined', value: formatDateTime(customer.created_at) },
                { label: 'Last signed in', value: customer.last_sign_in_at ? formatRelative(customer.last_sign_in_at) : 'Never' },
                { label: 'Signed in on', value: `${customer.signed_in_sessions} ${customer.signed_in_sessions === 1 ? 'device' : 'devices'}` },
                { label: 'Disputes', value: customer.disputes.toLocaleString('en-GB') },
              ]}
            />
            {customer.locked_until ? <Notice tone="amber">{`Locked after too many wrong passwords until ${formatDateTime(customer.locked_until)}.`}</Notice> : null}
            {canUnlock ? (
              <div className="flex flex-wrap gap-2">
                {customer.locked_until ? (
                  <Button size="sm" variant="secondary" loading={busy} onClick={onUnlock}>
                    Unlock
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" loading={busy} disabled={customer.signed_in_sessions === 0} onClick={onSignOut}>
                  Sign out everywhere
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Identity check"
            description={customer.identity_checked ? 'Passed BitoCard’s identity check.' : 'Not checked.'}
            actions={
              <span className="flex items-center gap-2 text-sm font-medium">
                {customer.identity_check ? 'Asked' : 'Off'}
                <Toggle label={`Ask ${customer.name} for the identity check`} checked={customer.identity_check} disabled={!canChange || busy} onChange={identity_check => onUpdate({ identity_check })} />
              </span>
            }
          />
          <div className="space-y-3 p-5 sm:p-6 text-sm text-muted">
            <p>
              {customer.identity_check
                ? 'Asked to verify their identity before buying where the market requires it for the product.'
                : 'Not asked, whatever the market requires. This does not mark them as checked.'}
            </p>
            {storeChecksOff ? <Notice tone="grey">Identity checks are off for the whole store, so this customer is not asked either way.</Notice> : null}
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Purchases" description="Paid purchases, newest first (the latest 50). Codes are only ever shown to the customer." />
        <DataTable
          caption="Purchases"
          rows={customer.purchases_list}
          rowKey={purchase => purchase.id}
          empty="No purchases yet."
          columns={[
            {
              key: 'product',
              header: 'Product',
              cell: purchase => (
                <span className="flex items-center gap-2">
                  {purchase.quantity > 1 ? `${purchase.quantity} × ` : ''}
                  {purchase.product ?? 'Product'}
                  {purchase.mode === 'test' ? <Badge tone="amber">Test</Badge> : null}
                </span>
              ),
            },
            { key: 'amount', header: 'Paid', align: 'right', cell: purchase => formatMoney(purchase.amount, purchase.currency) },
            { key: 'status', header: 'Status', cell: purchase => <StatusBadge status={purchase.status} label={purchaseLabels[purchase.status] ?? purchase.status} /> },
            { key: 'date', header: 'Date', hideOnMobile: true, cell: purchase => formatDateTime(purchase.created_at) },
            { key: 'order', header: 'Order', cell: purchase => orderLink(purchase) },
          ]}
        />
      </Card>
    </div>
  );
}
