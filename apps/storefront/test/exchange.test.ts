// The exchange screen's maths mirrors the API's: BigInt only, rounded in the desk's favour, capped at the reserve, the
// customer's balance and the per-trade maximum, and never silently trimming what was typed.
import { describe, expect, test } from "vitest";
import { formatFace, type StoreExchange, type StoreExchangeSide } from "@bitocard/api-client/storefront";
import { availabilityText, changeText, exchangeHref, fiatParam, fiatText, initialSource, maximum, parseCoin, parseFiat, problem, reservePrices, terms, units, usdText, walletExchangeLinks } from "@/lib/exchange";
import { cryptoSections, subMenuFor } from "@/components/app/sub-menus";

const btcBuy: StoreExchangeSide = { price: 9_090_000_000, markup_bps: 100, min_fiat: 100, max_fiat: null, available_amount: "0.50000000", available_fiat: 4_545_000_000 };
const btcSell: StoreExchangeSide = { price: 8_820_000_000, markup_bps: 200, min_fiat: 100, max_fiat: 5_000_000, available_amount: "0.56689342", available_fiat: 5_000_000_000 };
const btc = { asset: "BTC", decimals: 8 };

describe("typing amounts", () => {
  test("money and coins as typed by people", () => {
    expect(parseFiat("1,650.5")).toBe(165_050n);
    expect(parseFiat("100")).toBe(10_000n);
    expect(parseFiat("1.234")).toBeNull();
    expect(parseFiat("abc")).toBeNull();
    expect(parseCoin("0.005", 8)).toBe(500_000n);
    expect(parseCoin("0.1234567", 6)).toBeNull();
    expect(units(110_011n, 8)).toBe("0.00110011");
    expect(fiatText(165_050n)).toBe("1650.50");
  });
});

describe("terms", () => {
  test("buying: coins rounded down, never charging more than typed", () => {
    const trade = terms("buy", 9_090_000_000n, 8, { fiat: 10_000_000n });
    expect(trade.amount).toBe(110_011n);
    expect(trade.fiat <= 10_000_000n).toBe(true);
  });

  test("selling: money rounded down, a typed money amount at least met", () => {
    expect(terms("sell", 8_820_000_000n, 8, { amount: 100_000n }).fiat).toBe(8_820_000n);
    expect(terms("sell", 8_820_000_000n, 8, { fiat: 10_000_000n }).fiat >= 10_000_000n).toBe(true);
  });
});

describe("limits", () => {
  test("the most to buy is the smallest of the reserve and the money held", () => {
    expect(maximum("buy", btcBuy, 8, { money: 909_000_000n, coins: 0n }).amount).toBe(10_000_000n);
    expect(maximum("buy", btcBuy, 8, { money: 100_000_000_000n, coins: 0n }).amount).toBe(50_000_000n);
  });

  test("the most to sell respects the per-trade maximum", () => {
    const most = maximum("sell", btcSell, 8, { money: 0n, coins: 100_000_000n });
    expect(most.fiat <= 5_000_000n).toBe(true);
  });

  test("over the reserve says so instead of trimming; then balance, then limits", () => {
    expect(problem("buy", btcBuy, btc, { amount: 60_000_000n, fiat: 5_454_000_000n }, { money: 10n ** 12n, coins: 0n })?.kind).toBe("reserve");
    expect(problem("buy", btcBuy, btc, { amount: 100_000n, fiat: 9_090_000n }, { money: 1_000n, coins: 0n })?.kind).toBe("money");
    expect(problem("sell", btcSell, btc, { amount: 100_000n, fiat: 8_820_000n }, { money: 0n, coins: 10n })?.kind).toBe("coins");
    expect(problem("sell", btcSell, btc, { amount: 100_000n, fiat: 8_820_000n }, { money: 0n, coins: 10n ** 9n })?.kind).toBe("above");
    expect(problem("buy", btcBuy, btc, { amount: 1n, fiat: 91n }, { money: 10n ** 9n, coins: 0n })?.kind).toBe("below");
    expect(problem("buy", btcBuy, btc, { amount: 110_011n, fiat: 10_000_000n }, { money: 10n ** 9n, coins: 0n })).toBeNull();
  });
});

