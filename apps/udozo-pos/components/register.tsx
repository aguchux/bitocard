"use client";

/* eslint-disable @next/next/no-img-element -- listing photos come from udozo.com's own image addresses. */
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { CameraScan } from "@/components/camera-scan";
import { type WaitingRequest, WalletWait } from "@/components/wallet-wait";
import {
  cashSuggestions,
  findProducts,
  methodLabel,
  money,
  paymentMethods,
  type PosCatalogue,
  type PosPaymentMethod,
  type PosProduct,
  type PosSale,
  readAmount,
  tillShown,
  tillTotals,
  vatText,
} from "@/lib/pos";
import { askWallet, ringUp } from "@/lib/pos-actions";
import { TillCustomer } from "@/components/till-customer";
import type { PosCustomerBrief } from "@/lib/pos";

type Payment = {
  method: PosPaymentMethod | "credit";
  amount: number;
  tendered: number | null;
  reference: string;
};

const creditMethod = {
  value: "credit" as const,
  label: "Pay later",
  hint: "The customer owes you this part: record it on their page when they pay it back.",
};

const walletMethod = {
  value: "udozo_wallet" as const,
  label: "Udozo wallet",
  hint: "The buyer pays the rest from their Udozo wallet, confirming on their phone.",
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-000000000000".replace(/0/g, () =>
        Math.floor(Math.random() * 16).toString(16),
      );
const button =
  "inline-flex h-12 items-center justify-center rounded-xl px-5 font-bold disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} bg-pos-600 text-white hover:bg-pos-700`;
const quiet = `${button} border border-pos-line bg-white text-pos-ink hover:bg-pos-50`;
const input =
  "h-12 w-full min-w-0 rounded-xl border border-pos-line bg-white px-4 text-base";

/**
 * The register: find products (a barcode scanner types into the search and presses Enter), build the basket, then take
 * payment in one or several parts. The basket keeps its own id until Udozo has the sale, so pressing Complete again after
 * a lost connection is never a second sale. Udozo checks every price and the stock free to sell; a refusal says why and
 * the till reads the shop again.
 */
