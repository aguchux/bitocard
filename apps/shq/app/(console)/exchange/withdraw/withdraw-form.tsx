"use client";

import { useId, useState } from "react";
import { Button, errorMessage, Field, formatDateTime, Input, KeyValue, Notice, Select } from "@bitocard/admin-ui";
import { type CoinWithdrawal, type CoinWithdrawalAddress, type CoinWithdrawalNetworks, type CoinWithdrawalPreview, useCreateCoinWithdrawalMutation, usePreviewCoinWithdrawalMutation } from "@bitocard/api-client/reseller";
import { can, useReseller } from "@/components/reseller";
import { coinAmount } from "../shared";
import { validAmount } from "./amounts";
import { coinRoles } from "../coin-parts";

export function WithdrawForm({
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
