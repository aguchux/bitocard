"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionDialog, Button, Card, categoryName, DataTable, errorMessage, Field, formatBps, formatDateTime, Input, Notice, PageHeader, Select } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { productCategories, type ProductCategory, type PricingRule, useCountriesQuery, useDeletePricingRuleMutation, usePricingRulesQuery, useSetPricingRuleMutation } from "@bitocard/api-client/admin";

const scope = (rule: PricingRule) => [rule.category ? categoryName(rule.category) : "All categories", rule.country ?? "all markets", rule.product_id ? `product ${rule.product_id.slice(0, 8)}` : null].filter(Boolean).join(" · ");

/** BitoCard margins on supplier cost. The most specific rule wins (product, then category and country, then wider). */
export default function PricingPage() {
  const admin = useAdmin();
  const finance = can(admin, "finance");
  const { data, error, isLoading, refetch } = usePricingRulesQuery();
  const countries = useCountriesQuery();
  const [setRule] = useSetPricingRuleMutation();
  const [removeRule, removeState] = useDeletePricingRuleMutation();
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<"" | ProductCategory>("");
  const [country, setCountry] = useState("");
  const [margin, setMargin] = useState("500");
  const [discount, setDiscount] = useState("");

  return (
    <AdminShell section="catalog" current="/catalog/pricing" crumbs={[{ label: "Catalog", href: "/catalog" }, { label: "Pricing rules" }]}>
      <PageHeader
        title="Pricing rules"
        description="BitoCard’s margin on supplier cost, and the discount resellers keep on face-value products. The most specific rule applies."
        actions={
          finance ? (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
              Add rule
            </Button>
          ) : null
        }
      />
      {removeState.error ? <Notice tone="red">{errorMessage(removeState.error)}</Notice> : null}
      <Card>
        <DataTable
          caption="Pricing rules"
          rows={data?.data}
          loading={isLoading}
          error={error ? errorMessage(error) : null}
          onRetry={refetch}
          rowKey={rule => rule.id}
          empty="No pricing rules yet."
          columns={[
            { key: "scope", header: "Applies to", cell: rule => <span className="font-medium">{scope(rule)}</span> },
            { key: "margin", header: "BitoCard margin", align: "right", cell: rule => formatBps(rule.margin_bps) },
            { key: "discount", header: "Reseller discount", align: "right", cell: rule => (rule.reseller_discount_bps === null ? "—" : formatBps(rule.reseller_discount_bps)) },
            { key: "updated", header: "Updated", cell: rule => <span className="text-muted">{formatDateTime(rule.updated_at)}</span>, hideOnMobile: true },
            {
              key: "remove",
              header: "",
              align: "right",
              cell: rule =>
                finance ? (
                  <Button variant="ghost" size="sm" aria-label={`Remove rule for ${scope(rule)}`} loading={removeState.isLoading && removeState.originalArgs === rule.id} onClick={() => removeRule(rule.id)}>
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
        title="Add or replace a pricing rule"
        description="A rule for the same category and market replaces the existing one."
        confirmLabel="Save rule"
        requireReason={false}
        onConfirm={() =>
          setRule({
            ...(category ? { category } : {}),
            ...(country ? { country } : {}),
            margin_bps: Number(margin),
            ...(discount ? { reseller_discount_bps: Number(discount) } : {}),
          }).unwrap()
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
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
          <Field label="BitoCard margin (basis points)" htmlFor="rule-margin" hint={`${formatBps(Number(margin) || 0)} of supplier cost. 0 to 5000.`}>
            <Input id="rule-margin" type="number" min={0} max={5000} value={margin} onChange={event => setMargin(event.target.value)} />
          </Field>
          <Field label="Reseller discount (basis points)" htmlFor="rule-discount" hint="Optional. Face-value products only. 0 to 3000.">
            <Input id="rule-discount" type="number" min={0} max={3000} value={discount} onChange={event => setDiscount(event.target.value)} />
          </Field>
        </div>
      </ActionDialog>
    </AdminShell>
  );
}