describe("words", () => {
  test("market figures", () => {
    expect(changeText(1.84)).toBe("+1.84%");
    expect(changeText(-0.4)).toBe("−0.4%");
    expect(usdText("60000")).toBe("$60,000");
    expect(usdText("0.9996")).toBe("$0.9996");
  });

  test("Exchange sits in the Crypto rail right after Wallets", () => {
    expect(cryptoSections.map(item => item.label).slice(0, 3)).toEqual(["Wallets", "Exchange", "Market"]);
    expect(subMenuFor("/account/crypto/exchange", "asset=BTC&side=sell")).toMatchObject({ menu: { key: "crypto" }, active: "/account/crypto/exchange" });
  });
});

describe("links into the exchange", () => {
  const exchange: StoreExchange = {
    object: "exchange",
    mode: "test",
    currency: "NGN",
    desk: { id: "d", name: "BitoCard" },
    enabled: true,
    reason: null,
    message: null,
    quote_seconds: 30,
    balances: { proceeds: 0, wallet: 0 },
    assets: [
      { desk: { id: "d", name: "BitoCard" }, asset: "BTC", name: "Bitcoin", decimals: 8, holding: "0.00000000", market: null, closed: null, buy: btcBuy, sell: btcSell },
      { desk: { id: "d", name: "BitoCard" }, asset: "ETH", name: "Ether", decimals: 8, holding: "0.00000000", market: null, closed: "price_unavailable", buy: null, sell: null },
    ],
  };

  test("the exchange screen for a coin and side, with an amount only when there is one", () => {
    expect(exchangeHref({ asset: "BTC", side: "buy" })).toBe("/account/crypto/exchange?asset=BTC&side=buy");
    expect(exchangeHref({ asset: "BTC", side: "sell", fiat: 5_000_000 })).toBe("/account/crypto/exchange?asset=BTC&side=sell&fiat=5000000");
    expect(exchangeHref({ asset: "BTC", side: "buy", fiat: 0n })).toBe("/account/crypto/exchange?asset=BTC&side=buy");
  });

  test("?fiat= is whole minor units or nothing", () => {
    expect(fiatParam("5000000")).toBe(5_000_000n);
    expect(fiatParam("0")).toBeNull();
    expect(fiatParam("12.5")).toBeNull();
    expect(fiatParam("-1")).toBeNull();
    expect(fiatParam("1".repeat(16))).toBeNull();
    expect(fiatParam(undefined)).toBeNull();
  });

  test("wallet rows: Buy where the side is open, Sell only while holding some", () => {
    expect(walletExchangeLinks(exchange, "BTC", "0.00000000")).toEqual({ buy: "/account/crypto/exchange?asset=BTC&side=buy", sell: null });
    expect(walletExchangeLinks(exchange, "BTC", "0.10000000")).toEqual({ buy: "/account/crypto/exchange?asset=BTC&side=buy", sell: "/account/crypto/exchange?asset=BTC&side=sell" });
    expect(walletExchangeLinks(exchange, "ETH", "1.00000000")).toEqual({ buy: null, sell: null });
    expect(walletExchangeLinks(exchange, "DOGE", "1")).toEqual({ buy: null, sell: null });
    expect(walletExchangeLinks({ ...exchange, enabled: false }, "BTC", "1")).toEqual({ buy: null, sell: null });
    expect(walletExchangeLinks(null, "BTC", "1")).toEqual({ buy: null, sell: null });
  });

  test("quick buy or sell starts from the reserve where it has a price", () => {
    const prices = reservePrices(exchange);
    expect(prices).toEqual({ BTC: { buy: btcBuy.price, sell: btcSell.price }, ETH: { buy: null, sell: null } });
    expect(initialSource(prices, "BTC", "buy")).toBe("reserve");
    expect(initialSource(prices, "ETH", "sell")).toBe("p2p");
    expect(reservePrices({ ...exchange, enabled: false })).toEqual({});
    expect(initialSource({}, "BTC", "buy")).toBe("p2p");
  });

  test("the review says what the reserve has, and when the quote is all of it", () => {
    const quote = { side: "buy" as const, asset: "BTC", currency: "NGN", available: { amount: "0.42000000", fiat: 3_800_000_000 }, capped: false };
    expect(availabilityText(quote, "BitoCard")).toEqual({ line: "Up to 0.42 BTC available from BitoCard.", capped: null });
    const selling = availabilityText({ ...quote, side: "sell", capped: true }, "Ada's Store");
    expect(selling.line).toBe(`Up to ${formatFace(3_800_000_000, "NGN")} available from Ada's Store.`);
    expect(selling.capped).toBe("This quote is the most Ada's Store has available right now.");
  });
});
