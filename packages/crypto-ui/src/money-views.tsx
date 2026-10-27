import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AlertTriangle, Clock, ShieldCheck } from "lucide-react";
import {
  formatCrypto,
  formatFace,
  type StoreCryptoDeposit,
  type StoreCryptoDepositAddress,
  type StoreCryptoNetwork,
  type StoreCryptoWallets,
  type StoreCryptoWithdrawal,
  type StoreCustomerBankAccount,
  type StoreCustomerPayout,
  type StoreList,
  type StoreP2pCash,
  type StoreWithdrawalAddress,
  type StoreWithdrawalNetworks,
  type StoreWithdrawalPreview,
} from "@bitocard/api-client/storefront";
import { CoinBadge } from "./coins";
import {
  AddWithdrawalAddressForm,
  CancelWithdrawalButton,
  CashOutAccountForm,
  CashOutForm,
  CopyButton,
  CreateWithdrawalForm,
  DepositAddress,
  RemoveAddressButton,
  RemoveBankAccountButton,
  SimulatePayoutButtons,
  WithdrawalCodeForm,
  WithdrawForm,
} from "./money-forms";
import { addressQr } from "./qr";
import type { CustomerCall } from "./trade-actions";
import { cardClass, tradeDate } from "./trade-views";
import { CoinPicker, CryptoGate, VerifyFirst } from "./wallet-views";
import { depositStatus, payoutStatus, tradableAssets, withdrawableAssets, withdrawalExplained, withdrawalStatus } from "./wallets";

export { CoinPicker, CryptoGate } from "./wallet-views";

/** Where an app's money pages are (each with the coin and network chosen, when given). */
export type MoneyLinks = {
  deposit: (asset: string, chain?: string) => string;
  withdraw: (asset: string, chain?: string) => string;
  withdrawal: (id: string) => string;
  /** The identity check: on the customer's account app (BitoCard's own pages for it). */
  verification: string;
};

/** Sandbox stores and test mode: nothing here is on a real network or real money. */
function TestNote({ mode }: { mode?: string }) {
  return mode === "test" ? <p className="rounded-2xl bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 ring-1 ring-amber-200/70">Test network: nothing here is real money.</p> : null;
}

const choiceClass = "flex min-h-12 flex-col justify-center rounded-xl px-3 py-2 ring-1 ring-slate-200 aria-[current=true]:bg-pink-50 aria-[current=true]:ring-2 aria-[current=true]:ring-brand-500";

