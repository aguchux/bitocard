"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { Badge, Button, Field, Input, Notice, Select, errorMessage, formatBps, formatMoney, type Tone, useDebouncedValue } from "@bitocard/admin-ui";
import {
  type ResaleAccount,
  type ResaleListing,
  type ResaleOrderStatus,
  type ResalePrice,
  type ResaleState,
  resaleOrderStatusText,
  resaleStateText,
  useResalePricePreviewQuery,
  useSetResaleNoteMutation,
  useClearResaleNoteMutation,
} from "@bitocard/api-client/reseller";

const stateTones: Record<ResaleState, Tone> = {
  selling: "green",
  paused: "grey",
  removed: "grey",
  supplier_stopped: "red",
  unavailable: "red",
  supplier_paused: "amber",
  sold_out: "amber",
  price_out_of_range: "amber",
};

export function ResaleStateBadge({ state }: { state: ResaleState }) {
  return <Badge tone={stateTones[state]}>{resaleStateText[state]}</Badge>;
}

const orderTones: Record<ResaleOrderStatus, Tone> = {
  locked: "amber",
  paid: "blue",
  sent: "blue",
  disputed: "red",
  released: "green",
  refunded: "grey",
  partly_refunded: "grey",
  declined: "grey",
  cancelled: "grey",
  lapsed: "grey",
};

export function ResaleOrderBadge({ status }: { status: ResaleOrderStatus }) {
  return <Badge tone={orderTones[status]}>{resaleOrderStatusText[status]}</Badge>;
}

const gateText: Record<NonNullable<ResaleAccount["reason"]>, string> = {
  switch_off: "Reselling BitoCard Shop listings is not open to your account yet.",
  house_account: "BitoCard’s own stores do not resell listings.",
  not_verified: "Finish your identity check (Settings › Identity check) to resell listings.",
  no_country: "Choose your business country in Settings first.",
  resale_closed: "Reselling is not open in your country yet.",
};

/** Why the reseller cannot resell, or that they need a Resale shop store; nothing once both are fine. */
export function ResaleGate({ account }: { account: ResaleAccount | undefined }) {
  if (!account) return null;
  if (!account.available) {
    return (
      <Notice tone="grey" title="Reselling is not available">
        {account.reason ? gateText[account.reason] : "Reselling is not available."}
      </Notice>
    );
  }
  if (!account.stores.length) {
    return (
      <Notice tone="amber" title="You need a Resale shop store">
        Resale listings are sold on a store using the Resale shop template. <Link href="/store/new" className="font-semibold text-brand-600 hover:underline">Create one</Link> to start.
      </Notice>
    );
  }
  return null;
}

/** "15" or "-2.5" (percent) as basis points, or null. */
export function signedPercentToBps(text: string) {
  const match = /^\s*(-)?(\d{1,3})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  const value = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -value : value;
}

/** "12500" or "12,500.50" in the main unit as minor units, or null. */
export function moneyToMinor(text: string) {
  const match = /^\s*(\d{1,12})(?:\.(\d{1,2}))?\s*$/.exec(text.replace(/,/g, ""));
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
}

export type PriceChoice = { markup_bps: number | null; fixed_price: number | null };

