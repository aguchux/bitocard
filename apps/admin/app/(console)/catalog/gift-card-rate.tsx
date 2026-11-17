"use client";

import { useId, useState } from "react";
import { Badge, bpsToPercent, Button, Dialog, errorMessage, Field, formatBps, formatMoney, Input, Notice, percentToBps, Select, Skeleton, useDebouncedValue } from "@bitocard/admin-ui";
import { type AdminPricePreview, type AdminProduct, useAdminPricePreviewQuery, useCountriesQuery, useDeletePricingRuleMutation, useSetPricingRuleMutation, useUpdateProductMutation } from "@bitocard/api-client/admin";

const levelLabels: Record<string, string> = {
  product: "this card’s own markup",
  supplier: "the supplier’s gift card markup",
  category: "the gift card markup",
  country: "this market’s gift card markup",
  general: "the gift card markup",
  default: "the default gift card markup",
};

/** Why an offer cannot be used, in words. */
export const offerReasons: Record<string, string> = {
  category_off: "Gift cards are off in this market",
  offer_unavailable: "The supplier no longer lists it",
  supplier_off: "The supplier is switched off",
  supplier_not_in_market: "The supplier is not switched on for gift cards in this market",
  supplier_domestic_only: "The supplier sells it only in its own country",
  supplier_not_set_up: "The supplier is not set up for live orders",
  no_exchange_rate: "No exchange rate for the supplier’s currency",
  not_offered: "Not offered in this market",
  not_priced: "Not priced",
};

/** "₦2,728 per £1": a rate in the market's minor units per one unit of the card's currency. */
/** One unit of a currency: "£1", "$1". */
export const oneUnit = (currency: string) => formatMoney(100, currency).replace(/[.,]00$/, "");
export const perUnitText = (rate: number | null | undefined, currency: string, faceCurrency: string) =>
  rate === null || rate === undefined ? "—" : `${formatMoney(rate, currency)} per ${oneUnit(faceCurrency)}`;

type Choice = "inherit" | "own";

/**
 * Gift cards are sold by rate: the card keeps its face value, and BitoCard's rate per unit of its currency is what
 * the cheapest supplier charges (converted) plus BitoCard's markup. This sets the card's own markup, or follows the
 * gift card markup for the market, and shows the rate and what each value of the card comes to.
 */
