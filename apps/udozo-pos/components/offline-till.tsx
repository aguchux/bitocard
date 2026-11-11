"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PinPad } from "@/components/pin-pad";
import { cashSuggestions, findProducts, money, paymentMethods, readAmount, tillShown, tillTotals } from "@/lib/pos";
import { freeNow, type LocalSale, makeSale, maySell, type OfflineCopy, type OfflineMeta, type OfflinePayment, type OfflinePaymentMethod, offlineState, provisionalNumber, soldSince } from "@/lib/offline-rules";
import { checkPin, hasPinCheck, readCopy, readMeta, readSales, saveSale, writeMeta } from "@/lib/offline-store";
import { syncNow } from "@/lib/offline-sync";

type Person = OfflineCopy["staff"][number];
type Loaded = { copy: OfflineCopy | null; meta: OfflineMeta; sales: LocalSale[]; checks: Set<string> };

const newId = () => crypto.randomUUID();
const button = "inline-flex h-12 items-center justify-center rounded-xl px-5 font-bold disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} bg-pos-600 text-white hover:bg-pos-700`;
const quiet = `${button} border border-pos-line bg-white text-pos-ink hover:bg-pos-50`;
const statusWords: Record<LocalSale["status"], string> = { waiting: "Waiting to upload", uploaded: "Uploaded", flagged: "Uploaded, to look at", failed: "Refused" };

async function load(): Promise<Loaded> {
  const [copy, meta, sales] = await Promise.all([readCopy(), readMeta(), readSales()]);
  const checks = new Set<string>();
  for (const person of copy?.staff ?? []) if (await hasPinCheck(person.id)) checks.add(person.id);
  return { copy, meta, sales, checks };
}

/**
 * The offline till (milestone 9): opens from the service worker's cache with no internet. Staff who signed in here
 * online sign in with their PIN against this till's own check; they sell from the till's copy (its prices, what was
 * free less what this till sold since) for cash, card, a transfer to the shop or another recorded payment; each sale is
 * saved on the device with a provisional number naming the till, printed with the browser, and uploaded in order as
 * soon as there is a connection. It stops selling past 72 hours or 500 sales offline.
 */
