// Settings > Markets > WhatsApp group: the market's reseller group link, checked before it is saved, and removable.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/settings/markets" }));

const { WhatsappGroup } = await import("@/app/(console)/settings/markets/whatsapp-group");

let patches: Array<Record<string, unknown>>;

beforeEach(() => {
  patches = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    if (url.pathname === "/v1/admin/countries/KE" && input.method === "PATCH") {
      const body = await input.json();
      patches.push(body);
      return Response.json({ object: "country", code: "KE", whatsapp_group_url: body.whatsapp_group_url, categories: [] });
    }
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Market WhatsApp group", () => {
  test("only a WhatsApp group invite link can be saved", async () => {
    render(
      <AdminProviders>
        <WhatsappGroup code="KE" country="Kenya" url={null} editable />
      </AdminProviders>,
    );
    const field = screen.getByLabelText("Group invite link");
    const save = screen.getByRole("button", { name: "Save link" }) as HTMLButtonElement;
    fireEvent.change(field, { target: { value: "https://example.com/group" } });
    expect(screen.getByText("That is not a WhatsApp group invite link.")).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.change(field, { target: { value: " https://chat.whatsapp.com/AbCdEf1234567890 " } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(patches).toEqual([{ whatsapp_group_url: "https://chat.whatsapp.com/AbCdEf1234567890" }]));
  });

  test("a saved link can be removed, and viewers cannot change it", async () => {
    const { unmount } = render(
      <AdminProviders>
        <WhatsappGroup code="KE" country="Kenya" url="https://chat.whatsapp.com/AbCdEf1234567890" editable />
      </AdminProviders>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    await waitFor(() => expect(patches).toEqual([{ whatsapp_group_url: null }]));
    unmount();
    render(
      <AdminProviders>
        <WhatsappGroup code="KE" country="Kenya" url={null} editable={false} />
      </AdminProviders>,
    );
    expect(screen.queryByRole("button", { name: "Save link" })).toBeNull();
    expect((screen.getByLabelText("Group invite link") as HTMLInputElement).disabled).toBe(true);
  });
});