/** What one sale gives, for the reseller: their price, margin, BitoCard's fee and their earnings, and the buyer's total. */
export function PriceSummary({ price }: { price: ResalePrice | ResaleListing }) {
  const rows: Array<[string, string]> = [
    ["Your price", formatMoney(price.price, price.currency)],
    ["You may sell from", `${formatMoney(price.price_range.min, price.currency)} to ${formatMoney(price.price_range.max, price.currency)}`],
    ["Your margin", formatMoney(price.margin, price.currency)],
    ["BitoCard’s fee", formatMoney(price.reseller_fee, price.currency)],
    ["You keep per sale", formatMoney(price.earnings, price.currency)],
  ];
  if ("buyer_pays" in price) rows.push(["The buyer pays (with their Safe pay fee)", formatMoney(price.buyer_pays, price.currency)]);
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-xl bg-canvas p-4 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 sm:block">
          <dt className="text-muted">{label}</dt>
          <dd className="font-semibold text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The reseller's price: a markup that follows the supplier's price, or a fixed price, with a live preview of what one
 * sale would give. `onSubmit` gets exactly one of the two.
 */
export function PriceEditor({
  listingId,
  currency,
  supplierPrice,
  discountBps,
  floorBps,
  markupMaxBps,
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
}: {
  listingId: string;
  currency: string;
  supplierPrice: number;
  discountBps: number;
  floorBps: number;
  markupMaxBps: number;
  initial?: PriceChoice;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (choice: PriceChoice) => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<"markup" | "fixed">(initial?.fixed_price ? "fixed" : "markup");
  const [markup, setMarkup] = useState(initial?.markup_bps !== null && initial?.markup_bps !== undefined ? String(initial.markup_bps / 100) : String(Math.round(markupMaxBps / 200)));
  const [fixed, setFixed] = useState(initial?.fixed_price ? String(initial.fixed_price / 100) : String(supplierPrice / 100));
  const markupBps = signedPercentToBps(markup);
  const fixedMinor = moneyToMinor(fixed);
  const choice: PriceChoice = kind === "markup" ? { markup_bps: markupBps, fixed_price: null } : { markup_bps: null, fixed_price: fixedMinor };
  const valid = kind === "markup" ? markupBps !== null && markupBps >= -floorBps && markupBps <= markupMaxBps : fixedMinor !== null && fixedMinor > 0;
  // A string, so the debounce settles (a new object every render never would).
  const debounced = JSON.parse(useDebouncedValue(JSON.stringify(choice), 300)) as PriceChoice;
  const preview = useResalePricePreviewQuery(
    { listing_id: listingId, ...(debounced.markup_bps !== null ? { markup_bps: debounced.markup_bps } : {}), ...(debounced.fixed_price !== null ? { fixed_price: debounced.fixed_price } : {}) },
    { skip: !valid },
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onSubmit(choice);
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-muted">
        The supplier’s price is {formatMoney(supplierPrice, currency)}. You earn {formatBps(discountBps)} off it and may sell up to {formatBps(markupMaxBps)} above it
        {floorBps ? `, or down to ${formatBps(floorBps)} below it under your deal` : ""}.
      </p>
      <Field label="How you price it" htmlFor={`${id}-kind`}>
        <Select id={`${id}-kind`} value={kind} onChange={event => setKind(event.target.value as "markup" | "fixed")}>
          <option value="markup">A markup over the supplier’s price (follows it)</option>
          <option value="fixed">A fixed price</option>
        </Select>
      </Field>
      {kind === "markup" ? (
        <Field label="Markup (%)" htmlFor={`${id}-markup`} hint={`From ${formatBps(-floorBps)} to ${formatBps(markupMaxBps)}.`} error={markup && !valid ? "Outside the supplier’s limits." : undefined}>
          <Input id={`${id}-markup`} inputMode="decimal" value={markup} onChange={event => setMarkup(event.target.value)} />
        </Field>
      ) : (
        <Field label={`Your price (${currency})`} htmlFor={`${id}-fixed`} hint="Checked against the limits again whenever the supplier’s price or your deal changes.">
          <Input id={`${id}-fixed`} inputMode="decimal" value={fixed} onChange={event => setFixed(event.target.value)} />
        </Field>
      )}
      {preview.data && valid ? (
        preview.data.in_range ? (
          <PriceSummary price={preview.data} />
        ) : (
          <Notice tone="amber">Outside the supplier’s limits.</Notice>
        )
      ) : preview.error && valid ? (
        <Notice tone="amber">{errorMessage(preview.error)}</Notice>
      ) : null}
      {error ? <Notice tone="red">{error}</Notice> : null}
      <Button type="submit" loading={busy} disabled={!valid || (preview.data ? !preview.data.in_range : false)}>
        {submitLabel}
      </Button>
    </form>
  );
}

const noteStatus: Record<string, { tone: Tone; label: string }> = {
  pending: { tone: "amber", label: "Waiting for the supplier" },
  approved: { tone: "green", label: "Approved: shown on your store" },
  refused: { tone: "red", label: "Refused by the supplier" },
  withdrawn: { tone: "grey", label: "Approval withdrawn" },
};

/** The reseller's one note: plain text, shown only once the supplier approves this exact text. */
export function NoteEditor({ listing, canEdit }: { listing: ResaleListing; canEdit: boolean }) {
  const id = useId();
  // The page keys this editor by the saved note, so a saved change starts it afresh.
  const [text, setText] = useState(listing.note?.text ?? "");
  const [save, saving] = useSetResaleNoteMutation();
  const [clear, clearing] = useClearResaleNoteMutation();
  const status = listing.note ? noteStatus[listing.note.status] : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) void save({ id: listing.id, note: text.trim() });
  };
  return (
    <div className="space-y-3">
      {listing.note && status ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {listing.note.reason ? <span className="text-sm text-muted">“{listing.note.reason}”</span> : null}
        </div>
      ) : null}
      {canEdit ? (
        <form className="space-y-3" onSubmit={submit}>
          <Field label="Your note" htmlFor={`${id}-note`} hint={`${text.trim().length}/140. Plain words only: no links, phone numbers, email addresses or handles. Any change asks the supplier again.`}>
            <Input id={`${id}-note`} maxLength={140} value={text} onChange={event => setText(event.target.value)} placeholder="Free wall bracket with every order this month." />
          </Field>
          {saving.error ? <Notice tone="red">{errorMessage(saving.error)}</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saving.isLoading} disabled={!text.trim() || text.trim() === listing.note?.text}>
              Send to the supplier
            </Button>
            {listing.note ? (
              <Button type="button" variant="secondary" loading={clearing.isLoading} onClick={() => void clear(listing.id)}>
                Remove note
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
