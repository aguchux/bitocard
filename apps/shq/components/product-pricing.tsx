"use client";

import { useId, useState } from "react";
import {
  amountToMinor,
  bpsToPercent,
  Button,
  Dialog,
  errorMessage,
  Field,
  formatBps,
  formatMoney,
  Input,
  Notice,
  percentToBps,
  PriceBreakdown,
  Select,
  Skeleton,
  useDebouncedValue,
} from "@bitocard/admin-ui";
import { type Product, usePricePreviewQuery, useSetListingMutation, useSetMarkupMutation } from "@bitocard/api-client/reseller";

const from = { product: "this product", category: "your category setting", general: "your general setting", none: "no setting" } as const;

/**
 * Pricing a product while listing it: what BitoCard charges, what the customer pays and what you make per sale, live
 * as you change your discount or markup. Discount products sell at face value at most (you choose how much of your
 * discount your customer gets); markup products take your markup or a fixed price.
 */
export function ProductPricingDialog({ product, open, onClose, manage }: { product: Product; open: boolean; onClose: () => void; manage: boolean }) {
  const id = useId();
  const values = product.pricing.denominations.map(item => item.face_value);
  const [face, setFace] = useState(values[0] ?? 0);
  const [customerDiscount, setCustomerDiscount] = useState("");
  const [markupMode, setMarkupMode] = useState<"markup" | "fixed" | "">("");
  const [markup, setMarkup] = useState("");
  const [fixed, setFixed] = useState("");
  const current = usePricePreviewQuery({ id: product.id, face_value: face || undefined }, { skip: !open || !face });
  const scheme = current.data?.scheme;
  const trial = useDebouncedValue({
    id: product.id,
    face_value: face || undefined,
    ...(scheme === "discount" && percentToBps(customerDiscount) !== null ? { customer_discount_bps: percentToBps(customerDiscount)! } : {}),
    ...(scheme === "markup" && markupMode === "markup" && percentToBps(markup) !== null ? { markup_bps: percentToBps(markup)! } : {}),
    ...(scheme === "markup" && markupMode === "fixed" && amountToMinor(fixed) !== null ? { fixed_price: amountToMinor(fixed)! } : {}),
  });
  const preview = usePricePreviewQuery(trial, { skip: !open || !face });
  const [save, saveState] = useSetMarkupMutation();
  const [setListing, listState] = useSetListingMutation();
  const data = preview.data ?? current.data;
  const money = (minor: number | null | undefined) => (minor === null || minor === undefined || !data ? "—" : formatMoney(minor, data.currency));
  const capPercent = data ? data.markup_cap_bps / 100 : 100;
  const discountBps = percentToBps(customerDiscount);
  const markupBps = percentToBps(markup);
  const fixedMinor = amountToMinor(fixed);
  const invalid =
    (customerDiscount !== "" && discountBps === null) ||
    (markupMode === "markup" && (markupBps === null || markupBps > capPercent * 100)) ||
    (markupMode === "fixed" && (fixedMinor === null || fixedMinor <= 0));

  const persist = async () => {
    const body =
      scheme === "discount"
        ? customerDiscount === ""
          ? null
          : { customer_discount_bps: discountBps }
        : markupMode === "markup"
          ? { markup_bps: markupBps, fixed_price: null }
          : markupMode === "fixed"
            ? { fixed_price: fixedMinor }
            : null;
    if (body) await save({ product_id: product.id, ...body }).unwrap();
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
      title={`${product.listed ? "Your pricing for" : "List"} ${product.name}`}
      description="See what BitoCard charges you and what you make per sale. Changes show at once; nothing is saved until you choose."
      footer={
        manage ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="secondary" disabled={invalid} loading={saveState.isLoading} onClick={() => void finish()}>
              Save pricing
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
        {saveState.error || listState.error ? <Notice tone="red">{errorMessage(saveState.error ?? listState.error)}</Notice> : null}
        {values.length > 1 ? (
          <Field label={`Face value (${product.face_currency})`} htmlFor={`${id}-face`}>
            <Select id={`${id}-face`} value={String(face)} onChange={event => setFace(Number(event.target.value))}>
              {values.map(value => (
                <option key={value} value={value}>
                  {formatMoney(value, product.face_currency)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {!data ? (
          <Skeleton className="h-56 w-full" />
        ) : data.scheme === "discount" ? (
          <>
            <Notice tone="green" title="A discount product">
              {`Customers never pay more than face value. BitoCard sells it to you ${money(data.your_discount)} below face value: that is your profit, unless you give part of it to your customer.`}
            </Notice>
            {manage ? (
              <Field
                label="Give your customer (% of face value)"
                htmlFor={`${id}-discount`}
                hint={`Now ${formatBps(data.settings.customer_discount_bps)}, from ${from[data.settings.from.customer_discount]}. At most your own discount.`}
              >
                <Input id={`${id}-discount`} inputMode="decimal" placeholder={bpsToPercent(data.settings.customer_discount_bps)} value={customerDiscount} onChange={event => setCustomerDiscount(event.target.value)} />
              </Field>
            ) : null}
            <PriceBreakdown
              caption="One sale"
              rows={[
                { label: "Face value", value: money(data.face_price) },
                { label: "BitoCard charges you", value: money(data.bitocard_price) },
                { label: "Your discount", value: money(data.your_discount), tone: "muted" },
                { label: "You give your customer", value: money(data.customer_discount), tone: "muted" },
                { label: "Your customer pays", value: money(data.customer_price) },
                { label: "You make per sale", value: money(data.your_profit), tone: "profit" },
              ]}
            />
          </>
        ) : (
          <>
            <Notice tone="blue" title="A markup product">
              Add your markup to BitoCard’s price, or set a fixed price for your customers.
            </Notice>
            {manage ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="How you price it" htmlFor={`${id}-mode`} hint={data.settings.fixed_price !== null ? "Now a fixed price." : `Now a ${formatBps(data.settings.markup_bps)} markup, from ${from[data.settings.from.markup]}.`}>
                  <Select id={`${id}-mode`} value={markupMode} onChange={event => setMarkupMode(event.target.value as typeof markupMode)}>
                    <option value="">Keep as it is</option>
                    <option value="markup">A markup (%)</option>
                    <option value="fixed">A fixed price</option>
                  </Select>
                </Field>
                {markupMode === "markup" ? (
                  <Field label="Your markup (%)" htmlFor={`${id}-markup`} hint={`0 to ${capPercent}.`}>
                    <Input id={`${id}-markup`} inputMode="decimal" value={markup} onChange={event => setMarkup(event.target.value)} />
                  </Field>
                ) : markupMode === "fixed" ? (
                  <Field label={`Your customer pays (${data.currency})`} htmlFor={`${id}-fixed`}>
                    <Input id={`${id}-fixed`} inputMode="decimal" value={fixed} onChange={event => setFixed(event.target.value)} />
                  </Field>
                ) : null}
              </div>
            ) : null}
            {data.fixed_below_cost ? <Notice tone="amber">Your fixed price is below BitoCard’s price, so customers pay BitoCard’s price and you make nothing. Raise it.</Notice> : null}
            <PriceBreakdown
              caption="One sale"
              rows={[
                { label: "BitoCard charges you", value: money(data.bitocard_price) },
                { label: data.settings.fixed_price !== null ? "Your fixed price" : `Your markup (${formatBps(data.settings.markup_bps)})`, value: money(data.customer_price - data.bitocard_price), tone: "muted" },
                { label: "Your customer pays", value: money(data.customer_price) },
                { label: "You make per sale", value: money(data.your_profit), tone: data.fixed_below_cost ? "warning" : "profit" },
              ]}
            />
          </>
        )}
        <p className="text-xs text-muted">Before any tax added at checkout. Quotes lock the exact price for 10 minutes.</p>
      </div>
    </Dialog>
  );
}