export function GiftCardRateDialog({ product, open, onClose, finance, operator }: { product: AdminProduct; open: boolean; onClose: () => void; finance: boolean; operator: boolean }) {
  const id = useId();
  const countries = useCountriesQuery();
  const markets = countries.data?.data ?? [];
  const [asked, setCountry] = useState(product.country);
  const country = markets.some(item => item.code === asked) ? asked : (markets[0]?.code ?? "");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [margin, setMargin] = useState("");
  const marginBps = percentToBps(margin);
  const ownDraft = choice === "own" && marginBps !== null;
  const args = useDebouncedValue({ product_id: product.id, country, ...(ownDraft ? { kind: "markup" as const, margin_bps: marginBps } : {}) });
  const preview = useAdminPricePreviewQuery(args, { skip: !open || !args.country });
  const [setRule, setState] = useSetPricingRuleMutation();
  const [deleteRule, deleteState] = useDeletePricingRuleMutation();
  const [updateProduct, listState] = useUpdateProductMutation();
  const data: AdminPricePreview | undefined = preview.data;
  const rate = data?.rate ?? null;
  const productRule = data?.current.level === "product" ? data.current.rule_id : null;
  // The card's own markup until the admin chooses otherwise.
  const shownChoice: Choice = choice ?? (productRule ? "own" : "inherit");
  const money = (minor: number | null | undefined) => (minor === null || minor === undefined || !data ? "—" : formatMoney(minor, data.currency));
  const rateText = (value: number | null | undefined) => (data ? perUnitText(value, data.currency, product.face_currency) : "—");
  const invalidMargin = shownChoice === "own" && margin !== "" && (marginBps === null || marginBps > 20_000);

  const save = async () => {
    if (shownChoice === "inherit") {
      if (productRule) await deleteRule(productRule).unwrap();
      return true;
    }
    if (marginBps === null) return true;
    await setRule({ product_id: product.id, kind: "markup", margin_bps: marginBps }).unwrap();
    return true;
  };
  const saveAndList = async (listed: boolean) => {
    const saved = await save().catch(() => false);
    if (!saved) return;
    await updateProduct({ id: product.id, listed }).unwrap().catch(() => null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Price and list ${product.name}`}
      description="Gift cards are sold by rate: the card keeps its face value, and resellers pay it at BitoCard’s rate, then add their own markup."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {finance ? (
            <Button variant="secondary" disabled={invalidMargin} loading={setState.isLoading || deleteState.isLoading} onClick={() => void save().then(onClose, () => undefined)}>
              Save rate
            </Button>
          ) : null}
          {operator ? (
            <Button
              disabled={finance && invalidMargin}
              loading={listState.isLoading}
              onClick={() => void (finance ? saveAndList(!product.listed) : updateProduct({ id: product.id, listed: !product.listed }).unwrap().then(onClose, () => undefined))}
            >
              {product.listed ? (finance ? "Save and unlist" : "Unlist") : finance ? "Save and list" : "List on bitocard.com"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {setState.error || deleteState.error || listState.error ? <Notice tone="red">{errorMessage(setState.error ?? deleteState.error ?? listState.error)}</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Market" htmlFor={`${id}-country`}>
            <Select id={`${id}-country`} value={country} onChange={event => setCountry(event.target.value)}>
              {markets.map(item => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="text-sm">
            <p className="font-semibold text-ink">Card currency</p>
            <p className="mt-2 text-muted">{product.face_currency}: cards show their face value in it.</p>
          </div>
        </div>

        {preview.error ? <Notice tone="red">{errorMessage(preview.error)}</Notice> : null}
        {!data ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <section aria-label="Supplier rates" className="space-y-2">
              <h3 className="text-sm font-semibold text-ink">What {oneUnit(product.face_currency)} of card value costs us</h3>
              <ul className="space-y-1.5">
                {data.offers.map(offer => (
                  <li key={offer.offer_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                    <span className="font-medium">{offer.supplier_name}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      {offer.sellable ? (
                        <>
                          <span className="font-semibold text-ink">{rateText(offer.supplier_rate)}</span>
                          {offer.supplier_discount_bps !== null ? <span>({offer.supplier_discount_bps >= 0 ? `${formatBps(offer.supplier_discount_bps)} below face` : `${formatBps(-offer.supplier_discount_bps)} above face`})</span> : null}
                          {offer.chosen ? <Badge tone="green">Cheapest: used</Badge> : null}
                        </>
                      ) : (
                        <span className="text-amber-700">{offerReasons[offer.reason ?? ""] ?? "Not sellable"}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <Field label="BitoCard markup" htmlFor={`${id}-choice`} hint={`Now ${formatBps(data.current.margin_bps)}, from ${levelLabels[data.current.level]}. Set the gift card markup for every card on Pricing rules.`}>
              <Select id={`${id}-choice`} value={shownChoice} disabled={!finance} onChange={event => setChoice(event.target.value as Choice)}>
                <option value="inherit">Use the gift card markup</option>
                <option value="own">Set a markup for this card</option>
              </Select>
            </Field>
            {shownChoice === "own" ? (
              <Field label="Markup on what the supplier charges (%)" htmlFor={`${id}-margin`} hint="0 to 200.">
                <Input id={`${id}-margin`} inputMode="decimal" disabled={!finance} placeholder={bpsToPercent(data.current.margin_bps)} value={margin} onChange={event => setMargin(event.target.value)} />
              </Field>
            ) : null}
            {invalidMargin ? <Notice tone="amber">Enter a markup from 0 to 200%.</Notice> : null}

            {rate?.bitocard_rate !== null && rate?.bitocard_rate !== undefined ? (
              <div className="rounded-xl bg-canvas p-4">
                <p className="text-xs uppercase tracking-wide text-muted">Rate to resellers</p>
                <p className="mt-1 text-2xl font-bold text-ink">{rateText(rate.bitocard_rate)}</p>
                <p className="text-xs text-muted">
                  Costs us {rateText(rate.supplier_rate)} · markup {formatBps(rate.margin_bps)} · resellers add their own markup on top.
                </p>
              </div>
            ) : (
              <Notice tone="amber">{data.unavailable_reason ?? "No supplier can sell this card in this market."}</Notice>
            )}

            {rate?.values.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">What each value of the card comes to</caption>
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th scope="col" className="py-1 pr-3 font-medium">Card</th>
                      <th scope="col" className="py-1 pr-3 text-right font-medium">We pay</th>
                      <th scope="col" className="py-1 pr-3 text-right font-medium">Resellers pay</th>
                      <th scope="col" className="py-1 text-right font-medium">BitoCard makes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rate.values.map(row => (
                      <tr key={row.face_value}>
                        <td className="py-1.5 pr-3 font-medium">{formatMoney(row.face_value, product.face_currency)}</td>
                        <td className="py-1.5 pr-3 text-right">{money(row.cost)}</td>
                        <td className="py-1.5 pr-3 text-right">{money(row.wholesale)}</td>
                        <td className="py-1.5 text-right font-semibold text-green-700">{money(row.bitocard_profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
