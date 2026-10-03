"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { Building, Plus, Trash2 } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, DataTable, Dialog, errorMessage, Field, formatDateTime, Input, Notice, PageHeader, Select } from "@bitocard/admin-ui";
import { type BankAccount, useAddBankAccountMutation, useBankAccountsQuery, useBanksQuery, useRemoveBankAccountMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/** The API allows this many payout accounts at once. */
const maxAccounts = 5;

function AddBankAccount({ open, onClose, sandbox }: { open: boolean; onClose: () => void; sandbox: boolean }) {
  const id = useId();
  const banks = useBanksQuery(undefined, { skip: !open });
  const [add, state] = useAddBankAccountMutation();
  const [bank, setBank] = useState("");
  const [number, setNumber] = useState("");
  const [filter, setFilter] = useState("");
  const [added, setAdded] = useState<BankAccount | null>(null);
  const options = useMemo(() => {
    const list = [...(banks.data?.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const query = filter.trim().toLowerCase();
    return query ? list.filter(item => item.name.toLowerCase().includes(query) || item.code === bank) : list;
  }, [banks.data, filter, bank]);
  const valid = Boolean(bank) && /^\d{6,20}$/.test(number);

  const close = () => {
    setBank("");
    setNumber("");
    setFilter("");
    setAdded(null);
    state.reset();
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const account = await add({ bank_code: bank, account_number: number })
      .unwrap()
      .catch(() => null);
    if (account) setAdded(account);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add a payout bank account"
      description="Your bank confirms the account and gives us its name."
      footer={
        added ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form={`${id}-form`} loading={state.isLoading} disabled={!valid}>
              Add account
            </Button>
          </>
        )
      }
    >
      {added ? (
        <Notice tone="green" title="Account added">
          {`${added.bank_name} ····${added.account_number_last4}, in the name of ${added.account_name}. `}
          {sandbox ? "You can withdraw to it straight away." : `Withdrawals to it can start ${formatDateTime(added.payouts_available_from)}.`}
        </Notice>
      ) : (
        <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
          {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
          {banks.error ? <Notice tone="red">{errorMessage(banks.error, "Could not load the bank list.")}</Notice> : null}
          <Field label="Find your bank" htmlFor={`${id}-filter`}>
            <Input id={`${id}-filter`} type="search" autoComplete="off" placeholder="Type to filter" value={filter} onChange={event => setFilter(event.target.value)} />
          </Field>
          <Field label="Bank" htmlFor={`${id}-bank`} hint={banks.isLoading ? "Loading banks…" : undefined}>
            <Select id={`${id}-bank`} value={bank} onChange={event => setBank(event.target.value)} disabled={banks.isLoading || !banks.data}>
              <option value="">Choose a bank</option>
              {options.map(item => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Account number" htmlFor={`${id}-number`} hint="6 to 20 digits.">
            <Input id={`${id}-number`} inputMode="numeric" autoComplete="off" maxLength={20} value={number} onChange={event => setNumber(event.target.value.replace(/\D/g, ""))} />
          </Field>
          {!sandbox ? (
            <p className="text-xs text-muted">
              The account must be in your verified name or your business name. For your security, withdrawals to a new account start 24 hours after it is added, and the owner is emailed.
            </p>
          ) : null}
        </form>
      )}
    </Dialog>
  );
}

export default function BankAccountsPage() {
  const { membership, mode } = useReseller();
  const allowed = can(membership, "finance");
  const sandbox = mode === "test";
  const accounts = useBankAccountsQuery(undefined, { skip: !allowed });
  const [remove] = useRemoveBankAccountMutation();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<BankAccount | null>(null);
  const list = accounts.data?.data;
  const full = (list?.length ?? 0) >= maxAccounts;
  // The time the page opened, for the 24-hour wait badges.
  const [now] = useState(() => Date.now());

  return (
    <ShqShell
      section="wallet"
      current="/wallet/bank-accounts"
      crumbs={[{ label: "Wallet", href: "/wallet" }, { label: "Payout bank accounts" }]}
    >
      <PageHeader
        title="Payout bank accounts"
        description={`Where your withdrawn earnings are paid. Up to ${maxAccounts} accounts.`}
        actions={
          allowed ? (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)} disabled={!list || full}>
              Add account
            </Button>
          ) : null
        }
      />
      {!allowed ? (
        <Notice tone="grey" title="No access to payout accounts">
          Only the owner and finance members can manage payout bank accounts.
        </Notice>
      ) : (
        <>
          {!sandbox ? (
            <Notice tone="blue">
              Accounts must be in your verified name or your business name, and your business must be verified first. Withdrawals to a newly added account start 24 hours after it is added.
            </Notice>
          ) : null}
          {full ? <Notice tone="amber">{`You have ${maxAccounts} accounts, the most allowed. Remove one to add another.`}</Notice> : null}
          <Card>
            <CardHeader title="Your accounts" className="pb-4" />
            <DataTable<BankAccount>
              caption="Payout bank accounts"
              rows={list}
              loading={accounts.isLoading}
              error={accounts.error ? errorMessage(accounts.error) : null}
              onRetry={accounts.refetch}
              rowKey={row => row.id}
              empty="No payout bank accounts yet. Add one to withdraw your earnings."
              columns={[
                {
                  key: "bank",
                  header: "Account",
                  cell: row => (
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <Building className="size-4 shrink-0 text-muted" aria-hidden />
                      <span className="truncate">{`${row.bank_name} ····${row.account_number_last4}`}</span>
                    </span>
                  ),
                },
                { key: "name", header: "Account name", cell: row => <span className="break-words">{row.account_name}</span> },
                {
                  key: "ready",
                  header: "Withdrawals",
                  cell: row =>
                    new Date(row.payouts_available_from).getTime() > now ? (
                      <Badge tone="amber">{`From ${formatDateTime(row.payouts_available_from)}`}</Badge>
                    ) : (
                      <Badge tone="green">Ready</Badge>
                    ),
                },
                { key: "added", header: "Added", cell: row => <span className="whitespace-nowrap text-muted">{formatDateTime(row.created_at)}</span>, hideOnMobile: true },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  cell: row => (
                    <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setRemoving(row)} aria-label={`Remove ${row.bank_name} ····${row.account_number_last4}`}>
                      Remove
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}
      <AddBankAccount open={adding} onClose={() => setAdding(false)} sandbox={sandbox} />
      <ActionDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this account?"
        description={removing ? `${removing.bank_name} ····${removing.account_number_last4} (${removing.account_name})` : undefined}
        confirmLabel="Remove account"
        tone="danger"
        requireReason={false}
        onConfirm={async () => {
          if (removing) await remove(removing.id).unwrap();
        }}
      >
        <p className="text-sm text-muted">Withdrawals already on their way are not affected. You can add the account again later, but the 24-hour wait starts again.</p>
      </ActionDialog>
    </ShqShell>
  );
}
