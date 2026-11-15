"use client";

import { useId, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, Dialog, errorMessage, Field, Input, Notice, Textarea, Toggle } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import {
  type DepositBankAccount,
  useCreateDepositBankAccountMutation,
  useDeleteDepositBankAccountMutation,
  useDepositBankAccountsQuery,
  useUpdateDepositBankAccountMutation,
} from "@bitocard/api-client/admin";

/**
 * Golojan's bank accounts customers in this market pay cash into, or transfer to, to top up their wallet (shown while
 * the market's `bank_deposits` switch is on). Finance changes them after step-up: they decide where real money goes.
 */
export function BankDepositAccounts({ code, country, currency, editable }: { code: string; country: string; currency: string; editable: boolean }) {
  const accounts = useDepositBankAccountsQuery({ country: code });
  const [editing, setEditing] = useState<DepositBankAccount | "new" | null>(null);
  const [update] = useUpdateDepositBankAccountMutation();
  const rows = accounts.data?.data ?? [];
  return (
    <div className="space-y-4 px-4 pb-5 sm:px-6">
      {accounts.error && !accounts.data ? <Notice tone="red">{errorMessage(accounts.error)}</Notice> : null}
      <p className="text-sm text-muted">
        {`Customers in ${country} can top up by paying into these accounts while the `}
        <AppLink href="/settings" className="font-semibold underline">
          bank_deposits switch
        </AppLink>
        {` is on for ${country}. They say when they paid; finance credits what arrived on Orders > `}
        <AppLink href="/orders/bank-deposits" className="font-semibold underline">
          Bank deposits
        </AppLink>
        .
      </p>
      {rows.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {rows.map(account => (
            <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold">
                  {`${account.bank_name} · ${account.account_number}`} {!account.active ? <Badge tone="grey">Off</Badge> : null}
                </p>
                <p className="text-sm text-muted">{`${account.account_name} · ${account.currency}`}</p>
                {account.details ? <p className="text-xs text-muted">{account.details}</p> : null}
              </div>
              {editable ? (
                <div className="flex items-center gap-3">
                  <Toggle label={`Offer ${account.bank_name} ${account.account_number}`} checked={account.active} onChange={active => void update({ id: account.id, active })} />
                  <Button size="sm" variant="secondary" onClick={() => setEditing(account)}>
                    Edit
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : accounts.isLoading ? null : (
        <Notice tone="grey">{`No account yet: customers in ${country} are not offered bank deposits.`}</Notice>
      )}
      {editable ? (
        <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden="true" /> Add an account
        </Button>
      ) : (
        <p className="text-sm text-muted">Only finance admins change these accounts.</p>
      )}
      {editing ? <AccountDialog code={code} currency={currency} account={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function AccountDialog({ code, currency, account, onClose }: { code: string; currency: string; account: DepositBankAccount | null; onClose: () => void }) {
  const id = useId();
  const [create, created] = useCreateDepositBankAccountMutation();
  const [update, updated] = useUpdateDepositBankAccountMutation();
  const [remove, removed] = useDeleteDepositBankAccountMutation();
  const [bank, setBank] = useState(account?.bank_name ?? "");
  const [name, setName] = useState(account?.account_name ?? "");
  const [number, setNumber] = useState(account?.account_number ?? "");
  const [money, setMoney] = useState(account?.currency ?? currency);
  const [details, setDetails] = useState(account?.details ?? "");
  const valid = bank.trim().length >= 2 && name.trim().length >= 2 && number.trim().length >= 4 && /^[A-Za-z]{3}$/.test(money.trim());
  const error = created.error ?? updated.error ?? removed.error;
  const body = { bank_name: bank.trim(), account_name: name.trim(), account_number: number.trim(), currency: money.trim().toUpperCase(), details: details.trim() || null };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const saving = account ? update({ id: account.id, ...body }) : create({ country: code, ...body });
    await saving
      .unwrap()
      .then(onClose)
      .catch(() => undefined);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={account ? `${account.bank_name} ${account.account_number}` : "Add a bank account"}
      description="An account Golojan owns and checks. Requests already made keep the details they were given."
      footer={
        <>
          {account ? (
            <Button
              variant="ghost"
              loading={removed.isLoading}
              onClick={() =>
                void remove(account.id)
                  .unwrap()
                  .then(onClose)
                  .catch(() => undefined)
              }
            >
              Remove
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} loading={created.isLoading || updated.isLoading} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        {error ? <Notice tone="red">{errorMessage(error)}</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bank" htmlFor={`${id}-bank`}>
            <Input id={`${id}-bank`} value={bank} maxLength={80} onChange={event => setBank(event.target.value)} />
          </Field>
          <Field label="Account number" htmlFor={`${id}-number`}>
            <Input id={`${id}-number`} value={number} maxLength={40} onChange={event => setNumber(event.target.value)} />
          </Field>
          <Field label="Account name" htmlFor={`${id}-name`}>
            <Input id={`${id}-name`} value={name} maxLength={120} onChange={event => setName(event.target.value)} />
          </Field>
          <Field label="Currency" htmlFor={`${id}-currency`} hint="The wallet it tops up.">
            <Input id={`${id}-currency`} value={money} maxLength={3} onChange={event => setMoney(event.target.value)} />
          </Field>
        </div>
        <Field label="Other details (optional)" htmlFor={`${id}-details`} hint="Shown to customers under the account: sort code, branch, how to write the reference.">
          <Textarea id={`${id}-details`} rows={3} maxLength={300} value={details} onChange={event => setDetails(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
