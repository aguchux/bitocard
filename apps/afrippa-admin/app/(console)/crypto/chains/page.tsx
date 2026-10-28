"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardHeader, errorMessage, formatRelative, Input, Notice, PageHeader, QueryView, Skeleton, Toggle } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { AfrippaShell as AdminShell } from "@/components/shell";
import { type ChainView, type CryptoNetworkSetting, useChainsQuery, useCheckChainsMutation, useSetChainRoutesMutation, useUpdateCryptoNetworkMutation } from "@bitocard/api-client/admin";

/** One network's settings: deposits on or off, confirmations, the test network token, the two-provider amount. */
function NetworkRow({ network, editable, ready }: { network: CryptoNetworkSetting; editable: boolean; ready: boolean }) {
  const [update, state] = useUpdateCryptoNetworkMutation();
  const [confirmations, setConfirmations] = useState(String(network.confirmations));
  const [doubleCheck, setDoubleCheck] = useState(network.double_check_from);
  const [testContract, setTestContract] = useState(network.test_contract ?? "");
  const [fee, setFee] = useState(network.withdrawal_fee);
  const [minimum, setMinimum] = useState(network.min_withdrawal);
  const changed =
    confirmations !== String(network.confirmations) ||
    doubleCheck !== network.double_check_from ||
    fee !== network.withdrawal_fee ||
    minimum !== network.min_withdrawal ||
    (network.contract !== null && testContract !== (network.test_contract ?? ""));
  return (
    <li className="space-y-3 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ink">
          {network.asset}
          <span className="ml-2 text-xs font-normal break-all text-muted">{network.contract ?? "the chain’s own coin"}</span>
        </p>
        <span className="flex flex-wrap items-center gap-3 text-sm">
          <span className="flex items-center gap-2">
            Deposits
            <Toggle checked={network.deposits_enabled} disabled={!editable} label={`${network.asset} deposits`} onChange={enabled => void update({ id: network.id, deposits_enabled: enabled })} />
          </span>
          {network.chain !== "SOLANA" ? (
            <span className="flex items-center gap-2">
              Withdrawals
              <Toggle checked={network.withdrawals_enabled} disabled={!editable} label={`${network.asset} withdrawals`} onChange={enabled => void update({ id: network.id, withdrawals_enabled: enabled })} />
            </span>
          ) : null}
        </span>
      </div>
      {network.deposits_enabled && !ready ? <p className="text-xs text-amber-700">Customers do not see it until this chain has a wallet key and a provider set up.</p> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs text-muted">
          Confirmations
          <Input inputMode="numeric" value={confirmations} disabled={!editable} onChange={event => setConfirmations(event.target.value)} />
        </label>
        <label className="text-xs text-muted">
          Second provider from ({network.asset})
          <Input inputMode="decimal" value={doubleCheck} disabled={!editable} onChange={event => setDoubleCheck(event.target.value)} />
        </label>
        {network.contract !== null ? (
          <label className="text-xs text-muted">
            Test network token
            <Input value={testContract} placeholder="None" disabled={!editable} onChange={event => setTestContract(event.target.value)} />
          </label>
        ) : null}
        <label className="text-xs text-muted">
          Withdrawal fee ({network.asset})
          <Input inputMode="decimal" value={fee} disabled={!editable} onChange={event => setFee(event.target.value)} />
        </label>
        <label className="text-xs text-muted">
          Smallest withdrawal ({network.asset})
          <Input inputMode="decimal" value={minimum} disabled={!editable} onChange={event => setMinimum(event.target.value)} />
        </label>
      </div>
      {editable && changed ? (
        <Button
          size="sm"
          variant="secondary"
          loading={state.isLoading}
          onClick={() =>
            void update({
              id: network.id,
              confirmations: Number(confirmations),
              double_check_from: doubleCheck.trim(),
              withdrawal_fee: fee.trim(),
              min_withdrawal: minimum.trim(),
              ...(network.contract !== null ? { test_contract: testContract.trim() || null } : {}),
            })
          }
        >
          Save
        </Button>
      ) : null}
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
    </li>
  );
}

/** One chain: its providers in the order Afrippa asks them (move up or down, switch off), their health, its networks. */
function ChainCard({ chain, editable }: { chain: ChainView; editable: boolean }) {
  const [setRoutes, state] = useSetChainRoutesMutation();
  const order = chain.routes.map(route => route.provider);
  const disabled = chain.routes.filter(route => !route.enabled).map(route => route.provider);
  const move = (index: number, by: number) => {
    const next = [...order];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    void setRoutes({ chain: chain.chain, order: next, disabled });
  };
  const toggle = (provider: string, on: boolean) => void setRoutes({ chain: chain.chain, order, disabled: on ? disabled.filter(id => id !== provider) : [...disabled, provider] });
  const solana = chain.family === "solana";
  const ready = (chain.keys.live || chain.keys.test) && chain.routes.some(route => route.enabled && route.configured);
  return (
    <Card>
      <CardHeader
        title={chain.name}
        description={solana ? "Solana addresses come from the signer (next phase): providers here are checked but not used for deposits yet." : `Wallet key: ${chain.keys.live ? "live set" : "live missing"}, ${chain.keys.test ? "sandbox set" : "sandbox missing"}.`}
      />
      <div className="space-y-4 p-5 pt-3 sm:px-6">
        <ol className="space-y-2" aria-label={`${chain.name} providers in order`}>
          {chain.routes.map((route, index) => (
            <li key={route.provider} className={`flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 ${route.configured ? "bg-canvas" : "bg-canvas opacity-60"}`}>
              <span className="w-5 text-sm font-semibold text-muted">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{route.name}</span>
                <span className="flex flex-wrap gap-1.5 text-[11px]">
                  {route.configured ? <Badge tone={route.environment === "live" ? "green" : "amber"}>{route.environment === "live" ? "Main network" : "Test network"}</Badge> : <Badge tone="grey">Not set up</Badge>}
                  {route.lists_deposits ? <Badge tone="blue">Lists deposits</Badge> : null}
                  {route.finds_coin_deposits ? <Badge tone="blue">Finds coin deposits</Badge> : null}
                  {route.webhooks ? <Badge tone="pink">Webhooks</Badge> : null}
                </span>
                {route.last_error ? (
                  <span className="mt-1 block text-xs text-red-700">{route.last_error}</span>
                ) : route.last_block ? (
                  <span className="mt-1 block text-xs text-muted">
                    Block {route.last_block} · {formatRelative(route.checked_at!)}
                  </span>
                ) : null}
              </span>
              {editable ? (
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Move ${route.name} up`} disabled={index === 0 || state.isLoading} onClick={() => move(index, -1)} icon={<ArrowUp className="size-4" aria-hidden="true" />} />
                  <Button size="sm" variant="ghost" aria-label={`Move ${route.name} down`} disabled={index === chain.routes.length - 1 || state.isLoading} onClick={() => move(index, 1)} icon={<ArrowDown className="size-4" aria-hidden="true" />} />
                  <Toggle checked={route.enabled} label={`Use ${route.name} for ${chain.name}`} onChange={on => toggle(route.provider, on)} />
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        {chain.networks.length ? (
          <ul className="space-y-2" aria-label={`${chain.name} networks`}>
            {chain.networks.map(network => (
              <NetworkRow key={network.id} network={network} editable={editable} ready={ready && !solana} />
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Crypto > Chains: for each chain, the blockchain providers Afrippa reads it through, in order (the first that
 * answers is used; a failing one is passed over), their health, and the coins and tokens deposited on it.
 */
export default function ChainsPage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const query = useChainsQuery();
  const [check, checking] = useCheckChainsMutation();
  return (
    <AdminShell section="crypto" current="/crypto/chains" crumbs={[{ label: "Crypto", href: "/crypto" }, { label: "Chains" }]}>
      <PageHeader
        title="Chains"
        description="Providers per chain in the order Afrippa asks them; the next is used when one fails. Large deposits wait until a second provider agrees."
        actions={
          editable ? (
            <Button variant="secondary" icon={<RefreshCw className="size-4" aria-hidden="true" />} loading={checking.isLoading} onClick={() => void check()}>
              Check all providers
            </Button>
          ) : null
        }
      />
      <div className="mt-6 space-y-4">
        <Notice tone="blue">
          Set provider keys and Afrippa&apos;s wallet keys in{" "}
          <AppLink href="/settings/integrations" className="font-semibold underline">
            Settings &gt; Integrations &gt; Blockchain
          </AppLink>
          . A provider with its Sandbox switch on serves sandbox stores on test networks; off, live stores on main networks.
        </Notice>
        <QueryView query={query} loading={<Skeleton className="h-96" />}>
          {list => (
            <div className="grid gap-4 xl:grid-cols-2">
              {list.data.map(chain => (
                <ChainCard key={chain.chain} chain={chain} editable={editable} />
              ))}
            </div>
          )}
        </QueryView>
      </div>
    </AdminShell>
  );
}
