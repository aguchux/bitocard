"use client";

import { useState } from "react";
import { KeyRound, PackagePlus, Search } from "lucide-react";
import { ActionDialog, Badge, Button, Card, categoryName, DataTable, Dialog, errorMessage, Field, FilterSelect, formatBps, formatDateTime, formatMoney, Input, KeyValue, Notice, PageHeader, Select, Textarea, Toggle, useDebouncedValue } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  parseStockCodes,
  stockCategories,
  type StockCategory,
  type StockCode,
  type StockCodeStatus,
  type StockItem,
  useAddStockCodesMutation,
  useCreateStockMutation,
  useStockCodesQuery,
  useStockQuery,
  useUpdateStockMutation,
  useWithdrawStockCodeMutation,
} from "@bitocard/api-client/admin";

/** "12.50" to 1250; null unless it is a positive amount with at most two decimals. */
const toMinor = (text: string) => (/^\d+(\.\d{1,2})?$/.test(text.trim()) && Number(text) > 0 ? Math.round(Number(text) * 100) : null);
const major = (minor: number) => (minor / 100).toFixed(2);

function stockStatus(item: StockItem) {
  if (item.paused) return <Badge tone="amber" dot={false}>Paused</Badge>;
  if (item.codes.available === 0) return <Badge tone="red" dot={false}>Sold out</Badge>;
  return <Badge tone="green" dot={false}>On sale</Badge>;
}

/** Codes pasted one per line, `code | pin` for cards with a PIN. */
function CodesField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const count = parseStockCodes(value).length;
  return (
    <Field label="Codes" htmlFor={id} hint={`One per line; add a PIN after a bar (CODE | PIN). ${count.toLocaleString("en-GB")} code${count === 1 ? "" : "s"}. Codes are encrypted and never shown again.`}>
      <Textarea id={id} value={value} onChange={event => onChange(event.target.value)} className="font-mono text-sm" rows={6} spellCheck={false} autoComplete="off" />
    </Field>
  );
}

function AddStockDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [create, state] = useCreateStockMutation();
  const [category, setCategory] = useState<StockCategory>("software");
  const [country, setCountry] = useState("US");
  const [brand, setBrand] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [face, setFace] = useState("");
  const [cost, setCost] = useState("");
  const [margin, setMargin] = useState("");
  const [listed, setListed] = useState(true);
  const [codes, setCodes] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const faceMinor = toMinor(face);
  const costMinor = toMinor(cost);
  const marginBps = margin.trim() === "" ? undefined : Math.round(Number(margin) * 100);
  const valid =
    /^[A-Za-z]{2}$/.test(country) && /^[A-Za-z]{3}$/.test(currency) && brand.trim().length >= 2 && title.trim().length >= 2 && faceMinor !== null && costMinor !== null && (marginBps === undefined || (marginBps >= 0 && marginBps <= 5000));

  const submit = async () => {
    const result = await create({
      category,
      country: country.toUpperCase(),
      brand: brand.trim(),
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(instructions.trim() ? { redeem_instructions: instructions.trim() } : {}),
      currency: currency.toUpperCase(),
      face_value: faceMinor!,
      cost: costMinor!,
      ...(marginBps !== undefined ? { margin_bps: marginBps } : {}),
      listed,
      codes: parseStockCodes(codes),
    })
      .unwrap()
      .catch(() => null);
    if (result) setDone(`${result.product.name} added with ${result.added} code${result.added === 1 ? "" : "s"}${result.duplicates ? ` (${result.duplicates} already in stock, skipped)` : ""}.`);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a product to stock"
      description="Licences or gift cards BitoCard has bought. They are sold to resellers (API and their stores) and, once listed, on bitocard.com."
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!valid} loading={state.isLoading} onClick={() => void submit()}>
              Add to stock
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Notice tone="green">{done}</Notice>
      ) : (
        <div className="space-y-4">
          {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="stock-category">
              <Select id="stock-category" value={category} onChange={event => setCategory(event.target.value as StockCategory)}>
                {stockCategories.map(value => (
                  <option key={value} value={value}>
                    {categoryName(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Brand" htmlFor="stock-brand" hint="For example Microsoft or Kaspersky.">
              <Input id="stock-brand" value={brand} onChange={event => setBrand(event.target.value)} maxLength={60} />
            </Field>
            <Field label="Title" htmlFor="stock-title" hint="The product name customers see.">
              <Input id="stock-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} />
            </Field>
            <Field label="Region" htmlFor="stock-country" hint="Two-letter country where the code works (US, GB…).">
              <Input id="stock-country" value={country} onChange={event => setCountry(event.target.value.toUpperCase())} maxLength={2} />
            </Field>
          </div>
          <Field label="Description" htmlFor="stock-description" hint="Optional: edition, devices, licence term.">
            <Textarea id="stock-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={3} />
          </Field>
          <Field label="How to redeem" htmlFor="stock-instructions" hint="Optional: sent with the code.">
            <Textarea id="stock-instructions" value={instructions} onChange={event => setInstructions(event.target.value)} maxLength={2000} rows={2} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Currency" htmlFor="stock-currency">
              <Input id="stock-currency" value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} maxLength={3} />
            </Field>
            <Field label="Face value" htmlFor="stock-face" hint="Shown on stores.">
              <Input id="stock-face" inputMode="decimal" value={face} onChange={event => setFace(event.target.value)} placeholder="49.99" />
            </Field>
            <Field label="Cost per code" htmlFor="stock-cost" hint="What BitoCard paid.">
              <Input id="stock-cost" inputMode="decimal" value={cost} onChange={event => setCost(event.target.value)} placeholder="30.00" />
            </Field>
            <Field label="Margin %" htmlFor="stock-margin" hint="Optional; else the pricing rules.">
              <Input id="stock-margin" inputMode="decimal" value={margin} onChange={event => setMargin(event.target.value)} placeholder="10" />
            </Field>
          </div>
          <CodesField id="stock-codes" value={codes} onChange={setCodes} />
          <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3">
            <span className="text-sm">
              <span className="font-semibold">List on bitocard.com</span>
              <span className="block text-xs text-muted">Resellers can sell it either way.</span>
            </span>
            <Toggle label="List on bitocard.com" checked={listed} onChange={setListed} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

const codeStatuses: Array<{ value: "" | StockCodeStatus; label: string }> = [
  { value: "", label: "All codes" },
  { value: "available", label: "In stock" },
  { value: "sold", label: "Sold" },
  { value: "withdrawn", label: "Withdrawn" },
];

function StockDialog({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const admin = useAdmin();
  const operator = can(admin, "operations");
  const pricing = can(admin, "operations", "finance");
  const [status, setStatus] = useState<"" | StockCodeStatus>("available");
  const codes = useStockCodesQuery({ id: item.id, status: status || undefined });
  const [addCodes, addState] = useAddStockCodesMutation();
  const [update, updateState] = useUpdateStockMutation();
  const [withdraw] = useWithdrawStockCodeMutation();
  const [pasted, setPasted] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const [cost, setCost] = useState(major(item.cost));
  const [margin, setMargin] = useState(item.margin_bps === null ? "" : String(item.margin_bps / 100));
  const [withdrawing, setWithdrawing] = useState<StockCode | null>(null);
  const costMinor = toMinor(cost);
  const marginBps = margin.trim() === "" ? null : Math.round(Number(margin) * 100);
  const pricingChanged = costMinor !== item.cost || marginBps !== item.margin_bps;

  const add = async () => {
    const result = await addCodes({ id: item.id, codes: parseStockCodes(pasted) })
      .unwrap()
      .catch(() => null);
    if (result) {
      setPasted("");
      setAdded(`Added ${result.added} code${result.added === 1 ? "" : "s"}${result.duplicates ? `; ${result.duplicates} already in stock, skipped` : ""}.`);
    }
  };

  return (
    <Dialog open onClose={onClose} title={item.product.name} description={`${categoryName(item.product.category)} · ${item.product.country} · face value ${formatMoney(item.product.face_value, item.product.face_currency)}`}>
      <div className="space-y-5">
        <KeyValue
          items={[
            { label: "Status", value: stockStatus(item) },
            { label: "In stock", value: item.codes.available.toLocaleString("en-GB") },
            { label: "Sold", value: item.codes.sold.toLocaleString("en-GB") },
            { label: "Withdrawn", value: item.codes.withdrawn.toLocaleString("en-GB") },
            { label: "bitocard.com", value: item.product.listed ? "Listed" : "Not listed (list it under Products)" },
            { label: "Product key", value: <span className="font-mono text-xs">{item.product.key}</span> },
          ]}
        />
        {updateState.error ? <Notice tone="red">{errorMessage(updateState.error)}</Notice> : null}
        <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3">
          <span className="text-sm">
            <span className="font-semibold">On sale</span>
            <span className="block text-xs text-muted">Pause to stop sales without withdrawing codes.</span>
          </span>
          <Toggle label="On sale" checked={!item.paused} disabled={!pricing} onChange={onSale => void update({ id: item.id, on_sale: onSale })} />
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Pricing</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={`Cost per code (${item.currency})`} htmlFor="stock-edit-cost">
              <Input id="stock-edit-cost" inputMode="decimal" value={cost} disabled={!pricing} onChange={event => setCost(event.target.value)} />
            </Field>
            <Field label="Margin %" htmlFor="stock-edit-margin" hint={item.margin_bps === null ? "Using the pricing rules." : `Own rule: ${formatBps(item.margin_bps)}.`}>
              <Input id="stock-edit-margin" inputMode="decimal" value={margin} disabled={!pricing} onChange={event => setMargin(event.target.value)} placeholder="Pricing rules" />
            </Field>
            <div className="flex items-end">
              <Button
                variant="secondary"
                disabled={!pricing || !pricingChanged || costMinor === null || (marginBps !== null && (marginBps < 0 || marginBps > 5000))}
                loading={updateState.isLoading}
                onClick={() => void update({ id: item.id, cost: costMinor!, margin_bps: marginBps })}
              >
                Save pricing
              </Button>
            </div>
          </div>
        </section>

        {operator ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Add codes</h3>
            {addState.error ? <Notice tone="red">{errorMessage(addState.error)}</Notice> : null}
            {added ? <Notice tone="green">{added}</Notice> : null}
            <CodesField id="stock-add-codes" value={pasted} onChange={setPasted} />
            <Button icon={<KeyRound className="size-4" aria-hidden />} disabled={parseStockCodes(pasted).length === 0} loading={addState.isLoading} onClick={() => void add()}>
              Add codes
            </Button>
          </section>
        ) : null}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Codes</h3>
            <FilterSelect id="stock-code-status" label="Show" value={status} onChange={value => setStatus(value as "" | StockCodeStatus)} options={codeStatuses} />
          </div>
          <DataTable
            caption="Codes"
            rows={codes.data?.data}
            loading={codes.isLoading}
            error={codes.error ? errorMessage(codes.error) : null}
            onRetry={codes.refetch}
            rowKey={code => code.id}
            empty="No codes here."
            columns={[
              { key: "hint", header: "Code", cell: code => <span className="font-mono">{`••••${code.hint}`}</span> },
              { key: "status", header: "Status", cell: code => <Badge tone={code.status === "available" ? "green" : code.status === "sold" ? "blue" : "grey"} dot={false}>{code.status === "available" ? "In stock" : code.status === "sold" ? "Sold" : "Withdrawn"}</Badge> },
              {
                key: "when",
                header: "When",
                hideOnMobile: true,
                cell: code => <span className="text-muted">{formatDateTime(code.sold_at ?? code.withdrawn_at ?? code.created_at)}</span>,
              },
              {
                key: "action",
                header: "",
                align: "right",
                cell: code =>
                  code.order_id ? (
                    <AppLink href={`/orders/${code.order_id}`} className="text-sm font-semibold text-brand-600 hover:underline">
                      Order
                    </AppLink>
                  ) : code.status === "available" && operator ? (
                    <Button size="sm" variant="ghost" onClick={() => setWithdrawing(code)}>
                      Withdraw
                    </Button>
                  ) : null,
              },
            ]}
          />
        </section>
      </div>
      {withdrawing ? (
        <ActionDialog
          open
          onClose={() => setWithdrawing(null)}
          title={`Withdraw code ••••${withdrawing.hint}`}
          description="It will never be sold. Use this for a faulty or mistyped code."
          confirmLabel="Withdraw"
          tone="danger"
          onConfirm={reason => withdraw({ id: item.id, codeId: withdrawing.id, reason }).unwrap()}
        />
      ) : null}
    </Dialog>
  );
}

/** BitoCard's own stock: licences and gift cards BitoCard has bought, sold like any supplier's products. */
export default function StockPage() {
  const admin = useAdmin();
  const operator = can(admin, "operations");
  const [category, setCategory] = useState<"" | StockCategory>("");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const stock = useStockQuery({ ...(category ? { category } : {}), ...(q.length >= 2 ? { q } : {}) });
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = stock.data?.data.find(item => item.id === openId) ?? null;

  return (
    <AdminShell section="catalog" current="/catalog/stock" crumbs={[{ label: "Catalog", href: "/catalog" }, { label: "Stock" }]}>
      <PageHeader
        title="Stock"
        description="Software licences and gift cards BitoCard has bought, with their codes. Resellers sell them through the API and their stores; list them under Products to show them on bitocard.com. Each code is handed over once, and a product goes off sale when its codes run out."
        actions={
          operator ? (
            <Button icon={<PackagePlus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
              Add product
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          id="stock-filter-category"
          label="Category"
          value={category}
          onChange={value => setCategory(value as "" | StockCategory)}
          options={[{ value: "", label: "All categories" }, ...stockCategories.map(value => ({ value, label: categoryName(value) }))]}
        />
        <label className="relative flex min-w-56 flex-1 items-center">
          <span className="sr-only">Search stock</span>
          <Search className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name or brand" className="pl-9" />
        </label>
      </div>
      <Card>
        <DataTable
          caption="Stock"
          rows={stock.data?.data}
          loading={stock.isLoading}
          error={stock.error ? errorMessage(stock.error) : null}
          onRetry={stock.refetch}
          rowKey={item => item.id}
          onRowClick={item => setOpenId(item.id)}
          empty={category || q ? "Nothing in stock matches." : "Nothing in stock yet. Add a product with its codes."}
          columns={[
            {
              key: "product",
              header: "Product",
              cell: item => (
                <span className="block min-w-0">
                  <span className="block truncate font-semibold">{item.product.name}</span>
                  <span className="block text-xs text-muted">{`${categoryName(item.product.category)} · ${item.product.country}`}</span>
                </span>
              ),
            },
            { key: "face", header: "Face value", align: "right", cell: item => formatMoney(item.product.face_value, item.product.face_currency) },
            { key: "cost", header: "Cost", align: "right", hideOnMobile: true, cell: item => <span className="text-muted">{formatMoney(item.cost, item.currency)}</span> },
            { key: "stock", header: "In stock", align: "right", cell: item => <span className="font-semibold">{item.codes.available.toLocaleString("en-GB")}</span> },
            { key: "sold", header: "Sold", align: "right", hideOnMobile: true, cell: item => item.codes.sold.toLocaleString("en-GB") },
            { key: "status", header: "Status", cell: item => stockStatus(item) },
            { key: "store", header: "bitocard.com", hideOnMobile: true, cell: item => (item.product.listed ? <Badge tone="green" dot={false}>Listed</Badge> : <span className="text-xs text-muted">Not listed</span>) },
          ]}
        />
      </Card>
      {adding ? <AddStockDialog open onClose={() => setAdding(false)} /> : null}
      {open ? <StockDialog key={open.id} item={open} onClose={() => setOpenId(null)} /> : null}
    </AdminShell>
  );
}
