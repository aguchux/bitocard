"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  ActionDialog,
  amountToMinor,
  bpsToPercent,
  Button,
  Card,
  CardHeader,
  categoryName,
  DataTable,
  errorMessage,
  Field,
  formatDateTime,
  Input,
  Notice,
  PageHeader,
  percentToBps,
  PricingSchemes,
  Select,
} from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { describeRule, kindLabels } from "../pricing-labels";
import {
  type PriceKind,
  productCategories,
  type ProductCategory,
  type PricingRule,
  useCountriesQuery,
  useDeletePricingRuleMutation,
  usePricingRulesQuery,
  useSetPricingRuleMutation,
  useSuppliersQuery,
} from "@bitocard/api-client/admin";

const scope = (rule: PricingRule, suppliers: Map<string, string>) =>
  [
    rule.product_id ? `Product ${rule.product_id.slice(0, 8)}` : null,
    rule.supplier_code ? (suppliers.get(rule.supplier_code) ?? rule.supplier_code) : null,
    rule.category ? categoryName(rule.category) : null,
    rule.country,
  ]
    .filter(Boolean)
    .join(" · ") || "Everything (general)";

/**
 * BitoCard's pricing rules. Each offer takes the most specific rule: product, then supplier, then category, then market,
 * then the general rule. Product rules are set from the product itself (Catalog > Products, List).
 */
