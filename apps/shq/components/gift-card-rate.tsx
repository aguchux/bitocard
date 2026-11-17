"use client";

import { useId, useState } from "react";
import { bpsToPercent, Button, Dialog, errorMessage, Field, formatBps, formatMoney, Input, Notice, percentToBps, Select, Skeleton, useDebouncedValue } from "@bitocard/admin-ui";
import { type Product, usePricePreviewQuery, useRemoveMarkupMutation, useSetListingMutation, useSetMarkupMutation } from "@bitocard/api-client/reseller";

const from = { product: "this card", category: "your gift card markup", general: "your general markup", none: "no markup set" } as const;

/** One unit of a currency: "£1", "$1". */
const oneUnit = (currency: string) => formatMoney(100, currency).replace(/[.,]00$/, "");

type Choice = "inherit" | "own";

/**
 * Gift cards are sold by rate: the card keeps its face value, BitoCard sells it to you at its rate per unit of the
 * card's currency, and you add your markup on that rate for your customers. Shows both rates and what each value of
 * the card comes to; never BitoCard's suppliers or costs.
 */
export function GiftCardRateDialog({ product, open, onClose, manage }: { product: Product; open: boolean; onClose: () => void; manage: boolean }) {
  const id = useId();
  const face = product.pricing.denominations[0]?.face_value;
  const [choice, setChoice] = useState<Choice | null>(null);
  const [markup, setMarkup] = useState("");
  const markupBps = percentToBps(markup);
  const current = usePricePreviewQuery({ id: product.id, face_value: face }, { skip: !open || !face });
  const productSetting = current.data?.settings.from.markup === "product";
  const shownChoice: Choice = choice ?? (productSetting ? "own" : "inherit");
  const trying = shownChoice === "own" && markupBps !== null;
  const args = useDebouncedValue({ id: product.id, face_value: face, ...(trying ? { markup_bps: markupBps } : {}) });
  const preview = usePricePreviewQuery(args, { skip: !open || !face || !trying });
  const [save, saveState] = useSetMarkupMutation();
  const [remove, removeState] = useRemoveMarkupMutation();
  const [setListing, listState] = useSetListingMutation();
  const data = (trying ? preview.data : null) ?? current.data;
  const rate = data?.rate ?? null;
  const capPercent = data ? data.markup_cap_bps / 100 : 100;
  const invalid = shownChoice === "own" && markup !== "" && (markupBps === null || markupBps > capPercent * 100);
  const money = (minor: number | null | undefined) => (minor === null || minor === undefined || !data ? "—" : formatMoney(minor, data.currency));
  const rateText = (value: number | null | undefined) => (value === null || value === undefined || !data ? "—" : `${formatMoney(value, data.currency)} per ${oneUnit(product.face_currency)}`);

  const persist = async () => {
    if (shownChoice === "inherit") {
      if (productSetting) await remove({ product_id: product.id }).unwrap();
      return;
    }
    if (markupBps !== null) await save({ product_id: product.id, markup_bps: markupBps }).unwrap();
  };
  const finish = async (listed?: boolean) => {
    try {
      await persist();
      if (listed !== undefined) await setListing({ listed, product_ids: [product.id] }).unwrap();
      onClose();
    } catch {
      // The error is shown in the dialog.
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${product.listed ? "Your rate for" : "List"} ${product.name}`}
      description="Gift cards are sold by rate: the card keeps its face value, and your customers pay it at BitoCard’s rate plus your markup."
      footer={
        manage ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="secondary" disabled={invalid} loading={saveState.isLoading || removeState.isLoading} onClick={() => void finish()}>
              Save rate
            </Button>
            <Button disabled={invalid} loading={listState.isLoading} onClick={() => void finish(!product.listed)}>
              {product.listed ? "Save and unlist" : "Save and list on my store"}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {saveState.error || removeState.error || listState.error ? <Notice tone="red">{errorMessage(saveState.error ?? removeState.error ?? listState.error)}</Notice> : null}
        {current.error ? <Notice tone="red">{errorMessage(current.error)}</Notice> : null}
        {!data ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-canvas p-4">
                <p className="text-xs uppercase tracking-wide text-muted">BitoCard’s rate to you</p>
                <p className="mt-1 text-xl font-bold text-ink">{rateText(rate?.bitocard_rate)}</p>
              </div>
              <div className="rounded-xl bg-brand-50 p-4">
                <p className="text-xs uppercase tracking-wide text-brand-700">Your rate to customers</p>
                <p className="mt-1 text-xl font-bold text-ink">{rateText(rate?.customer_rate)}</p>
                <p className="text-xs text-muted">
                  {rate?.bitocard_rate !== null && rate?.bitocard_rate !== undefined && rate.customer_rate !== null
                    ? `You make ${formatMoney(Math.round(rate.customer_rate - rate.bitocard_rate), data.currency)} per ${oneUnit(product.face_currency)}`
                    : null}
                </p>
              </div>
            </div>

            {manage ? (
              <>
                <Field label="Your markup" htmlFor={`${id}-choice`} hint={`Now ${formatBps(data.settings.markup_bps)}, from ${from[data.settings.from.markup]}. Set your gift card markup for every card on Pricing.`}>
                  <Select id={`${id}-choice`} value={shownChoice} onChange={event => setChoice(event.target.value as Choice)}>
                    <option value="inherit">Use my gift card markup</option>
                    <option value="own">Set a markup for this card</option>
                  </Select>
                </Field>
                {shownChoice === "own" ? (
                  <Field label="Your markup on BitoCard’s rate (%)" htmlFor={`${id}-markup`} hint={`0 to ${capPercent}.`}>
                    <Input id={`${id}-markup`} inputMode="decimal" placeholder={bpsToPercent(data.settings.markup_bps)} value={markup} onChange={event => setMarkup(event.target.value)} />
                  </Field>
                ) : null}
                {invalid ? <Notice tone="amber">{`Enter a markup from 0 to ${capPercent}%.`}</Notice> : null}
              </>
            ) : null}

            {rate?.values.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">What each value of the card comes to</caption>
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th scope="col" className="py-1 pr-3 font-medium">Card</th>
                      <th scope="col" className="py-1 pr-3 text-right font-medium">You pay</th>
                      <th scope="col" className="py-1 pr-3 text-right font-medium">Customer pays</th>
                      <th scope="col" className="py-1 text-right font-medium">You make</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rate.values.map(row => (
                      <tr key={row.face_value}>
                        <td className="py-1.5 pr-3 font-medium">{formatMoney(row.face_value, product.face_currency)}</td>
                        <td className="py-1.5 pr-3 text-right">{money(row.bitocard_price)}</td>
                        <td className="py-1.5 pr-3 text-right">{money(row.customer_price)}</td>
                        <td className="py-1.5 text-right font-semibold text-green-700">{money(row.your_profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
        <p className="text-xs text-muted">Before any tax added at checkout. Rates follow exchange rates; a quote locks the exact price for 10 minutes.</p>
      </div>
    </Dialog>
  );
}
