// Settings > Markets > Phone verification: a market's first SMS provider (Africa's Talking listed first) and its
// optional second, which takes a code the first could not send and sends resends. The second never offers the first.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/settings/markets" }));

await import("@/app/api-product");
const { SmsProvider } = await import("@/app/(console)/settings/markets/sms-provider");

let sent: Array<{ method: string; path: string; body: unknown }>;

beforeEach(() => {
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, body });
    return Response.json({ object: "country", code: "NG", name: "Nigeria" });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (provider: "termii" | "africas_talking" | null, fallback: "termii" | "africas_talking" | null, editable = true) =>
  render(
    <AdminProviders>
      <SmsProvider code="NG" provider={provider} fallback={fallback} editable={editable} />
    </AdminProviders>,
  );

const options = (label: string) => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map(option => option.textContent);

describe("a market's SMS providers", () => {
  test("Africa's Talking is listed first; the second offers only the other provider and says what it does", () => {
    show("africas_talking", "termii");
    expect(options("First provider")).toEqual(["Disabled", "Africa’s Talking", "Termii"]);
    expect(options("Second provider")).toEqual(["None", "Termii"]);
    expect((screen.getByLabelText("Second provider") as HTMLSelectElement).value).toBe("termii");
    expect(screen.getByText(/If it cannot send one, Termii sends it, and a resend goes through Termii first/)).toBeTruthy();
  });

  test("choosing the second provider saves it for the market", async () => {
    show("africas_talking", null);
    expect(screen.getByText(/Codes go through Africa’s Talking only/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Second provider"), { target: { value: "termii" } });
    await waitFor(() => expect(sent.find(item => item.method === "PATCH")).toEqual({ method: "PATCH", path: "/v1/admin/countries/NG", body: { sms_fallback_provider: "termii" } }));
  });

  test("with no first provider the second cannot be chosen; support only sees them", () => {
    show(null, null);
    expect((screen.getByLabelText("Second provider") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(/Phone verification is off in this market/)).toBeTruthy();
    cleanup();
    show("africas_talking", "termii", false);
    expect((screen.getByLabelText("First provider") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Second provider") as HTMLSelectElement).disabled).toBe(true);
  });
});
