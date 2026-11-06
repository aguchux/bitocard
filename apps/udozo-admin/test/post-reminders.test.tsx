// Marketplace > Limits and words: each market's hours for the reminders to finish and post an ad (the
// `classifieds_post_reminders` switch): the one for an unfinished ad and the three for one ready to post, saved like
// every limit, only what changed.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/classifieds/rules" }));

await import("@/app/api-product");
const { default: RulesPage } = await import("@/app/(console)/classifieds/rules/page");

let sent: Array<{ method: string; path: string; body: unknown }>;
const settings = { object: "classified_market_settings", country: "NG", listing_days: 30, monthly_listing_limit: 10, first_listings_reviewed: 3, min_photos: 4, max_photos: 12, username_min_listings: 5, buy_request_hours: 48, buy_meet_days: 7, buy_open_per_buyer: 10, buy_requests_per_day: 20, reviews_neutral: false, review_window_days: 30, review_min_shown: 3, unfinished_reminder_hours: 24, ready_reminder_1_hours: 24, ready_reminder_2_hours: 72, ready_reminder_3_hours: 168 };

beforeEach(() => {
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, body });
    const ok = (value: unknown) => Response.json(value);
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles: ["operations"] }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/countries") return ok({ object: "list", data: [{ code: "NG", name: "Nigeria" }] });
    if (url.pathname === "/v1/admin/classifieds/prohibited-words") return ok({ object: "list", data: [] });
    if (url.pathname === "/v1/admin/classifieds/market-settings/NG") return ok(input.method === "GET" ? settings : { ...settings, ...(body as object) });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const slow = { timeout: 15000 };

describe("reminder hours", () => {
  test("the four hours show as saved; changing two sends only those", slow, async () => {
    render(
      <AdminProviders>
        <AdminGate>
          <RulesPage />
        </AdminGate>
      </AdminProviders>,
    );
    const unfinished = (await screen.findByLabelText("Hours before reminding an unfinished ad", {}, slow)) as HTMLInputElement;
    expect(unfinished.value).toBe("24");
    expect((screen.getByLabelText("Hours before the first reminder to post") as HTMLInputElement).value).toBe("24");
    expect((screen.getByLabelText("Hours from the first to the second") as HTMLInputElement).value).toBe("72");
    const last = screen.getByLabelText("Hours from the second to the last") as HTMLInputElement;
    expect(last.value).toBe("168");
    fireEvent.change(last, { target: { value: "800" } });
    expect(await screen.findByText("Hours from the second to the last: a whole number from 1 to 720.")).toBeTruthy();
    fireEvent.change(last, { target: { value: "96" } });
    fireEvent.change(unfinished, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    await waitFor(() => expect(sent.some(item => item.method !== "GET" && item.path === "/v1/admin/classifieds/market-settings/NG")).toBe(true), slow);
    const saved = sent.find(item => item.method !== "GET" && item.path === "/v1/admin/classifieds/market-settings/NG")!;
    expect(saved.body).toEqual({ unfinished_reminder_hours: 12, ready_reminder_3_hours: 96 });
  });
});
