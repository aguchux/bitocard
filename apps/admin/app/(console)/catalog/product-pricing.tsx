"use client";

import { useId, useState } from "react";
import {
  amountToMinor,
  Badge,
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
import {
  type AdminProduct,
  type PriceKind,
  useAdminPricePreviewQuery,
  useCountriesQuery,
  useDeletePricingRuleMutation,
  useSetPricingRuleMutation,
  useUpdateProductMutation,
} from "@bitocard/api-client/admin";
import { kindLabels } from "./pricing-labels";

type Choice = "inherit" | PriceKind;

const levelLabels: Record<string, string> = {
  product: "this product’s own rule",
  supplier: "the supplier’s rule",
  category: "the category rule",
  country: "the market rule",
  general: "the general rule",
  default: "the default",
};

const reasons: Record<string, string> = {
  not_offered: "Not offered in this market",
  cost_above_face_value: "Costs more than face value: cannot be sold at a discount",
  price_below_cost: "The fixed price is below cost",
  not_priced: "Not priced",
};

/**
 * Pricing a product before listing it: what each supplier charges, the rule that applies and what BitoCard makes per
 * sale, with a live preview while the product's own rule is changed. Saving sets (or removes) the product's own rule;
 * listing shows it on bitocard.com.
 */
export function ProductPricingDialog({ product, open, onClose, finance, operator }: { product: AdminProduct; open: boolean; onClose: () => void; finance: boolean; operator: boolean }) {
  const id = useId();
  const countries = useCountriesQuery();
  const [country, setCountry] = useState(product.country.length === 2 && product.country !== "WW" ? product.country : "NG");
  const [face, setFace] = useState("");
  const [choice, setChoice] = useState<Choice>("inherit");
  const [discount, setDiscount] = useState("");
  const [margin, setMargin] = useState("");
  const [fixed, setFixed] = useState("");
  const [fixedCurrency, setFixedCurrency] = useState("USD");
  const faceMinor = amountToMinor(face);
  const trial = {
    kind: choice === "inherit" ? undefined : choice,
    reseller_discount_bps: choice === "discount" || choice === "auto" ? (percentToBps(discount) ?? undefined) : undefined,
    margin_bps: choice === "markup" || choice === "auto" ? (percentToBps(margin) ?? undefined) : undefined,
    fixed_price: choice === "fixed" ? (amountToMinor(fixed) ?? undefined) : undefined,
    fixed_currency: choice === "fixed" ? fixedCurrency : undefined,
  };
  const args = useDebouncedValue({ product_id: product.id, country, ...(faceMinor ? { face_value: faceMinor } : {}), ...(choice === "inherit" ? {} : trial) });
  const preview = useAdminPricePreviewQuery(args, { skip: !open });
  const [setRule, setState] = useSetPricingRuleMutation();
  const [deleteRule, deleteState] = useDeletePricingRuleMutation();
  const [updateProduct, listState] = useUpdateProductMutation();
  const data = preview.data;
  const shown = data ? (data.trial ?? data.current) : null;
  const chosen = data?.offers.find(offer => offer.chosen) ?? null;
  const money = (minor: number | null | undefined) => (minor === null || minor === undefined || !data ? "—" : formatMoney(minor, data.currency));
  const productRule = data?.current.level === "product" ? data.current.rule_id : null;

  const save = async () => {
    if (choice === "inherit") {
      if (productRule) await deleteRule(productRule).unwrap();
      return true;
    }
    await setRule({ product_id: product.id, ...trial, kind: choice }).unwrap();
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
      description="See what each supplier charges and what BitoCard makes per sale. Change this product’s own pricing and watch the result before saving."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {finance ? (
            <Button variant="secondary" loading={setState.isLoading || deleteState.isLoading} onClick={() => void save().then(onClose, () => undefined)}>
              Save pricing
            </Button>
          ) : null}
          {operator ? (
            <Button loading={listState.isLoading} onClick={() => void (finance ? saveAndList(!product.listed) : updateProduct({ id: product.id, listed: !product.listed }).unwrap().then(onClose, () => undefined))}>
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
              {countries.data?.data.map(item => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Face value (${product.face_currency})`} htmlFor={`${id}-face`} hint={data ? `Showing ${formatMoney(data.face_value, product.face_currency)}.` : undefined}>
            <Input id={`${id}-face`} inputMode="decimal" placeholder="The first value" value={face} onChange={event => setFace(event.target.value)} />
          </Field>
        </div>

        <Field
          label="This product’s pricing"
          htmlFor={`${id}-choice`}
          hint={data ? `Now: ${kindLabels[data.current.kind]}, from ${levelLabels[data.current.level]}.` : undefined}
        >
          <Select id={`${id}-choice`} value={choice} disabled={!finance} onChange={event => setChoice(event.target.value as Choice)}>
            <option value="inherit">Use the supplier, category or general rule</option>
            <option value="auto">Automatic: discount if the supplier gives one, else markup</option>
            <option value="discount">Discount: customers pay face value at most</option>
            <option value="markup">Markup on the supplier’s cost</option>
            <option value="fixed" disabled={data ? !data.single_value : false}>
              Fixed price to resellers
            </option>
          </Select>
        </Field>
        {choice === "auto" || choice === "discount" ? (
          <Field label="Reseller discount (% of face value)" htmlFor={`${id}-discount`} hint="Never more than the supplier gives BitoCard.">
            <Input id={`${id}-discount`} inputMode="decimal" placeholder={data ? bpsToPercent(data.current.reseller_discount_bps) : ""} value={discount} onChange={event => setDiscount(event.target.value)} />
          </Field>
        ) : null}
        {choice === "auto" || choice === "markup" ? (
          <Field label="BitoCard markup (% of cost)" htmlFor={`${id}-margin`} hint="0 to 200.">
            <Input id={`${id}-margin`} inputMode="decimal" placeholder={data ? bpsToPercent(data.current.margin_bps) : ""} value={margin} onChange={event => setMargin(event.target.value)} />
          </Field>
        ) : null}
        {choice === "fixed" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Price to resellers" htmlFor={`${id}-fixed`}>
              <Input id={`${id}-fixed`} inputMode="decimal" value={fixed} onChange={event => setFixed(event.target.value)} />
            </Field>
            <Field label="Currency" htmlFor={`${id}-fixed-currency`}>
              <Input id={`${id}-fixed-currency`} maxLength={3} value={fixedCurrency} onChange={event => setFixedCurrency(event.target.value.toUpperCase())} />
            </Field>
          </div>
        ) : null}

        {preview.error ? <Notice tone="red">{errorMessage(preview.error)}</Notice> : null}
        {!data ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <PriceBreakdown
              caption="One sale through the chosen supplier"
              rows={
                chosen
                  ? [
                      { label: "Face value", value: money(data.face_price) },
                      { label: `Supplier cost (${chosen.supplier_name})`, value: money(chosen.supplier_cost), hint: chosen.supplier_discount_bps !== null ? `${formatBps(chosen.supplier_discount_bps)} below face value` : undefined },
                      { label: "Price to resellers", value: money(chosen.wholesale), hint: chosen.scheme === "discount" ? "Customers pay face value at most" : "Resellers add their own markup" },
                      ...(chosen.reseller_discount !== null ? [{ label: "Resellers’ discount", value: money(chosen.reseller_discount), tone: "muted" as const }] : []),
                      { label: "BitoCard makes per sale", value: money(chosen.bitocard_profit), tone: "profit" as const },
                    ]
                  : [{ label: "Not sellable", value: "No supplier can sell it under this pricing", tone: "warning" as const }]
              }
            />
            {shown ? (
              <p className="text-xs text-muted">
                {`${kindLabels[chosen?.rule.kind ?? shown.kind]}${chosen?.scheme ? ` (${chosen.scheme})` : ""}, from ${levelLabels[chosen?.rule.level ?? shown.level]}.`}
              </p>
            ) : null}
            <ul className="space-y-2">
              {data.offers.map(offer => (
                <li key={offer.offer_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                  <span className="font-medium">{offer.supplier_name}</span>
                  <span className="text-muted">{offer.sellable ? `Costs ${money(offer.supplier_cost)} · BitoCard makes ${money(offer.bitocard_profit)}` : (reasons[offer.reason ?? ""] ?? "Not sellable")}</span>
                  {offer.chosen ? <Badge tone="green">Cheapest: used</Badge> : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}