export function OfflineTill() {
  const [data, setData] = useState<Loaded | null>(null);
  const [now, setNow] = useState(0);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [chosen, setChosen] = useState<Person | null>(null);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [words, setWords] = useState("");
  const [cart, setCart] = useState<Array<{ id: string; quantity: number }>>([]);
  const [discountText, setDiscountText] = useState("");
  const [payments, setPayments] = useState<OfflinePayment[]>([]);
  const [method, setMethod] = useState<OfflinePaymentMethod>("cash");
  const [amountText, setAmountText] = useState("");
  const [tenderedText, setTenderedText] = useState("");
  const [done, setDone] = useState<LocalSale | null>(null);

  const reload = useCallback(() => load().then(next => (setData(next), setNow(Date.now()))), []);
  const sync = useCallback(async () => {
    setSyncing(true);
    await syncNow();
    await reload();
    setSyncing(false);
  }, [reload]);

  useEffect(() => {
    const first = setTimeout(() => {
      setOnline(navigator.onLine);
      void reload();
      if (navigator.onLine) void sync();
    }, 0);
    const goOnline = () => {
      setOnline(true);
      void sync();
    };
    const goOffline = () => setOnline(false);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [reload, sync]);

  const copy = data?.copy ?? null;
  const currency = copy?.account.currency ?? "NGN";
  const sold = useMemo(() => soldSince(data?.sales ?? []), [data]);
  const products = useMemo(() => (copy?.products ?? []).filter(product => product.price !== null && product.blocked !== "plan_limit"), [copy]);
  const byId = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const waiting = (data?.sales ?? []).filter(sale => sale.status === "waiting").length;

  if (!data) return <p className="p-6 text-pos-ink-2">Opening the till…</p>;
  const state = offlineState(copy, data.meta, now || new Date(copy?.synced_at ?? 0).getTime());

  const header = (
    <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-white p-4">
      <div>
        <p className="font-display text-xl font-bold text-pos-ink">{copy ? `${copy.shop.name} · ${copy.till.name}` : "Offline till"}</p>
        <p className="text-sm text-pos-muted">
          {online ? "Online" : "Offline"} · {waiting ? `${waiting} ${waiting === 1 ? "sale" : "sales"} waiting to upload` : "Nothing waiting to upload"}
          {copy ? ` · copy from ${new Date(copy.synced_at).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}` : ""}
        </p>
      </div>
      <span className="flex flex-wrap gap-2">
        {online ? (
          <button type="button" onClick={() => void sync()} disabled={syncing} className={quiet}>
            {syncing ? "Syncing…" : "Upload and sync"}
          </button>
        ) : null}
        {online ? (
          <a href="/app/till" className={`${primary} no-underline`}>
            Back to the online till
          </a>
        ) : null}
        {person ? (
          <button
            type="button"
            onClick={() => {
              setPerson(null);
              setCart([]);
              setPayments([]);
              setDone(null);
            }}
            className={quiet}
          >
            Switch user
          </button>
        ) : null}
      </span>
    </div>
  );

  if (!state.canSell) {
    return (
      <div className="grid gap-4">
        {header}
        <section role="alert" className="rounded-[20px] bg-white p-6">
          <h1 className="font-display text-2xl font-bold text-pos-ink">This till cannot sell offline now</h1>
          <p className="mt-2 text-pos-ink-2">{state.reason}</p>
        </section>
        <RecentSales sales={data.sales} currency={currency} />
      </div>
    );
  }

  // ---- Who is selling ----
  if (!person) {
    const people = copy!.staff.filter(maySell);
    if (chosen) {
      return (
        <div className="grid gap-4">
          {header}
          <section aria-labelledby="pin" className="mx-auto grid w-full max-w-sm gap-4 rounded-[20px] bg-white p-6">
            <h1 id="pin" className="font-display text-2xl font-bold text-pos-ink">
              Signing in as {chosen.name}
            </h1>
            <PinPad
              value={pin}
              label="Your PIN"
              autoFocus
              onChange={next => {
                setPin(next);
                if (next.length !== 4) return;
                void checkPin(chosen.id, next).then(answer => {
                  setPin("");
                  if (answer === "ok") {
                    setPerson(chosen);
                    setChosen(null);
                    setMessage(null);
                  } else setMessage(answer === "locked" ? "Too many wrong PINs on this till. Try again in 15 minutes." : answer === "unknown" ? "Sign in on this till once while it is online first." : "That PIN is not right.");
                });
              }}
            />
            {message ? (
              <p role="alert" className="font-semibold text-pos-error">
                {message}
              </p>
            ) : null}
            <button type="button" onClick={() => (setChosen(null), setPin(""), setMessage(null))} className="h-12 rounded-xl border border-pos-line font-bold">
              Not you? Back
            </button>
          </section>
        </div>
      );
    }
    return (
      <div className="grid gap-4">
        {header}
        {state.warn ? (
          <p role="alert" className="rounded-xl bg-pos-warn-bg px-4 py-3 font-semibold text-pos-warn">
            {state.warn}
          </p>
        ) : null}
        <section aria-labelledby="who" className="grid gap-4">
          <h1 id="who" className="font-display text-3xl font-bold text-pos-ink">
            Who’s selling?
          </h1>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {people.map(row => {
              const ready = data.checks.has(row.id);
              return (
                <li key={row.id}>
                  <button type="button" disabled={!ready} onClick={() => setChosen(row)} className="flex w-full flex-col items-center gap-2 rounded-[20px] border border-pos-line bg-white p-4 hover:bg-pos-50 disabled:opacity-50">
                    <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-pos-50 font-display text-xl font-bold text-pos-700">
                      {row.initials}
                    </span>
                    <span className="font-semibold text-pos-ink">{row.name}</span>
                    <span className="text-sm text-pos-muted">{ready ? row.role.name : "Sign in here online once first"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <RecentSales sales={data.sales} currency={currency} />
      </div>
    );
  }

  // ---- A sale done ----
  if (done) {
    return (
      <div className="grid gap-4">
        {header}
        <OfflineReceipt sale={done} copy={copy!} />
        <div className="no-print flex flex-wrap gap-2">
          <button type="button" onClick={() => window.print()} className={quiet}>
            Print receipt
          </button>
          <button type="button" autoFocus onClick={() => (setDone(null), setCart([]), setPayments([]), setDiscountText(""))} className={primary}>
            New sale
          </button>
        </div>
      </div>
    );
  }

  // ---- Selling ----
  const lines = cart.flatMap(line => {
    const product = byId.get(line.id);
    return product ? [{ product, quantity: line.quantity }] : [];
  });
  const discount = readAmount(discountText) ?? 0;
  const totals = tillTotals(lines.map(line => ({ id: line.product.id, unit: line.product.price!, quantity: line.quantity })), { discount, vatBps: copy!.shop.vat_bps });
  const limit = person.role.discount_limit_bps;
  const overLimit = limit !== null && totals.subtotal > 0 && Math.ceil((totals.discount * 10_000) / totals.subtotal) > limit;
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const remaining = Math.max(0, totals.total - paid);
  const found = findProducts(products, words).matches.slice(0, tillShown);
  const add = (id: string) => {
    const product = byId.get(id);
    if (!product) return;
    const free = freeNow(product, sold);
    const line = cart.find(item => item.id === id);
    if ((line?.quantity ?? 0) >= free) {
      setMessage(free ? `Only ${free} of “${product.title}” free on this till's copy.` : `“${product.title}” is out of stock on this till's copy.`);
      return;
    }
    setMessage(null);
    setCart(line ? cart.map(item => (item.id === id ? { ...item, quantity: item.quantity + 1 } : item)) : [...cart, { id, quantity: 1 }]);
  };
  const addPayment = () => {
    const amount = readAmount(amountText) ?? remaining;
    if (amount <= 0 || amount > remaining) return setMessage("Take an amount up to what is left to pay.");
    const tendered = method === "cash" && tenderedText.trim() ? readAmount(tenderedText) : null;
    if (method === "cash" && tenderedText.trim() && (tendered === null || tendered < amount)) return setMessage("The cash handed over must cover the cash part.");
    setPayments(current => [...current, { method, amount, tendered, reference: null }]);
    setAmountText("");
    setTenderedText("");
    setMessage(null);
  };
  const complete = async () => {
    if (overLimit) return setMessage("That discount is more than your role allows. A manager can give it online.");
    const meta = await readMeta();
    const made = makeSale({
      client_sale_id: newId(),
      client_number: provisionalNumber(copy!.till.name, meta.next_number),
      now: new Date(),
      staff: { id: person.id, name: person.name },
      lines: lines.map(line => ({ listing_id: line.product.id, title: line.product.title ?? "Untitled", quantity: line.quantity, unit_price: line.product.price! })),
      discount: totals.discount,
      vat_bps: copy!.shop.vat_bps,
      payments,
    });
    if (!made.ok) return setMessage(made.message);
    // The sale and the device's count are saved before it is shown as done.
    await saveSale(made.sale);
    await writeMeta({ ...meta, next_number: meta.next_number + 1, offline_sales: meta.offline_sales + 1 });
    setDone(made.sale);
    await reload();
    if (navigator.onLine) void sync();
  };

  return (
    <div className="grid gap-4">
      {header}
      {state.warn ? (
        <p role="alert" className="rounded-xl bg-pos-warn-bg px-4 py-3 font-semibold text-pos-warn">
          {state.warn}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <section aria-label="Products" className="grid min-w-0 gap-3">
          <label htmlFor="offline-search" className="sr-only">
            Scan or find a product
          </label>
          <input
            id="offline-search"
            autoFocus
            value={words}
            onChange={event => setWords(event.target.value)}
            onKeyDown={event => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const result = findProducts(products, words);
              const pick = result.exact ?? (result.matches.length === 1 ? result.matches[0] : null);
              if (pick) {
                add(pick.id);
                setWords("");
              } else setMessage(words.trim() ? `Nothing on this till matches “${words.trim()}”.` : null);
            }}
            placeholder="Scan a barcode, or type a name or SKU"
            autoComplete="off"
            className="h-12 w-full min-w-0 rounded-xl border border-pos-line bg-white px-4"
          />
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {found.map(product => {
              const free = freeNow(product, sold);
              return (
                <li key={product.id} className="min-w-0">
                  <button type="button" disabled={free === 0} onClick={() => add(product.id)} className="grid h-full w-full content-start gap-1 rounded-[16px] bg-white p-2 text-left hover:ring-2 hover:ring-pos-600 disabled:opacity-55">
                    <span className="line-clamp-2 text-sm font-semibold text-pos-ink">{product.title ?? "Untitled"}</span>
                    <span className="font-display font-bold text-pos-ink">{money(product.price!, currency)}</span>
                    <span className={`text-xs ${free ? "text-pos-muted" : "text-pos-warn"}`}>{free ? `${free} free` : "Out of stock"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-label="Basket" className="grid gap-3 rounded-[20px] bg-white p-4">
          <h2 className="font-display text-xl font-bold text-pos-ink">Basket</h2>
          {lines.length ? (
            <ul className="grid gap-2">
              {lines.map(line => (
                <li key={line.product.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {line.product.title} × {line.quantity}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{money(line.product.price! * line.quantity, currency)}</span>
                    <button type="button" onClick={() => setCart(current => current.flatMap(item => (item.id !== line.product.id ? [item] : item.quantity > 1 ? [{ ...item, quantity: item.quantity - 1 }] : [])))} className="h-9 rounded-lg border border-pos-line px-2" aria-label={`One fewer ${line.product.title}`}>
                      −
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-pos-muted">Scan or tap a product.</p>
          )}
          {limit !== 0 ? (
            <label className="grid gap-1 text-sm font-semibold text-pos-ink-2">
              Discount on the sale
              <input inputMode="decimal" value={discountText} onChange={event => setDiscountText(event.target.value)} placeholder="0" className="h-11 rounded-xl border border-pos-line px-3 font-normal" />
            </label>
          ) : null}
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt>Subtotal</dt>
            <dd className="text-right">{money(totals.subtotal, currency)}</dd>
            {totals.discount ? (
              <>
                <dt>Discount</dt>
                <dd className="text-right">−{money(totals.discount, currency)}</dd>
              </>
            ) : null}
            {totals.vat ? (
              <>
                <dt>VAT</dt>
                <dd className="text-right">{money(totals.vat, currency)}</dd>
              </>
            ) : null}
            <dt className="font-bold">Total</dt>
            <dd className="text-right font-display text-lg font-bold">{money(totals.total, currency)}</dd>
          </dl>
          {lines.length ? (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-semibold text-pos-ink-2">Payment ({money(remaining, currency)} left)</legend>
              <div className="flex flex-wrap gap-2">
                {paymentMethods.map(item => (
                  <button key={item.value} type="button" aria-pressed={method === item.value} onClick={() => setMethod(item.value)} className={`h-10 rounded-full px-4 text-sm font-semibold ${method === item.value ? "bg-pos-600 text-white" : "border border-pos-line bg-white"}`}>
                    {item.label}
                  </button>
                ))}
              </div>
              <input inputMode="decimal" value={amountText} onChange={event => setAmountText(event.target.value)} placeholder={`Amount (${(remaining / 100).toFixed(2)})`} aria-label="Amount" className="h-11 rounded-xl border border-pos-line px-3" />
              {method === "cash" ? (
                <>
                  <input inputMode="decimal" value={tenderedText} onChange={event => setTenderedText(event.target.value)} placeholder="Cash handed over (optional)" aria-label="Cash handed over" className="h-11 rounded-xl border border-pos-line px-3" />
                  <span className="flex flex-wrap gap-1">
                    {cashSuggestions(remaining).map(value => (
                      <button key={value} type="button" onClick={() => setTenderedText((value / 100).toFixed(2))} className="h-9 rounded-lg border border-pos-line px-2 text-sm">
                        {money(value, currency)}
                      </button>
                    ))}
                  </span>
                </>
              ) : null}
              <button type="button" onClick={addPayment} disabled={remaining === 0} className={quiet}>
                Take this payment
              </button>
              {payments.length ? (
                <ul className="grid gap-1 text-sm">
                  {payments.map((payment, index) => (
                    <li key={index} className="flex justify-between">
                      <span>
                        {paymentMethods.find(item => item.value === payment.method)?.label}
                        {payment.tendered !== null ? ` (handed ${money(payment.tendered, currency)}, change ${money(payment.tendered - payment.amount, currency)})` : ""}
                      </span>
                      <button type="button" onClick={() => setPayments(current => current.filter((_, at) => at !== index))} className="font-semibold">
                        {money(payment.amount, currency)} ✕
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </fieldset>
          ) : null}
          {message ? (
            <p role="alert" className="text-sm font-semibold text-pos-error">
              {message}
            </p>
          ) : null}
          <button type="button" onClick={() => void complete()} disabled={!lines.length || remaining !== 0} className={primary}>
            Complete sale
          </button>
        </section>
      </div>
      <RecentSales sales={data.sales} currency={currency} />
    </div>
  );
}

/** The latest sales on this till, with where each stands. */
function RecentSales({ sales, currency }: { sales: LocalSale[]; currency: string }) {
  const latest = [...sales].reverse().slice(0, 10);
  if (!latest.length) return null;
  return (
    <section aria-labelledby="recent" className="no-print grid gap-2 rounded-[20px] bg-white p-4">
      <h2 id="recent" className="font-display text-lg font-bold text-pos-ink">
        Sales on this till
      </h2>
      <ul className="grid gap-1 text-sm">
        {latest.map(sale => (
          <li key={sale.client_sale_id} className="flex flex-wrap justify-between gap-2 border-t border-pos-line pt-1">
            <span>
              {sale.number ?? sale.client_number} · {money(sale.total, currency)} · {sale.staff_name}
            </span>
            <span className={sale.status === "failed" ? "font-semibold text-pos-error" : sale.status === "waiting" ? "text-pos-warn" : "text-pos-muted"}>
              {statusWords[sale.status]}
              {sale.error ? `: ${sale.error}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A sale's receipt as the till prints it offline: the shop, the provisional number, lines, totals and payments. */
function OfflineReceipt({ sale, copy }: { sale: LocalSale; copy: OfflineCopy }) {
  const currency = copy.account.currency;
  return (
    <section aria-label="Receipt" className="mx-auto w-full max-w-sm rounded-[20px] bg-white p-5 font-mono text-sm text-pos-ink">
      <p className="text-center font-bold">{copy.shop.name}</p>
      {copy.shop.address ? <p className="text-center">{copy.shop.address}</p> : null}
      {copy.shop.phone ? <p className="text-center">{copy.shop.phone}</p> : null}
      {copy.shop.tin ? <p className="text-center">TIN {copy.shop.tin}</p> : null}
      <p className="mt-2">
        Receipt {sale.client_number} · {copy.till.name}
      </p>
      <p>{new Date(sale.created_at).toLocaleString("en-GB")}</p>
      <p>Served by {sale.staff_name}</p>
      <ul className="my-2 border-y border-dashed border-pos-line py-2">
        {sale.lines.map(line => (
          <li key={line.listing_id} className="flex justify-between gap-2">
            <span className="min-w-0">
              {line.title} × {line.quantity}
            </span>
            <span>{money(line.unit_price * line.quantity, currency)}</span>
          </li>
        ))}
      </ul>
      {sale.discount ? <p className="flex justify-between">Discount <span>−{money(sale.discount, currency)}</span></p> : null}
      {sale.vat ? <p className="flex justify-between">VAT ({(sale.vat_bps / 100).toFixed(2).replace(/\.?0+$/, "")}%) <span>{money(sale.vat, currency)}</span></p> : null}
      <p className="flex justify-between font-bold">
        Total <span>{money(sale.total, currency)}</span>
      </p>
      {sale.payments.map((payment, index) => (
        <p key={index} className="flex justify-between">
          {paymentMethods.find(item => item.value === payment.method)?.label ?? payment.method} <span>{money(payment.amount, currency)}</span>
        </p>
      ))}
      {sale.change ? <p className="flex justify-between">Change <span>{money(sale.change, currency)}</span></p> : null}
      <p className="mt-2 text-center text-xs">Made offline: its final number comes when the till is back online.</p>
      {copy.shop.receipt_footer ? <p className="mt-2 text-center">{copy.shop.receipt_footer}</p> : null}
    </section>
  );
}
