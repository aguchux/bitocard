"use client";

import { Suspense, useId, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, Card, CardHeader, DataTable, errorMessage, Field, formatDateTime, KeyValue, Notice, PageHeader, QueryView, Select, Skeleton } from "@bitocard/admin-ui";
import {
  type CoinDeposit,
  type CoinDepositAddress,
  type CoinDepositNetwork,
  type ResellerCoins,
  useCoinDepositAddressMutation,
  useCoinDepositNetworksQuery,
  useCoinDepositsQuery,
  useResellerCoinsQuery,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { CopyButton } from "../../developers/developer-parts";
import { coinAmount } from "../shared";
import { choosableCoins, CoinSelect, coinRoles, DepositStatus, PremiumNotice, shortHash, useChosenAsset } from "../coin-parts";

/** The address for one coin on one network, with what to check before sending. */
function AddressCard({ address }: { address: CoinDepositAddress }) {
  return (
    <div className="mt-5 space-y-4 rounded-xl border border-line bg-canvas p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-subtle">
          Your {address.asset} address on {address.network}
        </p>
        <p className="mt-1 break-all font-mono text-base font-semibold text-ink">{address.address}</p>
        <CopyButton value={address.address} label="Copy address" className="mt-3 min-h-11" />
      </div>
      <div className="flex gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800" role="note">
        <TriangleAlert className="size-5 shrink-0" aria-hidden />
        <p>
          Send only {address.asset} on {address.network} to this address. Other coins, or {address.asset} on another network, cannot be credited and may be lost.
          {address.mode === "test" ? " This is a test network address: send test coins only." : ""}
        </p>
      </div>
      <KeyValue
        items={[
          ...(address.contract
            ? [
                {
                  label: "Token contract",
                  value: <span className="break-all font-mono">{address.contract}</span>,
                },
              ]
            : []),
          { label: "Confirmations needed", value: address.confirmations },
          {
            label: "Watched closely until",
            value: formatDateTime(address.watch_until),
          },
        ]}
      />
      <p className="text-xs text-muted">The address stays yours. Deposits are credited to your coin wallet once the network confirms them.</p>
    </div>
  );
}

function DepositForm({ asset, networks }: { asset: string; networks: CoinDepositNetwork[] }) {
  const id = useId();
  const { membership } = useReseller();
  const allowed = can(membership, ...coinRoles);
  const [chain, setChain] = useState(networks[0]?.chain ?? "");
  const [show, state] = useCoinDepositAddressMutation();
  const network = networks.find(item => item.chain === chain) ?? networks[0];
  const shown = state.data && state.data.asset === asset && state.data.chain === network?.chain ? state.data : null;
  if (!network) return <Notice tone="amber">{asset} deposits are not open on any network yet.</Notice>;
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Network" htmlFor={`${id}-network`} hint={network.token ? `${network.token} token` : `${asset} on its own chain`}>
          <Select id={`${id}-network`} value={network.chain} onChange={event => setChain(event.target.value)}>
            {networks.map(item => (
              <option key={item.chain} value={item.chain}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          {allowed ? (
            <Button
              type="button"
              loading={state.isLoading}
              onClick={() =>
                void show({ asset, chain: network.chain })
                  .unwrap()
                  .catch(() => undefined)
              }
            >
              Show deposit address
            </Button>
          ) : (
            <p className="text-sm text-muted">Only owners, admins and finance members can show deposit addresses.</p>
          )}
        </div>
      </div>
      {state.error && !shown ? (
        <div className="mt-4">
          <Notice tone="red">{errorMessage(state.error)}</Notice>
        </div>
      ) : null}
      {shown ? <AddressCard address={shown} /> : null}
    </div>
  );
}

function Deposits() {
  const deposits = useCoinDepositsQuery(undefined, {
    pollingInterval: 30_000,
    skipPollingIfUnfocused: true,
  });
  return (
    <Card>
      <CardHeader title="Recent deposits" description="Coins sent to your addresses, newest first." />
      <div className="mt-4">
        <DataTable<CoinDeposit>
          caption="Recent deposits"
          rows={deposits.data?.data}
          loading={deposits.isLoading}
          error={deposits.error ? errorMessage(deposits.error) : null}
          onRetry={() => void deposits.refetch()}
          rowKey={row => row.id}
          empty="No deposits yet."
          columns={[
            {
              key: "amount",
              header: "Amount",
              cell: row => (
                <span className="font-semibold tabular-nums text-ink">
                  {coinAmount(row.amount)} {row.asset}
                </span>
              ),
            },
            { key: "network", header: "Network", cell: row => row.network },
            {
              key: "status",
              header: "Status",
              cell: row => <DepositStatus status={row.status} />,
            },
            {
              key: "confirmations",
              header: "Confirmations",
              align: "right",
              cell: row => (
                <span className="tabular-nums">
                  {row.confirmations_needed === null ? row.confirmations : `${Math.min(row.confirmations, row.confirmations_needed)} of ${row.confirmations_needed}`}
                </span>
              ),
            },
            {
              key: "tx",
              header: "Transaction",
              hideOnMobile: true,
              cell: row => (
                <span className="font-mono text-xs" title={row.tx_hash}>
                  {shortHash(row.tx_hash)}
                </span>
              ),
            },
            {
              key: "date",
              header: "Seen",
              hideOnMobile: true,
              cell: row => formatDateTime(row.created_at),
            },
          ]}
        />
      </div>
    </Card>
  );
}

function Deposit({ coins }: { coins: ResellerCoins }) {
  const offered = choosableCoins(coins, "deposit");
  const asset = useChosenAsset(offered);
  const networks = useCoinDepositNetworksQuery(asset ?? "", {
    skip: !coins.onchain || !asset,
  });
  if (!coins.onchain) return <PremiumNotice />;
  if (!asset) return <Notice tone="amber">No coins can be deposited yet.</Notice>;
  return (
    <div className="space-y-4">
      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-bold text-ink">Deposit coins</h2>
        <p className="mt-1 text-sm text-muted">Send coins from another wallet to your BitoCard coin wallet. Choose the coin and the network you will send on.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <CoinSelect coins={offered} value={asset} path="/exchange/deposit" />
        </div>
        <div className="mt-4">
          {networks.error && !networks.data ? (
            <Notice tone="amber">{errorMessage(networks.error)}</Notice>
          ) : networks.data ? (
            <DepositForm key={asset} asset={asset} networks={networks.data.data} />
          ) : (
            <Skeleton className="h-20 w-full" />
          )}
        </div>
      </Card>
      <Deposits />
    </div>
  );
}

/** Depositing the business's own coins on chain (Premium). */
export default function ExchangeDepositPage() {
  const coins = useResellerCoinsQuery();
  return (
    <ShqShell section="exchange" current="/exchange/deposit" crumbs={[{ label: "Exchange", href: "/exchange" }, { label: "Coins", href: "/exchange/coins" }, { label: "Deposit" }]}>
      <PageHeader title="Deposit" description="Your own address for each coin, in this mode." />
      <div className="mt-6">
        <QueryView query={coins} loading={<Skeleton className="h-72 w-full" />}>
          {data => (
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <Deposit coins={data} />
            </Suspense>
          )}
        </QueryView>
      </div>
    </ShqShell>
  );
}
