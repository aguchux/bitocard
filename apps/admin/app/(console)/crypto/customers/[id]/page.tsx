"use client";

import { use, useState } from "react";
import { Lock, Plus, Snowflake, Unlock } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, DataTable, Field, formatDateTime, Input, PageHeader, QueryView, Select, Skeleton, Tabs, type Column } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type CryptoBalance,
  type CryptoCustomerDetail,
  type CryptoFreeze,
  type Mode,
  useCreditTestCryptoMutation,
  useCryptoCustomerQuery,
  useFreezeCryptoMutation,
  useResolveCryptoFreezeMutation,
  useSetCryptoAccountFrozenMutation,
} from "@bitocard/api-client/admin";

const balanceColumns: Array<Column<CryptoBalance>> = [
  { key: "asset", header: "Asset", cell: row => <span className="font-semibold">{row.asset}</span> },
  { key: "available", header: "Available", cell: row => row.available, align: "right" },
  { key: "locked", header: "Locked (ads)", cell: row => row.locked, align: "right" },
  { key: "frozen", header: "Frozen", cell: row => row.frozen, align: "right" },
  { key: "withdrawing", header: "Withdrawing", cell: row => row.withdrawing, align: "right", hideOnMobile: true },
  { key: "total", header: "Total", cell: row => <span className="font-semibold">{row.total}</span>, align: "right", hideOnMobile: true },
];

/** The mode to show first: live when they hold live crypto, else test when they hold test crypto. */
const holding = (balances: CryptoBalance[]) => balances.some(row => Number(row.total) > 0);
const firstMode = (customer: CryptoCustomerDetail): Mode => (holding(customer.balances.live) || !holding(customer.balances.test) ? "live" : "test");


