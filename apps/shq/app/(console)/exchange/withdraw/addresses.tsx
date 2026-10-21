"use client";

import { useId, useState } from "react";
import { Button, Card, CardHeader, DataTable, Dialog, errorMessage, Field, formatDateTime, Input, Notice, Select, StatusBadge } from "@bitocard/admin-ui";
import { type CoinWithdrawalAddress, type ResellerCoins, useAddCoinWithdrawalAddressMutation, useRemoveCoinWithdrawalAddressMutation } from "@bitocard/api-client/reseller";
import { can, useReseller } from "@/components/reseller";
import { coinRoles } from "../coin-parts";

/** Saving an address: owners only (the API's `@Roles()`), usable 24 hours after it is added. Keyed by the chosen network, its default. */
function AddAddress({ chain, chains }: { chain: string; chains: ResellerCoins["withdrawal_chains"] }) {
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
          {chains.map(item => (
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

export function Addresses({ addresses, chain, chains }: { addresses: CoinWithdrawalAddress[]; chain: string; chains: ResellerCoins["withdrawal_chains"] }) {
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
            <AddAddress key={chain} chain={chain} chains={chains} />
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