/** A network to choose (a link, so it works without script), the chosen one marked. */
function NetworkChoices({ id, items, current, href, note }: { id: string; items: Array<{ chain: string; name: string }>; current: string | null | undefined; href: (chain: string) => string; note: (chain: string) => string }) {
  return (
    <section className={cardClass} aria-labelledby={id}>
      <h2 id={id} className="mb-3 font-bold">
        Network
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map(item => (
          <Link key={item.chain} href={href(item.chain)} aria-current={item.chain === current ? "true" : undefined} className={choiceClass}>
            <span className="font-semibold">{item.name}</span>
            <span className="text-xs text-slate-500">{note(item.chain)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

type Search = { asset?: string; chain?: string };

/**
 * Depositing crypto: choose the coin, then its network, then the customer's own address for it (with its QR code,
 * drawn here on the server). The address is theirs for good; showing it watches it for deposits. Their recent deposits
 * show below. `api` is the app's customer API (the signed-in customer's session).
 */
export async function DepositBody({ api, params, links }: { api: CustomerCall; params: Search; links: MoneyLinks }) {
  const overview = await api<StoreCryptoWallets>("GET", "/v1/afrippa/crypto");
  const wallets = overview.ok ? overview.data : null;
  // Only coins still open for deposits (a coin switched off is listed while held, but takes no deposits).
  const assets = tradableAssets(wallets);
  const asked = (params.asset ?? "").toUpperCase();
  const asset = assets.includes(asked) ? asked : (assets[0] ?? "USDT");
  const blocked = !wallets || !wallets.enabled || wallets.frozen || !wallets.verified;
  if (blocked) return <CryptoGate wallets={wallets} verifyHref={links.verification} />;
  const [networks, deposits] = await Promise.all([
    api<StoreList<StoreCryptoNetwork>>("GET", `/v1/afrippa/crypto/deposit-networks?asset=${encodeURIComponent(asset)}`),
    api<StoreList<StoreCryptoDeposit>>("GET", "/v1/afrippa/crypto/deposits"),
  ]);
  const options = networks.ok ? networks.data.data : [];
  const network = options.find(item => item.chain === (params.chain ?? "").toUpperCase()) ?? (options.length === 1 ? options[0] : undefined);
  const address = network ? await api<StoreCryptoDepositAddress>("POST", "/v1/afrippa/crypto/deposit-addresses", { asset, chain: network.chain }) : null;
  const qr = address?.ok ? await addressQr(address.data.address) : null;

  return (
    <>
      <TestNote mode={wallets.mode} />
      <CoinPicker assets={assets} wallets={wallets} current={asset} href={code => links.deposit(code)} label="Coin to deposit" />
      {options.length ? (
        <NetworkChoices id="network" items={options} current={network?.chain} href={chain => links.deposit(asset, chain)} note={chain => options.find(item => item.chain === chain)?.token ?? `${asset} itself`} />
      ) : (
        <p className={cardClass}>{asset} deposits are not open yet. Buy it on the P2P market instead.</p>
      )}
      {address && !address.ok ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {address.message}
        </p>
      ) : null}
      {address?.ok && network ? (
        <DepositAddress
          key={`${asset}:${network.chain}`}
          asset={asset}
          network={network.name}
          token={network.token ?? null}
          address={address.data.address}
          contract={address.data.contract ?? null}
          confirmations={network.confirmations}
          qr={qr}
        />
      ) : null}
      {deposits.ok && deposits.data.data.length ? (
        <section className={cardClass} aria-labelledby="recent">
          <h2 id="recent" className="mb-1 font-bold">
            Recent deposits
          </h2>
          <ul className="divide-y divide-slate-100">
            {deposits.data.data.map(item => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <CoinBadge asset={item.asset} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{formatCrypto(item.amount, item.asset)}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {item.network} · {tradeDate(item.created_at)}
                  </span>
                </span>
                <span className={`shrink-0 text-sm font-semibold ${item.status === "credited" ? "text-emerald-700" : item.status === "pending" ? "text-amber-700" : "text-slate-500"}`}>
                  {depositStatus[item.status]}
                  {item.status === "pending" && item.confirmations_needed ? ` ${item.confirmations}/${item.confirmations_needed}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

const withdrawalTone = (status: StoreCryptoWithdrawal["status"]) => (status === "completed" ? "text-emerald-700" : ["failed", "rejected", "cancelled"].includes(status) ? "text-slate-500" : "text-amber-700");

/**
 * Withdrawing crypto: the coin, its network (with BitoCard's fee and the minimum), then one of the customer's saved
 * addresses (new ones usable after 24 hours) and the amount. The next step shows the total before anything moves, and
 * an emailed code confirms it. Withdrawing needs no crypto switch while they hold coins: only a verified, unfrozen account.
 */
export async function WithdrawBody({ api, params, links }: { api: CustomerCall; params: Search; links: MoneyLinks }) {
  const overview = await api<StoreCryptoWallets>("GET", "/v1/afrippa/crypto");
  const wallets = overview.ok ? overview.data : null;
  // What they hold, plus every tradable coin while crypto is open (a coin switched off can still be withdrawn).
  const assets = withdrawableAssets(wallets);
  const asked = (params.asset ?? "").toUpperCase();
  const asset = assets.includes(asked) ? asked : (wallets?.assets.find(item => Number(item.available) > 0)?.asset ?? assets[0] ?? "USDT");
  const balance = wallets?.assets.find(item => item.asset === asset);
  if (!wallets || assets.length === 0 || wallets.frozen || !wallets.verified) return <CryptoGate wallets={wallets} withdraw verifyHref={links.verification} />;
  const [networks, saved, history] = await Promise.all([
    api<StoreWithdrawalNetworks>("GET", `/v1/afrippa/crypto/withdrawal-networks?asset=${encodeURIComponent(asset)}`),
    api<StoreList<StoreWithdrawalAddress>>("GET", "/v1/afrippa/crypto/withdrawal-addresses"),
    api<StoreList<StoreCryptoWithdrawal>>("GET", "/v1/afrippa/crypto/withdrawals"),
  ]);
  const options = networks.ok ? networks.data.data : [];
  const network = options.find(item => item.chain === (params.chain ?? "").toUpperCase()) ?? (options.length === 1 ? options[0] : null);
  const addresses = saved.ok ? saved.data.data.filter(item => item.chain === network?.chain) : [];
  const ready = addresses.filter(item => item.ready);

  return (
    <>
      <TestNote mode={wallets.mode} />
      <CoinPicker assets={assets} wallets={wallets} current={asset} href={code => links.withdraw(code)} label="Coin to withdraw · available" show="available" />
      {balance ? (
        <p className="text-sm text-slate-600">
          Available: <span className="font-semibold text-navy-900">{formatCrypto(balance.available, asset)}</span>
          {networks.ok ? ` · You can send up to ${formatCrypto(networks.data.remaining_today, asset)} more today` : ""}
        </p>
      ) : null}
      {options.length ? (
        <NetworkChoices id="network" items={options} current={network?.chain} href={chain => links.withdraw(asset, chain)} note={chain => `Fee ${formatCrypto(options.find(item => item.chain === chain)?.fee ?? "0", asset)}`} />
      ) : (
        <p className={cardClass}>{asset} withdrawals are not open yet.</p>
      )}
      {network ? (
        <>
          <section className={cardClass} aria-labelledby="send">
            <h2 id="send" className="mb-3 font-bold">
              Send {asset} on {network.name}
            </h2>
            {ready.length ? (
              <WithdrawForm asset={asset} chain={network.chain} addresses={ready} minimum={formatCrypto(network.minimum)} />
            ) : (
              <p className="text-sm text-slate-600">Save an address below first. You can send to it 24 hours after you add it.</p>
            )}
            <p className="mt-4 flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Only send to an address that takes {asset} on {network.name}. Crypto sent to the wrong address or network cannot be got back.
              </span>
            </p>
          </section>
          <section className={cardClass} aria-labelledby="addresses">
            <h2 id="addresses" className="mb-1 font-bold">
              Your {network.name} addresses
            </h2>
            {addresses.length ? (
              <ul className="mb-4 divide-y divide-slate-100">
                {addresses.map(item => (
                  <li key={item.id} className="flex items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{item.label}</span>
                      <span className="block truncate font-mono text-xs text-slate-500">{item.address}</span>
                      {!item.ready ? (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-700">
                          <Clock className="size-3.5" aria-hidden="true" /> Usable from {tradeDate(item.usable_from)}
                        </span>
                      ) : null}
                    </span>
                    <RemoveAddressButton id={item.id} label={item.label} />
                  </li>
                ))}
              </ul>
            ) : null}
            <AddWithdrawalAddressForm chain={network.chain} network={network.name} />
          </section>
        </>
      ) : null}
      {history.ok && history.data.data.length ? (
        <section className={cardClass} aria-labelledby="recent">
          <h2 id="recent" className="mb-1 font-bold">
            Recent withdrawals
          </h2>
          <ul className="divide-y divide-slate-100">
            {history.data.data.map(item => (
              <li key={item.id}>
                <Link href={links.withdrawal(item.id)} className="flex items-center gap-3 py-3">
                  <CoinBadge asset={item.asset} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{formatCrypto(item.amount, item.asset)}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {item.network} · {tradeDate(item.created_at)}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sm font-semibold ${withdrawalTone(item.status)}`}>{withdrawalStatus[item.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

type ReviewSearch = { asset?: string; chain?: string; address?: string; amount?: string };

/** A withdrawal's review query is well formed (the API checks everything else). */
export const reviewValid = (params: ReviewSearch) =>
  /^[A-Z0-9]{2,10}$/.test(params.asset ?? "") && /^[A-Z]{3,10}$/.test(params.chain ?? "") && /^[0-9a-f-]{36}$/.test(params.address ?? "") && /^\d+(\.\d+)?$/.test(params.amount ?? "");

/** The withdrawal exactly as it will be sent: the address, the amount, BitoCard's fee and the total. Nothing moves yet. */
export async function WithdrawReviewBody({ api, params, links }: { api: CustomerCall; params: ReviewSearch; links: MoneyLinks }) {
  const preview = reviewValid(params)
    ? await api<StoreWithdrawalPreview>("POST", "/v1/afrippa/crypto/withdrawals", { asset: params.asset, chain: params.chain, address_id: params.address, amount: params.amount, preview: true })
    : null;
  const back = links.withdraw(params.asset ?? "", params.chain ?? "");
  if (!preview?.ok) {
    return (
      <div className={cardClass} role="alert">
        <p className="font-semibold">This withdrawal cannot be made</p>
        <p className="mt-1 text-sm text-slate-600">{preview && !preview.ok ? preview.message : "Check the amount and address and try again."}</p>
        <Link href={back} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
          Back to withdraw
        </Link>
      </div>
    );
  }
  const quote = preview.data;
  const rows: Array<[string, string, boolean?]> = [
    ["Network", quote.network],
    ["BitoCard network fee", formatCrypto(quote.fee, quote.asset)],
    ["Taken from your wallet", formatCrypto(quote.total, quote.asset), true],
  ];
  return (
    <section className={cardClass} aria-label="Withdrawal details">
      <div className="flex items-center gap-3">
        <CoinBadge asset={quote.asset} size="size-12" />
        <div>
          <p className="text-sm text-slate-500">You send</p>
          <p className="font-display text-2xl font-extrabold">{formatCrypto(quote.amount, quote.asset)}</p>
        </div>
      </div>
      <dl className="mt-4 divide-y divide-slate-100 text-sm">
        <div className="py-2.5">
          <dt className="text-slate-500">To</dt>
          <dd className="mt-1 font-mono text-sm break-all">{quote.address}</dd>
        </div>
        {rows.map(([label, value, strong]) => (
          <div key={label} className="flex justify-between gap-4 py-2.5">
            <dt className="text-slate-500">{label}</dt>
            <dd className={strong ? "font-bold" : "font-semibold"}>{value}</dd>
          </div>
        ))}
      </dl>
      {quote.needs_approval ? (
        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
          BitoCard checks this withdrawal before it is sent. It stays out of your wallet meanwhile, and comes back if it is not sent.
        </p>
      ) : null}
      <p className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Check the address: once sent, crypto cannot be got back.
      </p>
      <div className="mt-4">
        <CreateWithdrawalForm asset={quote.asset} chain={quote.chain} addressId={params.address!} amount={params.amount!} nonce={randomUUID()} />
      </div>
    </section>
  );
}

/** A withdrawal's ID is a UUID (anything else is not found, without asking the API). */
export const isId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

/** One withdrawal: what was sent where, its status, and (while it waits) the code to confirm it or a way to cancel. */
export function WithdrawalBody({ item }: { item: StoreCryptoWithdrawal }) {
  const open = item.status === "awaiting_code" || item.status === "review";
  return (
    <>
      <section className={cardClass} aria-label="Withdrawal details">
        <div className="flex items-center gap-3">
          <CoinBadge asset={item.asset} size="size-12" />
          <div>
            <p className="text-sm text-slate-500">{withdrawalStatus[item.status]}</p>
            <p className="font-display text-2xl font-extrabold">{formatCrypto(item.amount, item.asset)}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-600">{withdrawalExplained[item.status]}</p>
        <dl className="mt-3 divide-y divide-slate-100 text-sm">
          <div className="flex justify-between gap-4 py-2.5">
            <dt className="text-slate-500">Network</dt>
            <dd className="font-semibold">{item.network}</dd>
          </div>
          <div className="py-2.5">
            <dt className="text-slate-500">To</dt>
            <dd className="mt-1 font-mono text-sm break-all">{item.address}</dd>
          </div>
          <div className="flex justify-between gap-4 py-2.5">
            <dt className="text-slate-500">Fee</dt>
            <dd className="font-semibold">{formatCrypto(item.fee, item.asset)}</dd>
          </div>
          <div className="flex justify-between gap-4 py-2.5">
            <dt className="text-slate-500">Asked for</dt>
            <dd>{tradeDate(item.created_at)}</dd>
          </div>
          {item.tx_hash ? (
            <div className="py-2.5">
              <dt className="text-slate-500">Transaction</dt>
              <dd className="mt-1 font-mono text-xs break-all">{item.tx_hash}</dd>
              <dd className="mt-2">
                <CopyButton text={item.tx_hash} label="Copy transaction" />
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
      {item.status === "awaiting_code" ? (
        <section className={cardClass} aria-label="Confirm">
          <WithdrawalCodeForm id={item.id} />
        </section>
      ) : null}
      {open ? <CancelWithdrawalButton id={item.id} /> : null}
    </>
  );
}

/**
 * Paying P2P money (from selling crypto) out to the customer's own bank account: what can be paid out now and what
 * waits for the payout hold, their bank accounts (in their own name, in their own country) and their payouts.
 */
export async function CashOutBody({ api, links }: { api: CustomerCall; links: Pick<MoneyLinks, "verification"> }) {
  const [cash, accounts, payouts] = await Promise.all([
    api<StoreP2pCash>("GET", "/v1/store/cash"),
    api<StoreList<StoreCustomerBankAccount>>("GET", "/v1/store/cash/bank-accounts"),
    api<StoreList<StoreCustomerPayout>>("GET", "/v1/store/cash/payouts"),
  ]);
  const banks = cash.ok ? await api<StoreList<{ code: string; name: string }>>("GET", "/v1/store/cash/banks") : null;
  const money = cash.ok ? cash.data : null;
  const saved = accounts.ok ? accounts.data.data : [];

  return (
    <>
      {!cash.ok && cash.code === "customer_verification_required" ? (
        <VerifyFirst href={links.verification} title="Verify your identity to cash out" text="We pay P2P money only into an account in your own name, so we need a quick identity check first, once." />
      ) : !cash.ok ? (
        <p className={cardClass} role="alert">
          {cash.message}
        </p>
      ) : null}
      {money ? (
        <>
          <TestNote mode={money.mode} />
          <section className={cardClass} aria-label="Your P2P money">
            <p className="text-sm text-slate-500">P2P money you can pay out now</p>
            <p className="font-display text-3xl font-extrabold">{formatFace(money.available, money.currency)}</p>
            {money.held > 0 ? (
              <p className="mt-1 text-sm text-slate-600">
                {formatFace(money.held, money.currency)} more becomes available {money.hold_days} days after each sale.
              </p>
            ) : null}
            <p className="mt-1 text-xs text-slate-500">The smallest payout is {formatFace(money.minimum, money.currency)}.</p>
          </section>
        </>
      ) : null}
      {money && saved.length ? (
        <section className={cardClass} aria-labelledby="pay-out">
          <h2 id="pay-out" className="mb-3 font-bold">
            Pay out
          </h2>
          <CashOutForm
            nonce={randomUUID()}
            currency={money.currency}
            available={formatFace(money.available, money.currency)}
            accounts={saved.map(item => ({ id: item.id, label: `${item.bank_name} ••••${item.account_number_last4}`, ready: item.ready, from: tradeDate(item.payouts_available_from) }))}
          />
        </section>
      ) : null}
      {money ? (
        <section className={cardClass} aria-labelledby="accounts">
          <h2 id="accounts" className="mb-1 font-bold">
            Your bank accounts
          </h2>
          {saved.length ? (
            <ul className="mb-4 divide-y divide-slate-100">
              {saved.map(item => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {item.bank_name} ••••{item.account_number_last4}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{item.account_name}</span>
                  </span>
                  <RemoveBankAccountButton id={item.id} label={`${item.bank_name} ending ${item.account_number_last4}`} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-slate-600">Add the bank account to pay your P2P money into. It must be in your own name.</p>
          )}
          {banks?.ok ? <CashOutAccountForm banks={banks.data.data} /> : banks ? <p className="text-sm text-red-700">{banks.message}</p> : null}
        </section>
      ) : null}
      {payouts.ok && payouts.data.data.length ? (
        <section className={cardClass} aria-labelledby="payouts">
          <h2 id="payouts" className="mb-1 font-bold">
            Payouts
          </h2>
          <ul className="divide-y divide-slate-100">
            {payouts.data.data.map(item => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{formatFace(item.amount, item.currency)}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {item.bank_account ? `${item.bank_account.bank_name} ••••${item.bank_account.account_number_last4} · ` : ""}
                    {tradeDate(item.created_at)}
                  </span>
                  {item.failure_reason ? <span className="block text-xs text-red-700">{item.failure_reason}</span> : null}
                </span>
                <span className={`shrink-0 text-sm font-semibold ${item.status === "paid" ? "text-emerald-700" : item.status === "failed" ? "text-slate-500" : "text-amber-700"}`}>{payoutStatus[item.status]}</span>
                {item.mode === "test" && (item.status === "pending" || item.status === "processing") ? <SimulatePayoutButtons id={item.id} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