export function Register({
  tillId,
  vatBps,
  currency,
  products,
  categories,
  planName,
  walletPayments = false,
}: {
  tillId: string;
  vatBps: number;
  currency: string;
  products: PosProduct[];
  categories: PosCatalogue["categories"];
  planName: string;
  walletPayments?: boolean;
}) {
  const router = useRouter();
  const search = useRef<HTMLInputElement>(null);
  const [words, setWords] = useState("");
  const [category, setCategory] = useState("");
  const [cart, setCart] = useState<Array<{ id: string; quantity: number }>>([]);
  const [discountText, setDiscountText] = useState("");
  const [saleId, setSaleId] = useState(newId);
  const [stage, setStage] = useState<"basket" | "pay" | "wallet" | "done">(
    "basket",
  );
  const [walletRequest, setWalletRequest] = useState<WaitingRequest | null>(
    null,
  );
  const [scanning, setScanning] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [done, setDone] = useState<PosSale | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [customer, setCustomer] = useState<PosCustomerBrief | null>(null);
  const [pending, start] = useTransition();

  const byId = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const sellable = (product: PosProduct) =>
    product.blocked === null &&
    product.price.amount !== null &&
    product.available > 0;
  const found = findProducts(products, words);
  const shown = found.matches.filter(
    (product) =>
      !category ||
      product.category?.id === category ||
      product.category?.parent?.id === category,
  );

  const lines = cart.flatMap((line) => {
    const product = byId.get(line.id);
    return product && product.price.amount !== null
      ? [
          {
            product,
            id: line.id,
            unit: product.price.amount,
            quantity: line.quantity,
          },
        ]
      : [];
  });
  const discount = readAmount(discountText) ?? 0;
  const totals = tillTotals(lines, { discount, vatBps });
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const remaining = Math.max(0, totals.total - paid);

  const add = (product: PosProduct) => {
    setMessage(null);
    if (!sellable(product)) return;
    setCart((current) => {
      const line = current.find((item) => item.id === product.id);
      if (line)
        return current.map((item) =>
          item.id === product.id
            ? {
                ...item,
                quantity: Math.min(product.available, item.quantity + 1),
              }
            : item,
        );
      return [...current, { id: product.id, quantity: 1 }];
    });
  };
  const setQuantity = (id: string, quantity: number) => {
    const product = byId.get(id);
    if (!product) return;
    setCart((current) =>
      quantity < 1
        ? current.filter((item) => item.id !== id)
        : current.map((item) =>
            item.id === id
              ? { ...item, quantity: Math.min(product.available, quantity) }
              : item,
          ),
    );
  };

  /** A code a scanner typed (or the camera read), or words with Enter: the exact match, else the only match, is added. */
  const take = (text: string) => {
    const result = findProducts(products, text);
    const pick =
      result.exact ?? (result.matches.length === 1 ? result.matches[0] : null);
    if (!pick) {
      setMessage(
        text.trim() ? `Nothing at your till matches “${text.trim()}”.` : null,
      );
      return false;
    }
    if (!sellable(pick)) {
      setMessage(
        `“${pick.title}” cannot be sold now: ${pick.available === 0 ? "none free to sell" : "finish it on udozo.com"}.`,
      );
      return false;
    }
    add(pick);
    return true;
  };

  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (take(words)) setWords("");
  };

  // The camera's handler stays the same while it runs (a new one would restart the camera), reading the latest basket.
  const takeRef = useRef(take);
  useEffect(() => {
    takeRef.current = take;
  });
  const onScanned = useCallback((code: string) => {
    setScanning(false);
    takeRef.current(code);
  }, []);

  const reset = () => {
    setCart([]);
    setDiscountText("");
    setPayments([]);
    setDone(null);
    setMessage(null);
    setWalletRequest(null);
    setCustomer(null);
    setSaleId(newId());
    setStage("basket");
    setTimeout(() => search.current?.focus(), 0);
  };

  const complete = () =>
    start(async () => {
      setMessage(null);
      const result = await ringUp({
        till_id: tillId,
        client_sale_id: saleId,
        lines: lines.map((line) => ({
          listing_id: line.id,
          quantity: line.quantity,
        })),
        ...(totals.discount ? { discount } : {}),
        payments: payments.map((payment) => ({
          method: payment.method,
          amount: payment.amount,
          tendered: payment.tendered,
          reference: payment.reference,
        })),
        expected_total: totals.total,
        ...(customer ? { customer_id: customer.id } : {}),
      });
      if (result.ok) {
        setDone(result.data);
        setStage("done");
        router.refresh();
        return;
      }
      setMessage(result.message);
      // Stock or a price moved: read the shop again, back to the basket to check it.
      if (
        result.code === "stock_short" ||
        result.code === "price_changed" ||
        result.code === "product_unavailable" ||
        result.code === "plan_limit"
      ) {
        setPayments([]);
        setStage("basket");
        router.refresh();
      }
    });

  /** Asks the buyer to pay the rest from their Udozo wallet; the till then waits for them. */
  const askForWallet = (phone: string) =>
    start(async () => {
      setMessage(null);
      const result = await askWallet({
        till_id: tillId,
        client_sale_id: saleId,
        lines: lines.map((line) => ({
          listing_id: line.id,
          quantity: line.quantity,
        })),
        ...(totals.discount ? { discount } : {}),
        payments: payments.map((payment) => ({
          method: payment.method,
          amount: payment.amount,
          tendered: payment.tendered,
          reference: payment.reference,
        })),
        wallet_amount: remaining,
        expected_total: totals.total,
        ...(phone.trim() ? { phone } : {}),
        ...(customer ? { customer_id: customer.id } : {}),
      });
      if (!result.ok) {
        setMessage(result.message);
        if (
          result.code === "stock_short" ||
          result.code === "price_changed" ||
          result.code === "product_unavailable" ||
          result.code === "plan_limit"
        ) {
          setPayments([]);
          setStage("basket");
          router.refresh();
        }
        return;
      }
      setWalletRequest(result.data);
      setStage("wallet");
    });

  const walletPaid = useCallback(
    (sale: PosSale) => {
      setDone(sale);
      setWalletRequest(null);
      setStage("done");
      router.refresh();
    },
    [router],
  );
  const walletClosed = useCallback((text: string) => {
    setMessage(text);
    setWalletRequest(null);
    setStage("pay");
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      <section aria-label="Products" className="grid min-w-0 gap-3">
        <div className="flex gap-2">
          <label htmlFor="till-search" className="sr-only">
            Scan or find a product
          </label>
          <input
            ref={search}
            id="till-search"
            autoFocus
            value={words}
            onChange={(event) => setWords(event.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Scan a barcode, or type a name or SKU"
            autoComplete="off"
            className={input}
          />
          <button
            type="button"
            onClick={() => setScanning(true)}
            disabled={stage !== "basket"}
            className="h-12 shrink-0 rounded-xl border border-pos-line bg-white px-4 font-bold text-pos-ink hover:bg-pos-50 disabled:opacity-50"
          >
            Camera<span className="sr-only"> scan</span>
          </button>
        </div>
        {scanning ? (
          <CameraScan onCode={onScanned} onClose={() => setScanning(false)} />
        ) : null}
        {categories.length > 1 ? (
          <nav
            aria-label="Categories"
            className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
          >
            <ul className="flex gap-2">
              {[
                { id: "", name: "Everything", featured: false },
                ...categories,
              ].map((item) => (
                <li key={item.id || "all"}>
                  <button
                    type="button"
                    aria-pressed={category === item.id}
                    onClick={() => setCategory(item.id)}
                    className={`flex h-10 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap ${category === item.id ? "bg-pos-600 text-white" : "bg-white text-pos-ink-2 hover:bg-pos-50"}`}
                  >
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {shown.length > tillShown ? (
          <p className="text-sm text-pos-muted">
            Showing {tillShown} of {shown.length.toLocaleString("en-GB")}. Scan,
            search or choose a category to find the rest.
          </p>
        ) : null}
        {shown.length ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {shown.slice(0, tillShown).map((product) => {
              const ok = sellable(product);
              const inCart =
                cart.find((item) => item.id === product.id)?.quantity ?? 0;
              return (
                <li key={product.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => add(product)}
                    disabled={
                      !ok || stage !== "basket" || inCart >= product.available
                    }
                    className="grid h-full w-full content-start gap-1 rounded-[16px] bg-white p-2 text-left hover:ring-2 hover:ring-pos-600 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:ring-0"
                  >
                    <span className="relative block aspect-[4/3] overflow-hidden rounded-xl bg-pos-page">
                      {product.photo_url ? (
                        <img
                          src={product.photo_url}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : null}
                      {inCart ? (
                        <span className="absolute top-1.5 right-1.5 rounded-full bg-pos-600 px-2 py-0.5 text-xs font-bold text-white">
                          {inCart}
                        </span>
                      ) : null}
                    </span>
                    <span className="line-clamp-2 text-sm font-semibold text-pos-ink">
                      {product.title ?? "Untitled draft"}
                    </span>
                    <span className="font-display font-bold text-pos-ink">
                      {product.price.amount === null
                        ? "No price"
                        : money(product.price.amount, currency)}
                    </span>
                    <span
                      className={`text-xs ${ok ? "text-pos-muted" : "text-pos-warn"}`}
                    >
                      {ok
                        ? `${product.available} free`
                        : product.blocked === "plan_limit"
                          ? `Over ${planName}'s limit`
                          : product.available === 0
                            ? "Out of stock"
                            : "Not ready"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-[20px] bg-white p-6 text-pos-ink-2">
            Nothing matches. Try other words.
          </p>
        )}
      </section>

      <section
        id="basket"
        aria-labelledby="basket-title"
        className="grid gap-4 rounded-[20px] bg-white p-4 lg:sticky lg:top-4"
      >
        {message ? (
          <p
            role="alert"
            className="rounded-xl bg-pos-warn-bg p-3 text-sm font-semibold text-pos-warn"
          >
            {message}
          </p>
        ) : null}

        {stage === "done" && done ? (
          <div className="grid gap-3 text-center" role="status">
            <h2
              id="basket-title"
              className="font-display text-2xl font-bold text-pos-ink"
            >
              Sale {done.number} done
            </h2>
            <p className="text-pos-ink-2">
              {done.items} {done.items === 1 ? "item" : "items"} ·{" "}
              {money(done.total, done.currency)} ·{" "}
              {done.payments
                .map((payment) => methodLabel(payment.method))
                .join(" and ")}
            </p>
            {done.change > 0 ? (
              <p className="rounded-xl bg-pos-50 p-4">
                <span className="block text-sm font-semibold text-pos-700">
                  Change to give
                </span>
                <span className="font-display text-4xl font-bold text-pos-ink">
                  {money(done.change, done.currency)}
                </span>
              </p>
            ) : null}
            <button type="button" autoFocus onClick={reset} className={primary}>
              New sale
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <h2
                id="basket-title"
                className="font-display text-xl font-bold text-pos-ink"
              >
                {stage === "basket" ? "Basket" : "Take payment"}
              </h2>
              {cart.length && stage === "basket" ? (
                <button
                  type="button"
                  onClick={reset}
                  className="text-sm font-semibold text-pos-error"
                >
                  Clear
                </button>
              ) : null}
            </div>

            {lines.length ? (
              <ul className="grid gap-2">
                {lines.map((line) => (
                  <li
                    key={line.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-pos-line pb-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-pos-ink">
                        {line.product.title}
                      </span>
                      <span className="text-sm text-pos-muted">
                        {money(line.unit, currency)} × {line.quantity} ={" "}
                        <strong className="text-pos-ink">
                          {money(line.unit * line.quantity, currency)}
                        </strong>
                      </span>
                    </span>
                    {stage === "basket" ? (
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setQuantity(line.id, line.quantity - 1)
                          }
                          className="size-10 rounded-lg border border-pos-line text-lg font-bold"
                          aria-label={`One fewer ${line.product.title}`}
                        >
                          −
                        </button>
                        <span
                          className="w-8 text-center font-bold"
                          aria-live="polite"
                        >
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setQuantity(line.id, line.quantity + 1)
                          }
                          disabled={line.quantity >= line.product.available}
                          className="size-10 rounded-lg border border-pos-line text-lg font-bold disabled:opacity-40"
                          aria-label={`One more ${line.product.title}`}
                        >
                          +
                        </button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-pos-ink-2">
                Scan or tap products to add them.
              </p>
            )}

            {lines.length ? (
              <TillCustomer
                customer={customer}
                onChange={setCustomer}
                disabled={stage !== "basket"}
                currency={currency}
              />
            ) : null}

            {lines.length && stage === "basket" ? (
              <div>
                <label
                  htmlFor="sale-discount"
                  className="text-sm font-semibold text-pos-ink-2"
                >
                  Discount off the sale (optional)
                </label>
                <input
                  id="sale-discount"
                  inputMode="decimal"
                  value={discountText}
                  onChange={(event) => setDiscountText(event.target.value)}
                  placeholder="0"
                  className={`${input} mt-1`}
                  aria-invalid={
                    discountText !== "" && readAmount(discountText) === null
                  }
                />
              </div>
            ) : null}

            {lines.length ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-pos-ink-2">
                <dt>Items</dt>
                <dd className="text-right">{totals.items}</dd>
                <dt>Subtotal</dt>
                <dd className="text-right">
                  {money(totals.subtotal, currency)}
                </dd>
                {totals.discount ? (
                  <>
                    <dt>Discount</dt>
                    <dd className="text-right">
                      −{money(totals.discount, currency)}
                    </dd>
                  </>
                ) : null}
                {vatBps ? (
                  <>
                    <dt>VAT {vatText(vatBps)}</dt>
                    <dd className="text-right">
                      {money(totals.vat, currency)}
                    </dd>
                  </>
                ) : null}
                <dt className="font-display text-xl font-bold text-pos-ink">
                  Total
                </dt>
                <dd className="text-right font-display text-xl font-bold text-pos-ink">
                  {money(totals.total, currency)}
                </dd>
              </dl>
            ) : null}

            {stage === "basket" ? (
              <button
                type="button"
                disabled={
                  !lines.length ||
                  (discountText !== "" && readAmount(discountText) === null)
                }
                onClick={() => setStage("pay")}
                className={primary}
              >
                Charge {lines.length ? money(totals.total, currency) : ""}
              </button>
            ) : stage === "wallet" && walletRequest ? (
              <WalletWait
                request={walletRequest}
                onPaid={walletPaid}
                onClosed={walletClosed}
              />
            ) : (
              <PaymentStep
                currency={currency}
                total={totals.total}
                remaining={remaining}
                payments={payments}
                setPayments={setPayments}
                pending={pending}
                walletPayments={walletPayments}
                credit={customer !== null}
                onAskWallet={askForWallet}
                onBack={() => setStage("basket")}
                onComplete={complete}
              />
            )}
          </>
        )}
      </section>

      {stage === "basket" && lines.length ? (
        <a
          href="#basket"
          className="sticky bottom-3 z-10 flex h-14 items-center justify-between rounded-2xl bg-pos-night px-5 font-bold text-white no-underline shadow-lg lg:hidden"
        >
          <span>
            Basket · {totals.items} {totals.items === 1 ? "item" : "items"}
          </span>
          <span>{money(totals.total, currency)}</span>
        </a>
      ) : null}
    </div>
  );
}

/** Taking payment: one part, or several (some cash, the rest by transfer), until the total is covered. */
function PaymentStep({
  currency,
  total,
  remaining,
  payments,
  setPayments,
  pending,
  walletPayments,
  credit,
  onAskWallet,
  onBack,
  onComplete,
}: {
  currency: string;
  total: number;
  remaining: number;
  payments: Payment[];
  setPayments: (payments: Payment[]) => void;
  pending: boolean;
  walletPayments: boolean;
  /** A customer is chosen, so the sale may be paid later in part. */
  credit: boolean;
  onAskWallet: (phone: string) => void;
  onBack: () => void;
  onComplete: () => void;
}) {
  const [method, setMethod] = useState<
    PosPaymentMethod | "credit" | "udozo_wallet"
  >("cash");
  const [phone, setPhone] = useState("");
  const [amountText, setAmountText] = useState("");
  const [tenderedText, setTenderedText] = useState("");
  const [reference, setReference] = useState("");
  const amount = amountText === "" ? remaining : readAmount(amountText);
  const tendered = tenderedText === "" ? null : readAmount(tenderedText);
  const tenderedBad =
    tenderedText !== "" &&
    (tendered === null || (amount !== null && tendered < amount));
  const amountBad = amount === null || amount <= 0 || amount > remaining;

  const addPart = (handed: number | null = tendered) => {
    if (
      method === "udozo_wallet" ||
      amount === null ||
      amount <= 0 ||
      amount > remaining
    )
      return;
    setPayments([
      ...payments,
      {
        method,
        amount,
        tendered: method === "cash" ? handed : null,
        reference: method === "cash" ? "" : reference,
      },
    ]);
    setAmountText("");
    setTenderedText("");
    setReference("");
  };

  return (
    <div className="grid gap-3">
      {payments.length ? (
        <ul className="grid gap-1">
          {payments.map((payment, index) => (
            <li
              key={index}
              className="flex items-center justify-between gap-2 rounded-lg bg-pos-page px-3 py-2"
            >
              <span>
                <strong>{methodLabel(payment.method)}</strong>{" "}
                {money(payment.amount, currency)}
                {payment.tendered && payment.tendered > payment.amount ? (
                  <span className="text-sm text-pos-muted">
                    {" "}
                    · given {money(payment.tendered, currency)}, change{" "}
                    {money(payment.tendered - payment.amount, currency)}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPayments(payments.filter((_, at) => at !== index))
                }
                className="text-sm font-semibold text-pos-error"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {remaining > 0 ? (
        <>
          <p className="font-semibold text-pos-ink">
            {payments.length ? "Still to pay" : "To pay"}:{" "}
            <span className="font-display text-2xl">
              {money(remaining, currency)}
            </span>
          </p>
          <fieldset>
            <legend className="text-sm font-semibold text-pos-ink-2">
              Paid by
            </legend>
            <div
              className={`mt-1 grid gap-1 ${walletPayments || credit ? "grid-cols-3" : "grid-cols-4"}`}
            >
              {[
                ...paymentMethods,
                ...(credit ? [creditMethod] : []),
                ...(walletPayments ? [walletMethod] : []),
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={method === item.value}
                  onClick={() => setMethod(item.value)}
                  className={`min-h-11 rounded-lg px-1 text-sm font-bold ${method === item.value ? "bg-pos-600 text-white" : "border border-pos-line bg-white text-pos-ink"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-pos-muted">
              {method === "udozo_wallet"
                ? walletMethod.hint
                : method === "credit"
                  ? creditMethod.hint
                  : paymentMethods.find((item) => item.value === method)?.hint}
            </p>
          </fieldset>
          {method === "udozo_wallet" ? (
            <div className="grid gap-2">
              <p className="text-pos-ink-2">
                The buyer pays{" "}
                <strong className="text-pos-ink">
                  {money(remaining, currency)}
                </strong>{" "}
                from their Udozo wallet. Show them a QR code, or send it to
                their Udozo mobile number.
              </p>
              <label
                htmlFor="pay-phone"
                className="text-sm font-semibold text-pos-ink-2"
              >
                Their Udozo mobile number (optional)
              </label>
              <input
                id="pay-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+234 803 000 0000"
                className={input}
              />
              <button
                type="button"
                onClick={() => onAskWallet(phone)}
                disabled={pending}
                className={primary}
              >
                {pending
                  ? "Asking…"
                  : phone.trim()
                    ? "Send to their phone"
                    : "Show the QR code"}
              </button>
            </div>
          ) : null}
          {method !== "udozo_wallet" ? (
            <>
              <div>
                <label
                  htmlFor="pay-amount"
                  className="text-sm font-semibold text-pos-ink-2"
                >
                  Amount (all {money(remaining, currency)}, or part of it)
                </label>
                <input
                  id="pay-amount"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  placeholder={(remaining / 100).toFixed(2)}
                  aria-invalid={amountText !== "" && amountBad}
                  className={`${input} mt-1`}
                />
              </div>
              {method === "cash" ? (
                <div>
                  <label
                    htmlFor="pay-tendered"
                    className="text-sm font-semibold text-pos-ink-2"
                  >
                    Cash handed over
                  </label>
                  <input
                    id="pay-tendered"
                    inputMode="decimal"
                    value={tenderedText}
                    onChange={(event) => setTenderedText(event.target.value)}
                    placeholder="The exact amount"
                    aria-invalid={tenderedBad}
                    className={`${input} mt-1`}
                  />
                  {amount !== null && !amountBad ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {cashSuggestions(amount).map((note) => (
                        <button
                          key={note}
                          type="button"
                          onClick={() => addPart(note)}
                          className="h-10 rounded-lg border border-pos-line bg-white px-3 text-sm font-semibold hover:bg-pos-50"
                        >
                          {money(note, currency)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {tendered !== null &&
                  amount !== null &&
                  tendered >= amount ? (
                    <p className="mt-1 font-semibold text-pos-700">
                      Change: {money(tendered - amount, currency)}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="pay-reference"
                    className="text-sm font-semibold text-pos-ink-2"
                  >
                    Reference (optional)
                  </label>
                  <input
                    id="pay-reference"
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    maxLength={80}
                    placeholder={
                      method === "transfer"
                        ? "The transfer's reference or sender"
                        : "The slip's number"
                    }
                    className={`${input} mt-1`}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => addPart()}
                disabled={amountBad || tenderedBad}
                className={quiet}
              >
                Add {methodLabel(method).toLowerCase()}{" "}
                {amount !== null && !amountBad ? money(amount, currency) : ""}
              </button>
            </>
          ) : null}
        </>
      ) : (
        <p className="rounded-xl bg-pos-50 p-3 font-semibold text-pos-700">
          Paid in full: {money(total, currency)}.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className={quiet}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onComplete}
          disabled={pending || remaining > 0}
          className={primary}
        >
          {pending ? "Saving…" : "Complete sale"}
        </button>
      </div>
    </div>
  );
}
