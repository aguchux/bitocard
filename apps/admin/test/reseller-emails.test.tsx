// The reseller page's Emails card: quick emails grouped, the suggested ones marked, each sent after a preview with
// an optional note, and a custom email that needs a subject and a message.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/resellers/r1" }));

const { ResellerEmailsCard } = await import("@/components/reseller-emails");

const slow = { timeout: 10000 };
let posts: Array<Record<string, unknown>>;
let sentRows: unknown[];
const overview = (sent: unknown[] = []) => ({
  object: "reseller_emails",
  to: { name: "Dennis Kipkemboi", email: "dennis@example.com" },
  templates: [
    { key: "start_kyc", kind: "onboarding", label: "Start KYC", description: "Asks the owner to complete the identity check.", subject: "Complete your identity check to go live", suggested: "The identity check is not done.", last_sent_at: null },
    { key: "setup_store", kind: "onboarding", label: "Set up your store", description: "Invites them to create their store.", subject: "Set up your store in a few minutes", suggested: null, last_sent_at: null },
    { key: "upgrade_plan", kind: "growth", label: "Upgrade plan", description: "What a paid plan adds.", subject: "Grow your business with a BitoCard plan", suggested: null, last_sent_at: null },
  ],
  sent,
});

beforeEach(() => {
  // jsdom has no modal dialogs: open them as the browser would.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  posts = [];
  sentRows = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    if (url.pathname === "/v1/admin/resellers/r1/emails" && input.method === "POST") {
      const body = await input.json();
      posts.push(body);
      sentRows.unshift({ object: "reseller_email", template: body.template, subject: body.subject ?? "Complete your identity check to go live", to: "dennis@example.com", sent_by: { name: "Ada" }, sent_at: "2026-11-16T10:00:00Z" });
      return Response.json(overview(sentRows));
    }
    if (url.pathname === "/v1/admin/resellers/r1/emails") return Response.json(overview(sentRows));
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Reseller emails", () => {
  test("a suggested quick email is marked and sent with a personal note", async () => {
    render(
      <AdminProviders>
        <ResellerEmailsCard resellerId="r1" />
      </AdminProviders>,
    );
    const kyc = await screen.findByRole("button", { name: /Start KYC.*suggested/ }, slow);
    expect(screen.getByRole("button", { name: /^Set up your store$/ })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Growing their business" })).toBeTruthy();
    fireEvent.click(kyc);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Complete your identity check to go live")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Personal note (optional)"), { target: { value: "Call us if stuck." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send email" }));
    await waitFor(() => expect(posts).toEqual([{ template: "start_kyc", message: "Call us if stuck." }]));
    expect(await screen.findByText(/Sent “Complete your identity check to go live” to dennis@example.com/)).toBeTruthy();
    expect(await screen.findByText("Sent lately (1)")).toBeTruthy();
  });

  test("a custom email needs a subject and a message", async () => {
    render(
      <AdminProviders>
        <ResellerEmailsCard resellerId="r1" />
      </AdminProviders>,
    );
    await screen.findByRole("button", { name: /Start KYC/ }, slow);
    fireEvent.click(screen.getByRole("button", { name: "Custom email" }));
    const dialog = await screen.findByRole("dialog");
    const sendButton = within(dialog).getByRole("button", { name: "Send email" }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Subject"), { target: { value: "About your store" } });
    fireEvent.change(within(dialog).getByLabelText("Message"), { target: { value: "Hello there." } });
    expect(sendButton.disabled).toBe(false);
    fireEvent.click(sendButton);
    await waitFor(() => expect(posts).toEqual([{ template: "custom", subject: "About your store", message: "Hello there." }]));
  });
});
