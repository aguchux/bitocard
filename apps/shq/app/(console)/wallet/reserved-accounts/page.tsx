"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, Copy, Landmark, PiggyBank, ShieldCheck } from "lucide-react";
import { Button, Card, currencyDigits, Dialog, EmptyState, errorMessage, Field, formatMoney, Input, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import {
  type BvnCheck,
  type ReservedAccount,
  useBvnCheckQuery,
  useCreateReservedAccountsMutation,
  usePublicCountryQuery,
  useReservedAccountsQuery,
  useResellerSettingsQuery,
  useSimulateDepositMutation,
  useStartBvnCheckMutation,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/** "5,000.50" → minor units, or null when it is not a valid amount. */
function toMinor(value: string, currency: string) {
  const cleaned = value.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const digits = currencyDigits(currency);
  if ((cleaned.split(".")[1] ?? "").length > digits) return null;
  return Math.round(Number(cleaned) * 10 ** digits);
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Copy ${label}`}
      icon={copied ? <Check className="size-4 text-emerald-600" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked: the value is on screen to copy by hand */
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function AccountCard({ account, onSimulate }: { account: ReservedAccount; onSimulate?: () => void }) {
  const rows = [
    { label: "Bank", value: account.bank_name },
    { label: "Account number", value: account.account_number, mono: true },
    { label: "Account name", value: account.account_name },
  ];
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <Landmark className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate font-bold text-ink">{account.bank_name}</p>
          <p className="text-xs text-muted">{`Transfers in ${account.currency}`}</p>
        </div>
      </div>
      <dl className="mt-4 divide-y divide-line">
        {rows.map(row => (
          <div key={row.label} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-subtle">{row.label}</dt>
              <dd className={row.mono ? "break-all font-mono text-lg font-semibold tracking-wider text-ink" : "break-words text-sm text-ink"}>{row.value}</dd>
            </div>
            <CopyButton value={row.value} label={row.label.toLowerCase()} />
          </div>
        ))}
      </dl>
      {onSimulate ? (
        <div className="mt-4 border-t border-line pt-4">
          <Button variant="secondary" size="sm" icon={<PiggyBank className="size-4" aria-hidden />} onClick={onSimulate}>
            Simulate a transfer
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/** Creates the wallet's reserved accounts. Nigeria needs the owner's BVN: sent to the bank once and never kept here or by BitoCard. */
const bvnReasons: Record<string, string> = {
  name_mismatch: "The name on the BVN does not match the verified business owner.",
  bvn_consent_declined: "Consent was declined on the bank's page.",
  expired: "The check was not finished in time.",
};

/**
 * Nigeria, live: the owner's BVN is checked with Flutterwave (consent on the bank's page) and must match the verified
 * owner before accounts are opened. BitoCard keeps the BVN encrypted only until the accounts exist.
 */
function BvnStep({ check, owner, onRefresh, refreshing }: { check: BvnCheck | undefined; owner: boolean; onRefresh: () => void; refreshing: boolean }) {
  const id = useId();
  const [bvn, setBvn] = useState("");
  const [consent, setConsent] = useState(false);
  const [start, state] = useStartBvnCheckMutation();
  const valid = /^\d{11}$/.test(bvn);

  const begin = async (event: FormEvent) => {
    event.preventDefault();
    const started = await start({ bvn, consent: true })
      .unwrap()
      .catch(() => null);
    setBvn("");
    // Flutterwave's consent page; it returns here when done.
    if (started?.url) window.location.assign(started.url);
  };

  if (check?.status === "in_progress" && check.url) {
    return (
      <div className="mx-auto max-w-md space-y-3 text-center">
        <p className="text-sm text-muted">Your BVN check is waiting for your consent on the bank&apos;s page.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <a href={check.url} className="inline-flex min-h-11 items-center rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
            Continue the BVN check
          </a>
          <Button variant="secondary" loading={refreshing} onClick={onRefresh}>
            I have finished
          </Button>
        </div>
      </div>
    );
  }
  if (!owner) {
    return <Notice tone="grey">The business owner needs to check their BVN before bank transfer accounts can be opened.</Notice>;
  }
  return (
    <form onSubmit={begin} className="mx-auto max-w-md space-y-4" noValidate>
      {check && check.reason ? <Notice tone="red">{bvnReasons[check.reason] ?? "The BVN check did not pass. Try again."}</Notice> : null}
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <Field
        label="Your Bank Verification Number (BVN)"
        htmlFor={`${id}-bvn`}
        hint="The bank needs the business owner's BVN to open the account. BitoCard keeps it encrypted only until your accounts are opened."
      >
        <Input
          id={`${id}-bvn`}
          inputMode="numeric"
          autoComplete="off"
          maxLength={11}
          value={bvn}
          onChange={event => setBvn(event.target.value.replace(/\D/g, ""))}
          aria-invalid={bvn && !valid ? true : undefined}
        />
      </Field>
      <label className="flex items-start gap-3 rounded-xl border border-line p-4 text-sm">
        <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand-500" />
        <span>I agree to BitoCard checking my BVN with Flutterwave, and that its name must match my verified identity.</span>
      </label>
      <Button type="submit" className="w-full" icon={<ShieldCheck className="size-4" aria-hidden />} loading={state.isLoading} disabled={!valid || !consent}>
        Check my BVN
      </Button>
    </form>
  );
}

function CreateAccounts({ nigeria, sandbox }: { nigeria: boolean; sandbox: boolean }) {
  const { membership } = useReseller();
  // Live accounts are switched on by BitoCard per reseller; the sandbox always offers them.
  const settings = useResellerSettingsQuery(undefined, { skip: sandbox });
  const switchedOn = sandbox || Boolean(settings.data?.features.reserved_accounts);
  const needsBvn = !sandbox && nigeria && switchedOn;
  const bvn = useBvnCheckQuery(undefined, { skip: !needsBvn });
  const [create, state] = useCreateReservedAccountsMutation();

  const body = (() => {
    if (!sandbox && settings.isLoading) return <Skeleton className="mx-auto h-24 w-full max-w-md" />;
    if (!switchedOn) {
      return <Notice tone="grey" title="Not switched on for your account yet">Bank transfer accounts are opened once BitoCard switches them on for you. Contact support, or top up through the payment page meanwhile.</Notice>;
    }
    if (needsBvn && !bvn.data?.verified) {
      if (bvn.isLoading) return <Skeleton className="mx-auto h-24 w-full max-w-md" />;
      return <BvnStep check={bvn.data} owner={membership.role === "owner"} onRefresh={bvn.refetch} refreshing={bvn.isFetching} />;
    }
    return (
      <div className="mx-auto max-w-md space-y-4">
        {needsBvn ? <Notice tone="green">Your BVN is verified.</Notice> : null}
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Button className="w-full" loading={state.isLoading} onClick={() => create()}>
          Create my account
        </Button>
      </div>
    );
  })();

  return (
    <Card className="p-5 sm:p-6">
      <EmptyState title="No bank transfer account yet" icon={<Landmark className="size-6" aria-hidden />}>
        Get your own bank account number. Money you transfer into it tops up your wallet automatically, without a payment page.
      </EmptyState>
      {body}
    </Card>
  );
}

function SimulateDeposit({ account, onClose }: { account: ReservedAccount | null; onClose: () => void }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [simulate, state] = useSimulateDepositMutation();
  const [done, setDone] = useState<string | null>(null);
  const amount = account ? toMinor(value, account.currency) : null;
  const close = () => {
    setValue("");
    setDone(null);
    state.reset();
    onClose();
  };
  return (
    <Dialog
      open={account !== null}
      onClose={close}
      title="Simulate a bank transfer"
      description="Sandbox only: credits your test wallet as if a transfer had arrived."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {done ? "Close" : "Cancel"}
          </Button>
          <Button
            loading={state.isLoading}
            disabled={!account || amount === null || amount < 100}
            onClick={async () => {
              if (!account || amount === null) return;
              const result = await simulate({ id: account.id, amount })
                .unwrap()
                .catch(() => null);
              if (result) {
                setDone(result.credited ? `${formatMoney(result.amount, result.currency)} added to your test wallet.` : "The transfer was received but not credited.");
                setValue("");
              }
            }}
          >
            Send test transfer
          </Button>
        </>
      }
    >
      {account ? (
        <div className="space-y-4">
          {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
          {done ? <Notice tone="green">{done}</Notice> : null}
          <Field label={`Amount (${account.currency})`} htmlFor={`${id}-amount`} hint={`At least ${formatMoney(100, account.currency)}.`}>
            <Input id={`${id}-amount`} inputMode="decimal" autoComplete="off" placeholder="5000" value={value} onChange={event => setValue(event.target.value)} />
          </Field>
        </div>
      ) : null}
    </Dialog>
  );
}

export default function ReservedAccountsPage() {
  const { membership, mode } = useReseller();
  const allowed = can(membership, "admin", "finance");
  const sandbox = mode === "test";
  const accounts = useReservedAccountsQuery(undefined, { skip: !allowed });
  const country = usePublicCountryQuery(membership.reseller.country ?? "", { skip: !membership.reseller.country });
  // Offered country by country; a country that does not offer them yet shows a notice instead of the create form.
  const offered = country.data?.reserved_accounts !== false;
  const [simulating, setSimulating] = useState<ReservedAccount | null>(null);

  return (
    <ShqShell section="wallet" current="/wallet/reserved-accounts" crumbs={[{ label: "Wallet", href: "/wallet" }, { label: "Bank transfer accounts" }]}>
      <PageHeader title="Bank transfer accounts" description="Top up by bank transfer: your own account numbers, credited to your wallet automatically." />
      {!allowed ? (
        <Notice tone="grey" title="No access to bank transfer accounts">
          Only the owner, admins and finance members can see these accounts.
        </Notice>
      ) : (
        <QueryView
          query={accounts}
          message={error => errorMessage(error, "Could not load your accounts.")}
          loading={
            <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading">
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          }
        >
          {({ data: list }) =>
            list.length === 0 && !offered ? (
              <Notice tone="grey" title="Not offered in your country yet">
                {`Bank transfer accounts are not available in ${country.data?.name ?? "your country"} yet. Top up by card or bank on the Top-ups page instead.`}
              </Notice>
            ) : list.length === 0 ? (
              <CreateAccounts nigeria={membership.reseller.country === "NG"} sandbox={sandbox} />
            ) : (
              <>
                <Notice tone="blue" title="How it works">
                  Transfer from any bank to an account below. Your wallet is credited once the bank confirms the transfer, usually within minutes. Bank charges may apply.
                  {sandbox ? " These are sandbox accounts: real transfers to them are not credited." : ""}
                </Notice>
                <div className="grid gap-4 md:grid-cols-2">
                  {list.map(account => (
                    <AccountCard key={account.id} account={account} onSimulate={sandbox ? () => setSimulating(account) : undefined} />
                  ))}
                </div>
                <p className="text-sm text-muted">
                  Prefer to pay by card?{" "}
                  <Link href="/wallet/top-ups" className="font-semibold text-brand-600 underline-offset-2 hover:underline">
                    Top up through the payment page
                  </Link>
                  .
                </p>
              </>
            )
          }
        </QueryView>
      )}
      <SimulateDeposit account={simulating} onClose={() => setSimulating(null)} />
    </ShqShell>
  );
}
