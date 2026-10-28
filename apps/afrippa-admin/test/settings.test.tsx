import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({ id: "t1" }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/" }));

await import("@/app/admin-product");
const { default: FeeRatesPage } = await import("@/app/(console)/settings/page");
const { default: MarketLimitsPage } = await import("@/app/(console)/settings/limits/page");
const { default: TwoStepMethodsPage } = await import("@/app/(console)/settings/two-step/page");
const { default: RefusedWordsPage } = await import("@/app/(console)/settings/words/page");
const { default: BooksPage } = await import("@/app/(console)/books/page");
const { default: TicketsPage } = await import("@/app/(console)/support/page");
const { TraderStanding } = await import("@/components/trader-standing");

const admin = { id: "a1", name: "Ada Okafor", email: "ada@afrippa.com", roles: ["operations", "finance"] };
const traderId = "5b1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";
const limit = { object: "crypto_market_limit", mode: "live", market: "NG", currency: "NGN", per_trade: 50000000, per_day: null, cross_border_per_trade: null, cross_border_per_day: null, new_trader_per_trade: 10000000, new_trader_per_day: null, updated_at: "2026-10-27T00:00:00.000Z" };
const standing = {
  object: "p2p_standing",
  mode: "live",
  strikes: 3,
  strike_limit: 3,
  strike_window_days: 90,
  cancellations_today: 1,
  cancellation_limit: 3,
  restriction: { code: "trading_suspended", until: null, message: "Your trading is paused after three strikes." },
  lost_appeals: [{ order_id: "o1", number: "ORD-000009", decided_at: "2026-10-20T00:00:00.000Z" }],
  upheld_reports: [],
  cleared_at: null,
};

let sent: Array<{ method: string; path: string; body: unknown }>;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: `${url.pathname}${url.search}`, body });
    const path = url.pathname;
    const ok = (value: unknown) => Response.json(value);
    if (path === "/v1/afrippa/admin/auth/session") return ok({ object: "admin_session", admin });
    if (path === "/v1/afrippa/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (path === "/v1/afrippa/admin/crypto/assets") return ok({ object: "list", data: [{ code: "USDT" }, { code: "BTC" }] });
    if (path === "/v1/afrippa/admin/p2p/fee-rates" && input.method === "GET") return ok({ object: "list", max_bps: 1000, data: [{ object: "p2p_fee_rate", asset: "USDT", market: null, buyer_bps: 30, seller_bps: 20 }] });
    if (path === "/v1/afrippa/admin/p2p/fee-rates") return ok({ object: "p2p_fee_rate", asset: "BTC", market: "NG", buyer_bps: 25, seller_bps: 50 });
    if (path === "/v1/afrippa/admin/crypto/market-limits" && input.method === "GET") return ok({ object: "list", data: [limit] });
    if (path === "/v1/afrippa/admin/crypto/market-limits") return ok({ ...limit, ...(body as object) });
    if (path === "/v1/afrippa/admin/two-step-methods") return ok({ object: "list", data: [{ object: "two_step_policy", market: "WW", methods: ["authenticator", "email", "sms"], updated_at: "2026-10-27T00:00:00.000Z" }] });
    if (path.startsWith("/v1/afrippa/admin/two-step-methods/")) return ok({ object: "two_step_policy", market: "GH", methods: ["authenticator"], updated_at: "2026-10-28T00:00:00.000Z" });
    if (path === "/v1/afrippa/admin/p2p/refused-words" && input.method === "GET") return ok({ object: "list", data: [{ object: "refused_word", id: "w1", phrase: "pay outside", market: null }] });
    if (path === "/v1/afrippa/admin/p2p/refused-words") return ok({ object: "refused_word", id: "w2", ...(body as object) });
    if (path === "/v1/afrippa/admin/books")
      return ok({
        object: "afrippa_books",
        mode: "live",
        from: "2026-09-28T00:00:00.000Z",
        to: "2026-10-29T00:00:00.000Z",
        coins: [{ kind: "crypto_custody", currency: "USDT", accounts: 1, balance: "1500.000000", debits: "2000.000000", credits: "500.000000" }],
        money: [],
        trial_balance: [{ currency: "USDT", holds: "1500.000000", owes: "1500.000000", balanced: true }],
      });
    if (path === "/v1/afrippa/admin/books/check") return ok({ object: "ledger_check", platform: "afrippa", ok: true, accounts_checked: 12, account_mismatches: [], unbalanced_entries: [] });
    if (path === `/v1/afrippa/admin/traders/${traderId}/standing`) return ok(standing);
    if (path === `/v1/afrippa/admin/traders/${traderId}/standing/clear`) return ok({ ...standing, strikes: 0, restriction: null, cleared_at: "2026-10-28T00:00:00.000Z" });
    if (path === `/v1/afrippa/admin/traders/${traderId}/two-step/reset`) return ok({ object: "trader_two_step_reset" });
    if (path === "/v1/afrippa/admin/support/tickets")
      return ok({ object: "list", data: [{ object: "support_ticket", id: "k1", reference: "T-000003", subject: "Where are my coins?", category: "payment", priority: "normal", status: "open", last_message_at: "2026-10-28T00:00:00.000Z" }] });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const slow = { timeout: 5000 };
const page = (element: React.ReactNode) =>
  render(
    <AdminProviders>
      <AdminGate>{element}</AdminGate>
    </AdminProviders>,
  );
const neverBitoCard = () => expect(sent.some(call => call.path.startsWith("/v1/admin/")), "never BitoCard's admin routes").toBe(false);

describe("admin.afrippa.com settings", () => {
  test("fee rates: lists every-market rates and sets one market's, in basis points", async () => {
    page(<FeeRatesPage />);
    expect((await screen.findAllByText("Every market", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Below the buyer's").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "New rate" }));
    await screen.findByRole("option", { name: "BTC" }, slow);
    fireEvent.change(screen.getByLabelText("Coin"), { target: { value: "BTC" } });
    fireEvent.change(screen.getByLabelText("Market"), { target: { value: "ng" } });
    fireEvent.change(screen.getByLabelText("Buyer's fee (%)"), { target: { value: "0.25" } });
    fireEvent.change(screen.getByLabelText("Seller's fee (%)"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent.find(call => call.method === "PUT")?.body).toEqual({ asset: "BTC", market: "NG", buyer_bps: 25, seller_bps: 50 }), slow);
    neverBitoCard();
  });

  test("market limits: per mode, amounts typed in units and sent in minor units, empty for no limit", async () => {
    page(<MarketLimitsPage />);
    expect((await screen.findAllByText("NG · NGN", {}, slow)).length).toBeGreaterThan(0);
    expect(sent.find(call => call.path.startsWith("/v1/afrippa/admin/crypto/market-limits"))?.path).toBe("/v1/afrippa/admin/crypto/market-limits?mode=live");
    fireEvent.click(screen.getAllByRole("button", { name: "Change" })[0]);
    expect((screen.getByLabelText("Per order") as HTMLInputElement).value).toBe("500000.00");
    fireEvent.change(screen.getByLabelText("Per 24 hours"), { target: { value: "2000000" } });
    fireEvent.change(screen.getByLabelText("Per 24 hours, new traders"), { target: { value: "0" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled, "zero is refused").toBe(true);
    fireEvent.change(screen.getByLabelText("Per 24 hours, new traders"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(
      () =>
        expect(sent.find(call => call.method === "PUT")?.body).toEqual({
          mode: "live",
          market: "NG",
          currency: "NGN",
          per_trade: 50000000,
          per_day: 200000000,
          cross_border_per_trade: null,
          cross_border_per_day: null,
          new_trader_per_trade: 10000000,
          new_trader_per_day: null,
        }),
      slow,
    );
  });

  test("two-step methods: one market's methods, at least one kept", async () => {
    page(<TwoStepMethodsPage />);
    expect((await screen.findAllByText("All of Afrippa", {}, slow)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Set a market" }));
    fireEvent.change(screen.getByLabelText("Market"), { target: { value: "gh" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Authenticator app/ }));
    expect(screen.getByText("Allow at least one method.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Emailed code/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent.find(call => call.method === "PUT")).toEqual({ method: "PUT", path: "/v1/afrippa/admin/two-step-methods/GH", body: { methods: ["email"] } }), slow);
  });

  test("refused words: adds a phrase for every market", async () => {
    page(<RefusedWordsPage />);
    expect((await screen.findAllByText("pay outside", {}, slow)).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Phrase"), { target: { value: "whatsapp me" } });
    fireEvent.click(screen.getByRole("button", { name: "Refuse it" }));
    await waitFor(() => expect(sent.find(call => call.method === "POST")?.body).toEqual({ phrase: "whatsapp me", market: null }), slow);
  });
});

describe("admin.afrippa.com books, standing and help", () => {
  test("books: Afrippa's trial balance and accounts, and finance's integrity check", async () => {
    page(<BooksPage />);
    expect((await screen.findAllByText("Balanced", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("1500.000000 USDT").length).toBeGreaterThan(0);
    expect(sent.find(call => call.path.startsWith("/v1/afrippa/admin/books?"))?.path).toMatch(/^\/v1\/afrippa\/admin\/books\?mode=live&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    fireEvent.click(screen.getByRole("button", { name: "Check the books" }));
    expect(await screen.findByText(/All 12 accounts match their postings/, {}, slow)).toBeTruthy();
    neverBitoCard();
  });

  test("a trader's standing: paused at the limit, strikes cleared and two-step reset with reasons", async () => {
    page(<TraderStanding id={traderId} mode="live" />);
    expect(await screen.findByText("Trading paused", {}, slow)).toBeTruthy();
    expect(screen.getByText("ORD-000009")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear strikes" }));
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "Appeals reviewed again." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Clear strikes" }).at(-1)!);
    await waitFor(() => expect(sent.find(call => call.path.endsWith("/standing/clear"))?.body).toEqual({ mode: "live", reason: "Appeals reviewed again." }), slow);
    fireEvent.click(screen.getByRole("button", { name: "Reset two-step" }));
    fireEvent.change(screen.getAllByRole("textbox", { name: /reason/i }).at(-1)!, { target: { value: "Proved who they are on a call." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reset two-step" }).at(-1)!);
    await waitFor(() => expect(sent.find(call => call.path.endsWith("/two-step/reset"))?.body).toEqual({ reason: "Proved who they are on a call." }), slow);
  });

  test("help: traders' tickets from Afrippa's own queue", async () => {
    page(<TicketsPage />);
    expect((await screen.findAllByText("T-000003", {}, slow)).length).toBeGreaterThan(0);
    expect(sent.find(call => call.path.startsWith("/v1/afrippa/admin/support/tickets"))?.path).toBe("/v1/afrippa/admin/support/tickets?limit=100&status=open");
    neverBitoCard();
  });
});