/** Freezing an amount: which asset and mode, how much, and why (the customer is told). */
function FreezeDialog({ customer, open, onClose, defaultMode }: { customer: CryptoCustomerDetail; open: boolean; onClose: () => void; defaultMode: Mode }) {
  const [freeze] = useFreezeCryptoMutation();
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [asset, setAsset] = useState(customer.balances.live[0]?.asset ?? "USDT");
  const [amount, setAmount] = useState("");
  const available = customer.balances[mode].find(row => row.asset === asset)?.available ?? "0";
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="Freeze crypto"
      description="Moves the amount out of their available balance until you release it (or finance seizes it). Only available crypto can be frozen, never what their ads lock."
      confirmLabel="Freeze"
      tone="danger"
      onConfirm={reason => freeze({ id: customer.id, asset, amount: amount.trim(), mode, reason }).unwrap()}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Mode" htmlFor="freeze-mode">
          <Select id="freeze-mode" value={mode} onChange={event => setMode(event.target.value as Mode)}>
            <option value="live">Live</option>
            <option value="test">Test</option>
          </Select>
        </Field>
        <Field label="Asset" htmlFor="freeze-asset">
          <Select id="freeze-asset" value={asset} onChange={event => setAsset(event.target.value)}>
            {customer.balances[mode].map(row => (
              <option key={row.asset} value={row.asset}>
                {row.asset}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount" htmlFor="freeze-amount" hint={`${available} available`}>
          <Input id="freeze-amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} />
        </Field>
      </div>
    </ActionDialog>
  );
}

function CreditDialog({ customer, open, onClose }: { customer: CryptoCustomerDetail; open: boolean; onClose: () => void }) {
  const [credit] = useCreditTestCryptoMutation();
  const [asset, setAsset] = useState(customer.balances.test[0]?.asset ?? "USDT");
  const [amount, setAmount] = useState("100");
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="Add test crypto"
      description="Test mode only, for trying the market. Live crypto only ever arrives from the blockchain."
      confirmLabel="Add test crypto"
      onConfirm={reason => credit({ id: customer.id, asset, amount: amount.trim(), reason }).unwrap()}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Asset" htmlFor="credit-asset">
          <Select id="credit-asset" value={asset} onChange={event => setAsset(event.target.value)}>
            {customer.balances.test.map(row => (
              <option key={row.asset} value={row.asset}>
                {row.asset}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount" htmlFor="credit-amount">
          <Input id="credit-amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} />
        </Field>
      </div>
    </ActionDialog>
  );
}

/** A customer's crypto: balances per mode, P2P cash, freezes (release or seize), and the account freeze. */
export default function CryptoCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const admin = useAdmin();
  const query = useCryptoCustomerQuery(id);
  const operations = can(admin, "operations");
  const finance = can(admin, "finance");
  const [asked, setMode] = useState<Mode | null>(null);
  const [dialog, setDialog] = useState<"freeze" | "credit" | "account" | null>(null);
  const [resolving, setResolving] = useState<{ freeze: CryptoFreeze; outcome: "release" | "seize" } | null>(null);
  const [setFrozen] = useSetCryptoAccountFrozenMutation();
  const [resolve] = useResolveCryptoFreezeMutation();

  return (
    <AdminShell section="crypto" current="/crypto" crumbs={[{ label: "Crypto", href: "/crypto" }, { label: "Wallets & freezes", href: "/crypto" }, { label: query.data?.email ?? "Customer" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96" />}>
        {customer => {
          const mode = asked ?? firstMode(customer);
          const freezeColumns: Array<Column<CryptoFreeze>> = [
            { key: "when", header: "Frozen", cell: row => formatDateTime(row.created_at) },
            { key: "amount", header: "Amount", cell: row => `${row.amount} ${row.asset}${row.mode === "test" ? " (test)" : ""}` },
            { key: "reason", header: "Reason", cell: row => row.reason, hideOnMobile: true },
            { key: "status", header: "Status", cell: row => <Badge tone={row.status === "frozen" ? "red" : row.status === "seized" ? "amber" : "grey"}>{row.status}</Badge> },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: row =>
                row.status === "frozen" ? (
                  <span className="flex justify-end gap-2">
                    {operations ? (
                      <Button size="sm" variant="secondary" onClick={() => setResolving({ freeze: row, outcome: "release" })}>
                        Release
                      </Button>
                    ) : null}
                    {finance ? (
                      <Button size="sm" variant="danger" onClick={() => setResolving({ freeze: row, outcome: "seize" })}>
                        Seize
                      </Button>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-xs text-muted">{row.resolve_note}</span>
                ),
            },
          ];
          return (
            <div className="space-y-6">
              <PageHeader
                title={customer.email}
                description={`${customer.name} · ${customer.store.name} · ${customer.country ?? "no country"}${customer.nickname ? ` · trades as ${customer.nickname}` : ""}`}
                actions={
                  operations ? (
                    <>
                      <Button variant="secondary" icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setDialog("credit")}>
                        Test crypto
                      </Button>
                      <Button variant="secondary" icon={<Snowflake className="size-4" aria-hidden="true" />} onClick={() => setDialog("freeze")}>
                        Freeze amount
                      </Button>
                      <Button variant={customer.frozen ? "primary" : "danger"} icon={customer.frozen ? <Unlock className="size-4" aria-hidden="true" /> : <Lock className="size-4" aria-hidden="true" />} onClick={() => setDialog("account")}>
                        {customer.frozen ? "Unfreeze account" : "Freeze account"}
                      </Button>
                    </>
                  ) : null
                }
              />
              {customer.frozen ? (
                <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  Crypto account frozen {formatDateTime(customer.frozen_at)}: {customer.frozen_reason}. They cannot post ads, trade or withdraw, and their ads are off the market.
                </Card>
              ) : null}
              <Card>
                <CardHeader title="Balances" />
                <div className="px-4 pb-2">
                  <Tabs<Mode>
                    label="Mode"
                    items={[
                      { value: "live", label: "Live" },
                      { value: "test", label: "Test" },
                    ]}
                    value={mode}
                    onChange={setMode}
                  />
                </div>
                <DataTable columns={balanceColumns} rows={customer.balances[mode]} rowKey={row => row.asset} />
              </Card>
              <Card>
                <CardHeader title="Freezes" />
                <DataTable columns={freezeColumns} rows={customer.freezes} rowKey={row => row.id} empty="Nothing has been frozen." />
              </Card>
              <p className="text-sm text-muted">
                Their activity: <AppLink href={`/crypto/ads?customer=${customer.id}`} className="font-semibold text-brand-600 hover:underline">P2P ads</AppLink> ·{" "}
                <AppLink href={`/crypto/deposits?customer=${customer.id}`} className="font-semibold text-brand-600 hover:underline">Deposits</AppLink> ·{" "}
                <AppLink href={`/crypto/withdrawals?customer=${customer.id}`} className="font-semibold text-brand-600 hover:underline">Withdrawals</AppLink> ·{" "}
                <AppLink href={`/crypto/payouts?customer=${customer.id}`} className="font-semibold text-brand-600 hover:underline">P2P payouts</AppLink> ·{" "}
                <AppLink href={`/storefront/spins?customer=${customer.id}`} className="font-semibold text-brand-600 hover:underline">Spin rewards</AppLink>
              </p>
              {dialog === "freeze" ? <FreezeDialog customer={customer} open onClose={() => setDialog(null)} defaultMode={mode} /> : null}
              <CreditDialog customer={customer} open={dialog === "credit"} onClose={() => setDialog(null)} />
              <ActionDialog
                open={dialog === "account"}
                onClose={() => setDialog(null)}
                title={customer.frozen ? "Unfreeze the crypto account" : "Freeze the crypto account"}
                description={customer.frozen ? "They can trade and post ads again." : "No new ads, trades or withdrawals, and their ads leave the market. Their balances stay where they are. They are told their account is frozen, not why."}
                confirmLabel={customer.frozen ? "Unfreeze" : "Freeze account"}
                tone={customer.frozen ? "primary" : "danger"}
                onConfirm={reason => setFrozen({ id: customer.id, frozen: !customer.frozen, reason }).unwrap()}
              />
              <ActionDialog
                open={Boolean(resolving)}
                onClose={() => setResolving(null)}
                title={resolving?.outcome === "seize" ? "Seize frozen crypto" : "Release frozen crypto"}
                description={
                  resolving
                    ? resolving.outcome === "seize"
                      ? `${resolving.freeze.amount} ${resolving.freeze.asset} goes to BitoCard's adjustments for good (court orders, proven fraud). This cannot be undone.`
                      : `${resolving.freeze.amount} ${resolving.freeze.asset} goes back to their available balance.`
                    : undefined
                }
                confirmLabel={resolving?.outcome === "seize" ? "Seize" : "Release"}
                tone={resolving?.outcome === "seize" ? "danger" : "primary"}
                onConfirm={note => resolve({ id: resolving!.freeze.id, outcome: resolving!.outcome, note }).unwrap()}
              />
            </div>
          );
        }}
      </QueryView>
    </AdminShell>
  );
}
