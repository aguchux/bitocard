"use client";

import { Suspense, useDeferredValue, useEffect, useId, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Search, ShoppingCart } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  categoryName,
  cn,
  currencyDigits,
  EmptyState,
  ErrorState,
  errorMessage,
  Field,
  FilterSelect,
  formatMoney,
  humanise,
  Input,
  LoadMore,
  Notice,
  PageHeader,
  Select,
  Skeleton,
} from "@bitocard/admin-ui";
import {
  type CatalogueCategory,
  catalogueCategories,
  type Product,
  type Quote,
  useCatalogueProductQuery,
  useCatalogueProductsInfiniteQuery,
  useCreateQuoteMutation,
  usePlaceOrderMutation,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

const maxQuantity = 10;

/** Major units typed by a person ("25.50") to integer minor units, or null when it is not a valid amount. */
function toMinor(value: string, currency: string) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const digits = currencyDigits(currency);
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > digits) return null;
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
}

function ProductPicker({ onPick }: { onPick: (product: Product) => void }) {
  const [category, setCategory] = useState<"" | CatalogueCategory>("");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const query = useCatalogueProductsInfiniteQuery({ category: category || undefined, q: q || undefined, limit: 10 });
  const rows = query.data?.pages.flatMap(page => page.data);
  return (
    <Card>
      <CardHeader title="Choose a product" description="Products you can sell, with your price." />
      <div className="flex flex-wrap gap-3 p-5 sm:p-6">
        <FilterSelect
          id="category"
          label="Category"
          value={category}
          onChange={value => setCategory(value as "" | CatalogueCategory)}
          options={[{ value: "", label: "All categories" }, ...catalogueCategories.map(value => ({ value, label: categoryName(value) }))]}
        />
        <label className="relative flex min-w-0 flex-1 basis-56 items-center">
          <span className="sr-only">Search products</span>
          <Search className="pointer-events-none absolute left-3 size-4 text-subtle" aria-hidden />
          <Input type="search" placeholder="Search by name or brand" value={search} maxLength={60} onChange={event => setSearch(event.target.value)} className="min-h-[3.75rem] pl-9" />
        </label>
      </div>
      {query.error ? (
        <ErrorState message={errorMessage(query.error)} onRetry={query.refetch} />
      ) : query.isLoading ? (
        <div className="space-y-3 px-5 pb-5 sm:px-6" aria-busy="true" aria-label="Loading products">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      ) : rows?.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map(product => {
            const prices = product.pricing.denominations.map(item => item.price);
            return (
              <li key={product.id}>
                <button type="button" onClick={() => onPick(product)} className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-canvas focus-visible:bg-canvas sm:px-6">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{product.name}</span>
                    <span className="block text-xs text-muted">{`${categoryName(product.category)} · ${product.country}`}</span>
                  </span>
                  <span className="shrink-0 text-right text-sm text-muted">
                    {prices.length ? `from ${formatMoney(Math.min(...prices), product.pricing.currency)}` : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="No products match">Try another search or category.</EmptyState>
      )}
      <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
    </Card>
  );
}

/** Minutes and seconds left on a quote, ticking every second. */
function useCountdown(expiresAt: string | undefined) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    const first = window.setTimeout(tick, 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [expiresAt]);
  if (!expiresAt || now === null) return { seconds: null, expired: false };
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return { seconds, expired: seconds === 0 };
}

function QuoteCard({ quote, product, onPlaced, onRequote, requoting }: { quote: Quote; product: Product; onPlaced: (id: string) => void; onRequote: () => void; requoting: boolean }) {
  const { membership, mode } = useReseller();
  const [place, placeState] = usePlaceOrderMutation();
  const [simulate, setSimulate] = useState<"completed" | "failed" | "pending">("completed");
  const { seconds, expired } = useCountdown(quote.expires_at);
  const simulateId = useId();
  const money = (amount: number) => formatMoney(amount, quote.currency);
  const canPlace = can(membership, "admin", "developer");
  const recipient = quote.recipient ? Object.entries(quote.recipient).filter(([key, value]) => value && key !== "account_name") : [];

  const submit = async () => {
    const order = await place({ quote_id: quote.id, ...(mode === "test" ? { simulate } : {}) })
      .unwrap()
      .catch(() => null);
    if (order) onPlaced(order.id);
  };

  return (
    <Card>
      <CardHeader
        title="Your quote"
        description={`${product.name}${quote.quantity > 1 ? ` × ${quote.quantity}` : ""}`}
        actions={
          seconds !== null ? (
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold", expired ? "bg-red-50 text-red-700" : seconds < 60 ? "bg-amber-50 text-amber-700" : "bg-canvas text-muted")}>
              <Clock className="size-3.5" aria-hidden />
              {expired ? "Expired" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left`}
            </span>
          ) : null
        }
      />
      <div className="space-y-4 p-5 sm:p-6">
        {quote.recipient?.account_name ? (
          <Notice tone="blue" title="Check the account">
            The number belongs to <span className="font-semibold">{quote.recipient.account_name}</span>. Confirm this with your customer before placing the order.
          </Notice>
        ) : null}
        <dl className="space-y-2 text-sm">
          {[
            ["Face value", `${formatMoney(quote.face_value, quote.face_currency)}${quote.quantity > 1 ? ` × ${quote.quantity}` : ""}`],
            ...recipient.map(([key, value]) => [humanise(key), key === "transaction_type" ? humanise(String(value)) : String(value)]),
            ["Customer pays", money(quote.price)],
            ...(quote.tax ? [[`${quote.tax.name} (${quote.tax.rate_percent}%)`, money(quote.tax.amount)]] : []),
            ["Wholesale", money(quote.wholesale)],
            ["Taken from your wallet", money(quote.wholesale + (quote.tax?.amount ?? 0))],
            ["Your profit", money(quote.reseller_profit)],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted">{label}</dt>
              <dd className="min-w-0 break-words text-right font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        {quote.customer_reference ? <p className="text-xs text-muted">{`Customer reference: ${quote.customer_reference}`}</p> : null}

        {placeState.error ? <Notice tone="red">{errorMessage(placeState.error)}</Notice> : null}
        {expired ? (
          <div className="space-y-3">
            <Notice tone="amber">This quote has expired. Get a new one to place the order.</Notice>
            <Button onClick={onRequote} loading={requoting}>
              Get a new quote
            </Button>
          </div>
        ) : canPlace ? (
          <div className="space-y-3">
            {mode === "test" ? (
              <Field label="Sandbox outcome" htmlFor={simulateId} hint="Test orders never reach a supplier.">
                <Select id={simulateId} value={simulate} onChange={event => setSimulate(event.target.value as typeof simulate)}>
                  <option value="completed">Completes</option>
                  <option value="failed">Fails</option>
                  <option value="pending">Stays processing</option>
                </Select>
              </Field>
            ) : null}
            <Button className="w-full sm:w-auto" icon={<ShoppingCart className="size-4" aria-hidden />} loading={placeState.isLoading} onClick={submit}>
              {`Place order · ${money(quote.wholesale + (quote.tax?.amount ?? 0))} from wallet`}
            </Button>
            <p className="text-xs text-muted">The amount is held from your wallet and taken only when the order completes.</p>
          </div>
        ) : (
          <Notice tone="grey">Your role can get quotes but not place orders. Ask an owner or admin.</Notice>
        )}
      </div>
    </Card>
  );
}

function OrderForm({ product, onChange }: { product: Product; onChange: () => void }) {
  const router = useRouter();
  const id = useId();
  const fixed = product.denomination.type === "fixed";
  const [faceValue, setFaceValue] = useState<string>(fixed ? String(product.pricing.denominations[0]?.face_value ?? "") : "");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [phone, setPhone] = useState("");
  const [account, setAccount] = useState("");
  const [transactionType, setTransactionType] = useState<"change" | "renew">("change");
  const [reference, setReference] = useState("");
  const [createQuote, quoteState] = useCreateQuoteMutation();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);

  const denomination = product.denomination;
  const face = fixed ? (faceValue ? Number(faceValue) : null) : toMinor(amount, product.face_currency);
  const reset = () => {
    setQuote(null);
    setInvalid(null);
  };

  const request = async () => {
    setInvalid(null);
    if (face === null || face <= 0) return setInvalid("Enter a valid amount.");
    if (denomination.type === "range" && (face < denomination.min || face > denomination.max)) {
      return setInvalid(`Enter an amount from ${formatMoney(denomination.min, product.face_currency)} to ${formatMoney(denomination.max, product.face_currency)}.`);
    }
    const count = Number(quantity);
    const recipient =
      product.recipient_type === "phone"
        ? { phone: phone.trim() }
        : product.recipient_type === "smartcard"
          ? { account_number: account.trim(), transaction_type: transactionType }
          : product.recipient_type === "meter"
            ? { account_number: account.trim() }
            : undefined;
    const result = await createQuote({
      product_id: product.id,
      face_value: face,
      ...(product.category === "gift_cards" && count > 1 ? { quantity: count } : {}),
      ...(recipient ? { recipient } : {}),
      ...(reference.trim() ? { customer_reference: reference.trim() } : {}),
    })
      .unwrap()
      .catch(() => null);
    setQuote(result);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void request();
  };

  const changed = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    reset();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <Card>
        <CardHeader
          title={product.name}
          description={`${categoryName(product.category)} · ${product.country} · face value in ${product.face_currency}`}
          actions={
            <Button variant="ghost" size="sm" onClick={onChange}>
              Change
            </Button>
          }
        />
        <form onSubmit={submit} className="space-y-5 p-5 sm:p-6">
          {fixed ? (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink">Face value</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {product.pricing.denominations.map(item => {
                  const selected = String(item.face_value) === faceValue;
                  return (
                    <label
                      key={item.face_value}
                      className={cn("flex min-h-14 cursor-pointer flex-col justify-center rounded-xl border px-3 py-2 text-sm", selected ? "border-brand-500 bg-brand-50" : "border-line hover:bg-canvas")}
                    >
                      <input type="radio" name="face_value" value={item.face_value} checked={selected} onChange={event => changed(setFaceValue)(event.target.value)} className="sr-only" />
                      <span className="font-semibold">{formatMoney(item.face_value, product.face_currency)}</span>
                      <span className="text-xs text-muted">{`Price ${formatMoney(item.price, product.pricing.currency)}`}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : denomination.type === "range" ? (
            <Field
              label={`Amount (${product.face_currency})`}
              htmlFor={`${id}-amount`}
              hint={`From ${formatMoney(denomination.min, product.face_currency)} to ${formatMoney(denomination.max, product.face_currency)}.`}
            >
              <Input id={`${id}-amount`} inputMode="decimal" autoComplete="off" required value={amount} onChange={event => changed(setAmount)(event.target.value)} />
            </Field>
          ) : null}

          {product.category === "gift_cards" ? (
            <Field label="Quantity" htmlFor={`${id}-quantity`}>
              <Select id={`${id}-quantity`} value={quantity} onChange={event => changed(setQuantity)(event.target.value)}>
                {Array.from({ length: maxQuantity }, (_, index) => (
                  <option key={index} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {product.recipient_type === "phone" ? (
            <Field label="Mobile number" htmlFor={`${id}-phone`} hint={`A ${product.country} number, with or without the country code.`}>
              <Input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="off" required minLength={5} maxLength={20} value={phone} onChange={event => changed(setPhone)(event.target.value)} />
            </Field>
          ) : null}
          {product.recipient_type === "smartcard" || product.recipient_type === "meter" ? (
            <Field
              label={product.recipient_type === "meter" ? "Meter number" : "Smartcard or IUC number"}
              htmlFor={`${id}-account`}
              hint="We check it and show the account name before you place the order."
            >
              <Input id={`${id}-account`} inputMode="numeric" autoComplete="off" required minLength={4} maxLength={30} value={account} onChange={event => changed(setAccount)(event.target.value)} />
            </Field>
          ) : null}
          {product.recipient_type === "smartcard" ? (
            <Field label="Subscription" htmlFor={`${id}-type`}>
              <Select id={`${id}-type`} value={transactionType} onChange={event => changed(setTransactionType)(event.target.value as "change" | "renew")}>
                <option value="change">Change to this package</option>
                <option value="renew">Renew as the current package</option>
              </Select>
            </Field>
          ) : null}

          <Field label="Customer reference (optional)" htmlFor={`${id}-reference`} hint="Your own reference for the customer or sale.">
            <Input id={`${id}-reference`} autoComplete="off" maxLength={100} value={reference} onChange={event => changed(setReference)(event.target.value)} />
          </Field>

          {invalid ? <Notice tone="red">{invalid}</Notice> : null}
          {quoteState.error && !quote ? <Notice tone="red">{errorMessage(quoteState.error)}</Notice> : null}
          <Button type="submit" variant={quote ? "secondary" : "primary"} loading={quoteState.isLoading}>
            {quote ? "Get a new quote" : "Get quote"}
          </Button>
        </form>
      </Card>

      <div className="min-w-0">
        {quote ? (
          <QuoteCard quote={quote} product={product} onPlaced={orderId => router.push(`/orders/${orderId}`)} onRequote={() => void request()} requoting={quoteState.isLoading} />
        ) : (
          <Card className="p-5 text-sm text-muted sm:p-6">
            <p className="font-semibold text-ink">How it works</p>
            <p className="mt-1">A quote locks the price for 10 minutes. Placing the order holds the wholesale cost and any tax from your wallet.</p>
            {product.redeem_instructions ? <p className="mt-3">{product.redeem_instructions}</p> : null}
          </Card>
        )}
      </div>
    </div>
  );
}

function NewOrder() {
  const router = useRouter();
  const productId = useSearchParams().get("product") ?? "";
  const [picked, setPicked] = useState<Product | null>(null);
  const fromLink = useCatalogueProductQuery(productId, { skip: !productId || picked !== null });
  const product = picked ?? (productId ? (fromLink.data ?? null) : null);

  const change = () => {
    setPicked(null);
    if (productId) router.replace("/orders/new");
  };

  if (productId && !picked && fromLink.error) {
    return (
      <Card>
        <ErrorState message={errorMessage(fromLink.error, "Could not load this product.")} onRetry={fromLink.refetch} />
        <div className="flex justify-center pb-6">
          <Button variant="ghost" onClick={change}>
            Choose another product
          </Button>
        </div>
      </Card>
    );
  }
  if (productId && !picked && fromLink.isLoading) return <Skeleton className="h-72 w-full" />;
  return product ? <OrderForm key={product.id} product={product} onChange={change} /> : <ProductPicker onPick={setPicked} />;
}

export default function NewOrderPage() {
  return (
    <ShqShell section="orders" current="/orders/new" crumbs={[{ label: "Orders", href: "/orders" }, { label: "New order" }]}>
      <PageHeader
        title="New order"
        description="Place an order by hand, for example for a customer in your shop."
        actions={
          <Link href="/orders" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-muted hover:bg-canvas hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden />
            All orders
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-72 w-full" />}>
        <NewOrder />
      </Suspense>
    </ShqShell>
  );
}
