'use client';

import { Search } from 'lucide-react';
import { DataTable } from './data';
import { Badge, StatusBadge } from './status';
import { Input, Toggle } from './primitives';
import { formatRelative } from '../format';

/** A hosted store's customer, as its owner sees them (the same shape in SHQ and the admin app). */
export type StoreCustomerRow = {
  id: string;
  name: string;
  email: string;
  email_confirmed: boolean;
  identity_check: boolean;
  identity_checked: boolean;
  purchases: number;
  created_at: string;
};

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
        empty={search ? 'No customer matches.' : 'No customers yet.'}
        columns={[
          {
            key: 'customer',
            header: 'Customer',
            cell: customer => (
              <span className="block min-w-0">
                <span className="block font-semibold text-ink">{customer.name}</span>
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
              <span className="flex items-center gap-2 text-sm">
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