export default function PricingPage() {
  const admin = useAdmin();
  const finance = can(admin, "finance");
  const { data, error, isLoading, refetch } = usePricingRulesQuery();
  const countries = useCountriesQuery();
  const suppliers = useSuppliersQuery();
  const supplierNames = new Map((suppliers.data?.data ?? []).map(item => [item.code, item.name]));
  const [setRule] = useSetPricingRuleMutation();
  const [removeRule, removeState] = useDeletePricingRuleMutation();
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<"" | ProductCategory>("");
  const [country, setCountry] = useState("");
  const [supplier, setSupplier] = useState("");
  const [kind, setKind] = useState<PriceKind>("auto");
  const [discount, setDiscount] = useState("1");
  const [margin, setMargin] = useState("3");
  const [fixed, setFixed] = useState("");
  const [fixedCurrency, setFixedCurrency] = useState("USD");
  const discountBps = percentToBps(discount);
  const marginBps = percentToBps(margin);
  const fixedMinor = amountToMinor(fixed);

  const startAdding = () => {
    setCategory("");
    setCountry("");
    setSupplier("");
    setKind("auto");
    setAdding(true);
  };
  const save = () => {
    if ((kind === "auto" || kind === "discount") && (discountBps === null || discountBps > 10_000)) throw new Error("Enter the reseller discount as a percentage of face value, at most 100.");
    if ((kind === "auto" || kind === "markup") && (marginBps === null || marginBps > 20_000)) throw new Error("Enter BitoCard’s markup as a percentage of cost, at most 200.");
    if (kind === "fixed" && (!supplier || fixedMinor === null || fixedMinor <= 0)) throw new Error("A fixed price is set for a supplier here (or on one product); enter the price.");
    return setRule({
      ...(category ? { category } : {}),
      ...(country ? { country } : {}),
      ...(supplier ? { supplier_code: supplier } : {}),
      kind,
      ...(kind === "auto" || kind === "discount" ? { reseller_discount_bps: discountBps! } : {}),
      ...(kind === "auto" || kind === "markup" ? { margin_bps: marginBps! } : {}),
      ...(kind === "fixed" ? { fixed_price: fixedMinor!, fixed_currency: fixedCurrency } : {}),
    }).unwrap();
  };

  return (
    <AdminShell section="catalog" current="/catalog/pricing" crumbs={[{ label: "Catalog", href: "/catalog" }, { label: "Pricing" }]}>
      <PageHeader
        title="Pricing"
        description="How BitoCard sells to resellers. Each product takes the most specific rule: product, then supplier, then category, then market, then the general rule. Set a product’s own pricing when you list it."
        actions={
          finance ? (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={startAdding}>
              Add rule
            </Button>
          ) : null
        }
      />
      <PricingSchemes audience="admin" />
      {removeState.error ? <Notice tone="red">{errorMessage(removeState.error)}</Notice> : null}
      <Card>
        <CardHeader title="Rules" description="Automatic means discount wherever the supplier gives one, markup otherwise. Local airtime, data, bills and pay-TV always sell at face value at most." className="pb-4" />
        <DataTable
          caption="Pricing rules"
          rows={data?.data}
          loading={isLoading}
          error={error ? errorMessage(error) : null}
          onRetry={refetch}
          rowKey={rule => rule.id}
          empty="No pricing rules yet."
          columns={[
            { key: "scope", header: "Applies to", cell: rule => <span className="font-medium">{scope(rule, supplierNames)}</span> },
            { key: "kind", header: "Scheme", cell: rule => kindLabels[rule.kind] },
            { key: "value", header: "What it does", cell: rule => <span className="text-sm text-muted">{describeRule(rule)}</span> },
            { key: "updated", header: "Updated", cell: rule => <span className="text-muted">{formatDateTime(rule.updated_at)}</span>, hideOnMobile: true },
            {
              key: "remove",
              header: "",
              align: "right",
              cell: rule =>
                finance && (rule.category || rule.country || rule.supplier_code || rule.product_id) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove rule for ${scope(rule, supplierNames)}`}
                    loading={removeState.isLoading && removeState.originalArgs === rule.id}
                    onClick={() => removeRule(rule.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>

      <ActionDialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add or replace a rule"
        description="Choose what it applies to and how it prices. A rule for the same scope replaces the existing one; leave everything blank for the general rule."
        confirmLabel="Save rule"
        requireReason={false}
        onConfirm={async () => save()}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Supplier" htmlFor="rule-supplier">
            <Select id="rule-supplier" value={supplier} onChange={event => setSupplier(event.target.value)}>
              <option value="">Any supplier</option>
              {suppliers.data?.data.map(item => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="rule-category">
            <Select id="rule-category" value={category} onChange={event => setCategory(event.target.value as "" | ProductCategory)}>
              <option value="">All categories</option>
              {productCategories.map(value => (
                <option key={value} value={value}>
                  {categoryName(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Market" htmlFor="rule-country">
            <Select id="rule-country" value={country} onChange={event => setCountry(event.target.value)}>
              <option value="">All markets</option>
              {countries.data?.data.map(item => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Scheme" htmlFor="rule-kind">
          <Select id="rule-kind" value={kind} onChange={event => setKind(event.target.value as PriceKind)}>
            <option value="auto">Automatic: discount where the supplier gives one, else markup</option>
            <option value="discount">Discount: customers pay face value at most</option>
            <option value="markup">Markup: priced up from the supplier’s cost</option>
            <option value="fixed" disabled={!supplier}>
              Fixed price for all of this supplier’s single-value products
            </option>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {kind === "auto" || kind === "discount" ? (
            <Field label="Reseller discount (% of face value)" htmlFor="rule-discount" hint="What resellers get off face value. Never more than the supplier gives BitoCard: BitoCard keeps the rest.">
              <Input id="rule-discount" inputMode="decimal" value={discount} onChange={event => setDiscount(event.target.value)} />
            </Field>
          ) : null}
          {kind === "auto" || kind === "markup" ? (
            <Field label="BitoCard markup (% of cost)" htmlFor="rule-margin" hint={`0 to 200. ${marginBps !== null ? `${bpsToPercent(marginBps)}% on top of what the supplier charges.` : ""}`}>
              <Input id="rule-margin" inputMode="decimal" value={margin} onChange={event => setMargin(event.target.value)} />
            </Field>
          ) : null}
          {kind === "fixed" ? (
            <>
              <Field label="Price to resellers" htmlFor="rule-fixed" hint="Per item. Never sold below cost: an item that costs more is not offered.">
                <Input id="rule-fixed" inputMode="decimal" value={fixed} onChange={event => setFixed(event.target.value)} />
              </Field>
              <Field label="Currency" htmlFor="rule-fixed-currency" hint="Converted to each market’s currency at BitoCard’s rate.">
                <Input id="rule-fixed-currency" maxLength={3} value={fixedCurrency} onChange={event => setFixedCurrency(event.target.value.toUpperCase())} />
              </Field>
            </>
          ) : null}
        </div>
      </ActionDialog>
    </AdminShell>
  );
}
