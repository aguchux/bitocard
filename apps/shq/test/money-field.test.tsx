import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";
import { MoneyField } from "@/components/money-field";
import { ConvertDialog } from "@/components/wallets";

type Sent = { method: string; path: string; body: unknown };

/** Replaces `fetch` with the API: every request recorded, conversions answered. */
function fakeApi() {
  const sent: Sent[] = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  globalThis.fetch = (async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, body });
    if (url.pathname === "/v1/wallet/conversions") {
      const amount = (body as { amount: number }).amount;
      return Response.json({ object: "wallet_conversion", id: null, mode: "live", from: { amount, currency: "NGN" }, to: { amount: Math.floor(amount / 1500), currency: "USD" }, rate: "1500", created_at: null });
    }
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found.", request_id: "req_1" } }, { status: 404 });
  }) as typeof fetch;
  return sent;
}

afterEach(cleanup);

describe("money fields", () => {
  it("shows the currency's sign and takes only an amount, with commas", () => {
    render(<MoneyField aria-label="Amount" currency="NGN" defaultValue="" />);
    const field = screen.getByLabelText("Amount") as HTMLInputElement;
    expect(screen.getByText("₦")).toBeTruthy();
    fireEvent.change(field, { target: { value: "abc1234567.899" } });
    expect(field.value).toBe("1,234,567.89");
    fireEvent.change(field, { target: { value: "letters" } });
    expect(field.value).toBe("");
  });

  it("uses each market's sign", () => {
    render(
      <>
        <MoneyField aria-label="Cedis" currency="GHS" />
        <MoneyField aria-label="Shillings" currency="KES" />
        <MoneyField aria-label="Dollars" currency="USD" />
      </>,
    );
    expect(screen.getByText("GH₵")).toBeTruthy();
    expect(screen.getByText("KSh")).toBeTruthy();
    expect(screen.getByText("$")).toBeTruthy();
  });

  it("converting between wallets sends what was typed in minor units and shows amounts with signs", async () => {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
    const sent = fakeApi();
    render(
      <AdminProviders>
        <ConvertDialog open onClose={() => undefined} from="NGN" to="USD" available={1_000_000_00} />
      </AdminProviders>,
    );
    expect(screen.getByText("Your NGN wallet has ₦1,000,000.00.")).toBeTruthy();
    const field = screen.getByLabelText("Amount") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "15x000.5" } });
    expect(field.value).toBe("15,000.5");
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(sent.some(item => item.method === "POST" && (item.body as { preview?: boolean }).preview !== true)).toBe(true));
    const converted = sent.find(item => item.method === "POST" && (item.body as { preview?: boolean }).preview !== true)!;
    expect(converted.body).toMatchObject({ from: "NGN", to: "USD", amount: 1_500_050 });
    expect(await screen.findByText("₦15,000.50 became $10.00.")).toBeTruthy();
  });
});
