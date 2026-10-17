"use client";

import { Suspense, useEffect, useId, useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  CodeInput,
  DataTable,
  Dialog,
  errorMessage,
  Field,
  formatDateTime,
  Input,
  KeyValue,
  Notice,
  PageHeader,
  QueryView,
  resendWait,
  Select,
  Skeleton,
  StatusBadge,
} from "@bitocard/admin-ui";
import {
  type CoinWithdrawal,
  type CoinWithdrawalAddress,
  type CoinWithdrawalNetworks,
  type CoinWithdrawalPreview,
  type ResellerCoins,
  useAddCoinWithdrawalAddressMutation,
  useCancelCoinWithdrawalMutation,
  useCoinWithdrawalAddressesQuery,
  useCoinWithdrawalNetworksQuery,
  useCoinWithdrawalsQuery,
  useConfirmCoinWithdrawalMutation,
  useCreateCoinWithdrawalMutation,
  usePreviewCoinWithdrawalMutation,
  useRemoveCoinWithdrawalAddressMutation,
  useResendCoinWithdrawalCodeMutation,
  useResellerCoinsQuery,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { coinAmount } from "../shared";
import { choosableCoins, CoinSelect, coinRoles, PremiumNotice, shortHash, useChosenAsset, withdrawalChains, withdrawalInProgress, WithdrawalStatus } from "../coin-parts";

/** Coins typed in: digits with up to the coin's decimal places, above zero. */
const validAmount = (value: string, decimals: number) => new RegExp(`^\\d{1,12}(?:\\.\\d{1,${decimals}})?$`).test(value.trim()) && Number(value) > 0;

const reviewText: Record<string, string> = {
  amount: "it is a large amount",
  unscreened: "the address could not be screened",
  recent_card_top_up: "your wallet was recently topped up by card or mobile money",
};

/**
 * The emailed 6-digit code for a withdrawal. Confirm sends it (never on the sixth digit by itself, so a typo is not
 * spent as an attempt); Resend works once a minute; Cancel gives the coins back. Keyed by the withdrawal, so each
 * one opens fresh.
 */
function CodeDialog({ withdrawal, onClose }: { withdrawal: CoinWithdrawal | null; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [sentAt, setSentAt] = useState<string | null>(withdrawal?.created_at ?? null);
  const [now, setNow] = useState(() => Date.now());
  const [confirm, confirmState] = useConfirmCoinWithdrawalMutation();
  const [resend, resendState] = useResendCoinWithdrawalCodeMutation();
  const [cancel, cancelState] = useCancelCoinWithdrawalMutation();
  const [done, setDone] = useState<CoinWithdrawal | null>(null);
  const open = Boolean(withdrawal);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  if (!withdrawal)
    return (
      <Dialog open={false} onClose={onClose} title="Confirm withdrawal">
        {null}
      </Dialog>
    );
  const wait = resendWait(sentAt, now);
  const error = confirmState.error ?? resendState.error ?? cancelState.error;
  const busy = confirmState.isLoading || resendState.isLoading || cancelState.isLoading;

  if (done) {
    return (
      <Dialog open onClose={onClose} title={done.status === "cancelled" ? "Withdrawal cancelled" : "Withdrawal confirmed"} footer={<Button onClick={onClose}>Done</Button>}>
        <p className="text-sm text-ink">
          {done.status === "cancelled"
            ? `${coinAmount(done.total)} ${done.asset} is back in your coin wallet.`
            : done.status === "review"
              ? `BitoCard reviews this withdrawal before it is sent, because ${reviewText[done.review_reason ?? ""] ?? "it needs a check"}. You will be told when it is decided.`
              : `${coinAmount(done.amount)} ${done.asset} is on its way to ${shortHash(done.address)} on ${done.network}.`}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Enter the emailed code"
      description={`We emailed a 6-digit code to you for ${withdrawal.number}: ${coinAmount(withdrawal.amount)} ${withdrawal.asset} on ${withdrawal.network}. It works for 30 minutes.`}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            loading={cancelState.isLoading}
            onClick={() =>
              void cancel(withdrawal.id)
                .unwrap()
                .then(setDone)
                .catch(() => undefined)
            }
          >
            Cancel withdrawal
          </Button>
          <Button
            disabled={code.length !== 6 || busy}
            loading={confirmState.isLoading}
            onClick={() =>
              void confirm({ id: withdrawal.id, code })
                .unwrap()
                .then(setDone)
                .catch(() => undefined)
            }
          >
            Confirm
          </Button>
        </>
      }
    >
      <form
        onSubmit={event => {
          event.preventDefault();
          if (code.length === 6 && !busy)
            void confirm({ id: withdrawal.id, code })
              .unwrap()
              .then(setDone)
              .catch(() => undefined);
        }}
      >
        <CodeInput value={code} onChange={setCode} label="Withdrawal code" autoFocus invalid={Boolean(confirmState.error)} disabled={busy} />
        <p className="mt-3 break-all text-sm text-muted">
          To {withdrawal.address}. Total {coinAmount(withdrawal.total)} {withdrawal.asset} including the {coinAmount(withdrawal.fee)} {withdrawal.asset} network fee.
        </p>
        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            disabled={wait > 0 || busy}
            loading={resendState.isLoading}
            onClick={() =>
              void resend(withdrawal.id)
                .unwrap()
                .then(() => {
                  setSentAt(new Date().toISOString());
                  setCode("");
                })
                .catch(() => undefined)
            }
          >
            {wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
          </Button>
          {resendState.isSuccess && !resendState.error ? (
            <span role="status" className="ml-3 text-sm font-semibold text-mint-700">
              A new code is on its way.
            </span>
          ) : null}
        </div>
        {error ? (
          <div className="mt-4">
            <Notice tone="red">{errorMessage(error)}</Notice>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Saving an address: owners only (the API's `@Roles()`), usable 24 hours after it is added. Keyed by the chosen network, its default. */
function AddAddress({ chain }: { chain: string }) {
  const id = useId();
  const [network, setNetwork] = useState(chain);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [add, state] = useAddCoinWithdrawalAddressMutation();
  const valid = address.trim().length > 0 && label.trim().length > 0;
  return (
    <form
      className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-3"
      onSubmit={event => {
        event.preventDefault();
        if (!valid) return;
        void add({
          chain: network,
          address: address.trim(),
          label: label.trim(),
        })
          .unwrap()
          .then(() => {
            setAddress("");
            setLabel("");
          })
          .catch(() => undefined);
      }}
    >
      <h3 className="text-sm font-bold text-ink sm:col-span-3">Add an address</h3>
      <Field label="Network" htmlFor={`${id}-chain`}>
        <Select id={`${id}-chain`} value={network} onChange={event => setNetwork(event.target.value)}>
          {withdrawalChains.map(item => (
            <option key={item.chain} value={item.chain}>
              {item.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Address" htmlFor={`${id}-address`}>
        <Input id={`${id}-address`} value={address} onChange={event => setAddress(event.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
      </Field>
      <Field label="Label" htmlFor={`${id}-label`} hint="For example, Treasury wallet">
        <Input id={`${id}-label`} value={label} maxLength={60} onChange={event => setLabel(event.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <Button type="submit" loading={state.isLoading} disabled={!valid}>
          Save address
        </Button>
        {state.isSuccess ? (
          <span role="status" className="text-sm font-semibold text-mint-700">
            Saved. It can be used 24 hours from now; we emailed you about it.
          </span>
        ) : null}
      </div>
      {state.error ? (
        <div className="sm:col-span-3">
          <Notice tone="red">{errorMessage(state.error)}</Notice>
        </div>
      ) : null}
    </form>
  );
}

function Addresses({ addresses, chain }: { addresses: CoinWithdrawalAddress[]; chain: string }) {
  const { membership } = useReseller();
  const owner = can(membership);
  const remover = can(membership, ...coinRoles);
  const [removing, setRemoving] = useState<CoinWithdrawalAddress | null>(null);
  const [remove, state] = useRemoveCoinWithdrawalAddressMutation();
  return (
    <Card>
      <CardHeader
        title="Saved addresses"
        description="Coins can only be sent to an address saved here. A new address can be used 24 hours after it is added, so a stolen sign-in cannot send coins at once."
      />
      <div className="mt-4">
        <DataTable<CoinWithdrawalAddress>
          caption="Saved addresses"
          rows={addresses}
          rowKey={row => row.id}
          empty={owner ? "No addresses yet. Add one below." : "No addresses yet. Your business's owner adds them."}
          columns={[
            {
              key: "label",
              header: "Label",
              cell: row => <span className="font-semibold text-ink">{row.label}</span>,
            },
            { key: "network", header: "Network", cell: row => row.network },
            {
              key: "address",
              header: "Address",
              cell: row => <span className="break-all font-mono text-xs">{row.address}</span>,
            },
            {
              key: "ready",
              header: "Usable",
              cell: row => (row.ready ? <StatusBadge status="ready" label="Ready" /> : <StatusBadge status="pending" label={`From ${formatDateTime(row.usable_from)}`} />),
            },
            ...(remover
              ? [
                  {
                    key: "remove",
                    header: "",
                    align: "right" as const,
                    cell: (row: CoinWithdrawalAddress) => (
                      <Button variant="ghost" onClick={() => setRemoving(row)}>
                        Remove
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
        {owner ? (
          <div className="px-5 pb-5 sm:px-6">
            <AddAddress key={chain} chain={chain} />
          </div>
        ) : null}
      </div>
      <Dialog
        open={Boolean(removing)}
        onClose={() => {
          setRemoving(null);
          state.reset();
        }}
        title="Remove this address?"
        description={removing ? `${removing.label} (${removing.network}). Adding it again starts a new 24-hour wait.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={state.isLoading}
              onClick={() =>
                removing &&
                void remove(removing.id)
                  .unwrap()
                  .then(() => setRemoving(null))
                  .catch(() => undefined)
              }
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="break-all font-mono text-sm">{removing?.address}</p>
        {state.error ? (
          <div className="mt-4">
            <Notice tone="red">{errorMessage(state.error)}</Notice>
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}

function WithdrawForm({
  asset,
  decimals,
  available,
  networks,
  addresses,
  onAsked,
}: {
  asset: string;
  decimals: number;
  available: string;
  networks: CoinWithdrawalNetworks;
  addresses: CoinWithdrawalAddress[];
  onAsked: (withdrawal: CoinWithdrawal) => void;
}) {
  const id = useId();
  const { membership } = useReseller();
  const allowed = can(membership, ...coinRoles);
  const [chain, setChain] = useState(networks.data[0]?.chain ?? "");
  const network = networks.data.find(item => item.chain === chain) ?? networks.data[0];
  const usable = addresses.filter(item => item.chain === network?.chain);
  const [addressId, setAddressId] = useState("");
  const address = usable.find(item => item.id === addressId && item.ready) ?? usable.find(item => item.ready);
  const [amount, setAmount] = useState("");
  const [preview, previewState] = usePreviewCoinWithdrawalMutation();
  const [create, createState] = useCreateCoinWithdrawalMutation();
  const [quote, setQuote] = useState<CoinWithdrawalPreview | null>(null);
  const valid = Boolean(network && address && validAmount(amount, decimals));
  const input =
    network && address
      ? {
          asset,
          chain: network.chain,
          address_id: address.id,
          amount: amount.trim(),
        }
      : null;
  // A quote is only for what it was asked with.
  const current = quote && input && quote.chain === input.chain && quote.address === address?.address && Number(quote.amount) === Number(input.amount) ? quote : null;

  if (!network) return <Notice tone="amber">{asset} withdrawals are not open on any network now.</Notice>;
  return (
    <form
      className="space-y-4"
      onSubmit={event => {
        event.preventDefault();
        if (!valid || !input) return;
        createState.reset();
        void preview(input)
          .unwrap()
          .then(setQuote)
          .catch(() => setQuote(null));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Network" htmlFor={`${id}-network`} hint={`Fee ${coinAmount(network.fee)} ${asset} · smallest ${coinAmount(network.minimum)} ${asset}`}>
          <Select id={`${id}-network`} value={network.chain} onChange={event => setChain(event.target.value)}>
            {networks.data.map(item => (
              <option key={item.chain} value={item.chain}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="To address"
          htmlFor={`${id}-address`}
          hint={usable.length && !address ? "Your addresses on this network are not usable yet." : !usable.length ? "Save an address on this network first." : undefined}
        >
          <Select id={`${id}-address`} value={address?.id ?? ""} disabled={!usable.length} onChange={event => setAddressId(event.target.value)}>
            {usable.length ? null : <option value="">No saved address</option>}
            {usable.map(item => (
              <option key={item.id} value={item.id} disabled={!item.ready}>
                {item.label}
                {item.ready ? "" : ` (from ${formatDateTime(item.usable_from)})`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Amount (${asset})`} htmlFor={`${id}-amount`} hint={`In your wallet: ${coinAmount(available)} ${asset}`}>
          <Input id={`${id}-amount`} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" />
        </Field>
      </div>
      <p className="text-sm text-muted">
        You can withdraw up to {coinAmount(networks.daily_limit)} {asset} in 24 hours; {coinAmount(networks.remaining_today)} {asset} is left.
      </p>
      {allowed ? (
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant={current ? "secondary" : "primary"} loading={previewState.isLoading} disabled={!valid}>
            Preview
          </Button>
          {current ? (
            <Button
              type="button"
              loading={createState.isLoading}
              onClick={() =>
                input &&
                void create(input)
                  .unwrap()
                  .then(withdrawal => {
                    setQuote(null);
                    setAmount("");
                    onAsked(withdrawal);
                  })
                  .catch(() => undefined)
              }
            >
              Ask for withdrawal
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">Only owners, admins and finance members can withdraw coins.</p>
      )}
      {current ? (
        <div className="rounded-xl border border-line bg-canvas p-4">
          <KeyValue
            items={[
              {
                label: "They receive",
                value: `${coinAmount(current.amount)} ${asset}`,
              },
              {
                label: "Network fee",
                value: `${coinAmount(current.fee)} ${asset}`,
              },
              {
                label: "Taken from your wallet",
                value: <span className="font-semibold">{`${coinAmount(current.total)} ${asset}`}</span>,
              },
              {
                label: "To",
                value: <span className="break-all font-mono text-xs">{current.address}</span>,
              },
            ]}
          />
          <p className="mt-3 text-sm text-muted">
            Asking takes the coins out of your wallet and emails you a 6-digit code to confirm.
            {current.needs_approval ? " BitoCard reviews this withdrawal before it is sent." : ""}
          </p>
        </div>
      ) : null}
      {previewState.error || createState.error ? <Notice tone="red">{errorMessage(createState.error ?? previewState.error)}</Notice> : null}
    </form>
  );
}

function Withdrawals({ onEnterCode }: { onEnterCode: (withdrawal: CoinWithdrawal) => void }) {
  const { membership } = useReseller();
  const allowed = can(membership, ...coinRoles);
  const [polling, setPolling] = useState(false);
  const list = useCoinWithdrawalsQuery(undefined, {
    pollingInterval: polling ? 15_000 : 0,
    skipPollingIfUnfocused: true,
  });
  const rows = list.data?.data;
  const moving = Boolean(rows?.some(row => withdrawalInProgress(row.status)));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling follows the fetched list
    setPolling(moving);
  }, [moving]);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = rows?.find(row => row.id === openId) ?? null;
  return (
    <Card>
      <CardHeader title="Withdrawals" description="Newest first. Choose one to see its transaction." />
      <div className="mt-4">
        <DataTable<CoinWithdrawal>
          caption="Withdrawals"
          rows={rows}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          onRetry={() => void list.refetch()}
          rowKey={row => row.id}
          empty="No withdrawals yet."
          onRowClick={row => setOpenId(current => (current === row.id ? null : row.id))}
          columns={[
            {
              key: "number",
              header: "Withdrawal",
              cell: row => <span className="font-semibold text-ink">{row.number}</span>,
            },
            {
              key: "amount",
              header: "Amount",
              align: "right",
              cell: row => (
                <span className="tabular-nums">
                  {coinAmount(row.amount)} {row.asset}
                </span>
              ),
            },
            {
              key: "network",
              header: "Network",
              hideOnMobile: true,
              cell: row => row.network,
            },
            {
              key: "status",
              header: "Status",
              cell: row => <WithdrawalStatus status={row.status} />,
            },
            {
              key: "date",
              header: "Asked",
              hideOnMobile: true,
              cell: row => formatDateTime(row.created_at),
            },
            {
              key: "action",
              header: "",
              align: "right",
              cell: row =>
                row.status === "awaiting_code" && allowed ? (
                  <Button
                    variant="secondary"
                    onClick={event => {
                      event.stopPropagation();
                      onEnterCode(row);
                    }}
                  >
                    Enter code
                  </Button>
                ) : null,
            },
          ]}
        />
      </div>
      {opened ? (
        <div className="border-t border-line px-5 py-5 sm:px-6" aria-live="polite">
          <h3 className="text-sm font-bold text-ink">{opened.number}</h3>
          <KeyValue
            className="mt-3"
            items={[
              {
                label: "To",
                value: <span className="break-all font-mono text-xs">{opened.address}</span>,
              },
              { label: "Network", value: opened.network },
              {
                label: "Network fee",
                value: `${coinAmount(opened.fee)} ${opened.asset}`,
              },
              {
                label: "Total from your wallet",
                value: `${coinAmount(opened.total)} ${opened.asset}`,
              },
              {
                label: "Transaction",
                value: opened.tx_hash ? <span className="break-all font-mono text-xs">{opened.tx_hash}</span> : "Not sent yet",
              },
              { label: "Confirmations", value: opened.confirmations },
              ...(opened.review_reason
                ? [
                    {
                      label: "Reviewed because",
                      value: reviewText[opened.review_reason] ?? opened.review_reason,
                    },
                  ]
                : []),
              {
                label: "Completed",
                value: formatDateTime(opened.completed_at),
              },
            ]}
          />
        </div>
      ) : null}
    </Card>
  );
}

function Withdraw({ coins }: { coins: ResellerCoins }) {
  const offered = choosableCoins(coins, "withdraw");
  const asset = useChosenAsset(offered);
  const coin = offered.find(item => item.asset === asset);
  const networks = useCoinWithdrawalNetworksQuery(asset ?? "", {
    skip: !coins.onchain || !asset,
  });
  const addresses = useCoinWithdrawalAddressesQuery(undefined, {
    skip: !coins.onchain,
  });
  const [asking, setAsking] = useState<CoinWithdrawal | null>(null);
  const firstChain = networks.data?.data[0]?.chain ?? withdrawalChains[0]!.chain;
  if (!coins.onchain) return <PremiumNotice />;
  if (!asset || !coin) return <Notice tone="amber">No coins can be withdrawn now.</Notice>;
  return (
    <div className="space-y-4">
      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-bold text-ink">Withdraw coins</h2>
        <p className="mt-1 text-sm text-muted">Send coins from your BitoCard coin wallet to one of your saved addresses. A 6-digit code is emailed to you to confirm.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <CoinSelect coins={offered} value={asset} path="/exchange/withdraw" />
        </div>
        <div className="mt-4">
          {networks.error && !networks.data ? (
            <Notice tone="amber">{errorMessage(networks.error)}</Notice>
          ) : networks.data && addresses.data ? (
            <WithdrawForm key={asset} asset={asset} decimals={coin.decimals} available={coin.available} networks={networks.data} addresses={addresses.data.data} onAsked={setAsking} />
          ) : addresses.error ? (
            <Notice tone="amber">{errorMessage(addresses.error)}</Notice>
          ) : (
            <Skeleton className="h-28 w-full" />
          )}
        </div>
      </Card>
      {addresses.data ? <Addresses addresses={addresses.data.data} chain={firstChain} /> : null}
      <Withdrawals onEnterCode={setAsking} />
      <CodeDialog key={asking?.id ?? "closed"} withdrawal={asking} onClose={() => setAsking(null)} />
    </div>
  );
}

/** Withdrawing the business's own coins on chain (Premium), confirmed with an emailed code. */
export default function ExchangeWithdrawPage() {
  const coins = useResellerCoinsQuery();
  return (
    <ShqShell section="exchange" current="/exchange/withdraw" crumbs={[{ label: "Exchange", href: "/exchange" }, { label: "Coins", href: "/exchange/coins" }, { label: "Withdraw" }]}>
      <PageHeader title="Withdraw" description="Send your coins on chain, in this mode." />
      <div className="mt-6">
        <QueryView query={coins} loading={<Skeleton className="h-72 w-full" />}>
          {data => (
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <Withdraw coins={data} />
            </Suspense>
          )}
        </QueryView>
      </div>
    </ShqShell>
  );
}
