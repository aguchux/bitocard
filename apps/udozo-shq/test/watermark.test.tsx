// Store > a store > Photo watermark: the store's own text on its listing photos where Udozo allows it
// (`watermark_allowed`), saved and cleared with the store's PATCH; otherwise Udozo's watermark is used.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeApi, refusal, renderSignedIn, store } from "./helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: () => undefined }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/store",
}));

await import("@/app/api-product");
const { StoreWatermarkCard } = await import("@/components/store-settings");

const slow = { timeout: 5000 };
const path = `/v1/stores/${store.id}`;

afterEach(cleanup);

describe("the store's photo watermark", () => {
  test("not allowed: says Udozo's watermark is used, with no field", async () => {
    fakeApi({});
    renderSignedIn(<StoreWatermarkCard store={{ ...store, watermark_allowed: false, watermark_text: null } as never} canManage />);
    expect(await screen.findByText("Udozo’s watermark is used on your store’s photos.", {}, slow)).toBeTruthy();
    expect(screen.queryByLabelText("Watermark text")).toBeNull();
  });

  test("allowed: checks the text, previews it and saves it with PATCH", async () => {
    const sent = fakeApi({ [`PATCH ${path}`]: (body: unknown) => ({ ...store, watermark_allowed: true, ...(body as object) }) });
    renderSignedIn(<StoreWatermarkCard store={{ ...store, watermark_allowed: true, watermark_text: null } as never} canManage />);
    const field = await screen.findByLabelText("Watermark text", {}, slow);
    const save = screen.getByRole("button", { name: "Save watermark" }) as HTMLButtonElement;
    fireEvent.change(field, { target: { value: "ada<shop>" } });
    expect(screen.getByText("Use only letters, digits, spaces and . - _ @")).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.change(field, { target: { value: " adaresale.com " } });
    expect(screen.getByRole("img", { name: "Preview of a listing photo marked “adaresale.com”" })).toBeTruthy();
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(sent.find(call => call.method === "PATCH")).toEqual({ method: "PATCH", path, body: { watermark_text: "adaresale.com" } }), slow);
    expect(await screen.findByText("Watermark saved.", {}, slow)).toBeTruthy();
  });

  test("clearing sends null, back to Udozo's", async () => {
    const sent = fakeApi({ [`PATCH ${path}`]: (body: unknown) => ({ ...store, watermark_allowed: true, ...(body as object) }) });
    renderSignedIn(<StoreWatermarkCard store={{ ...store, watermark_allowed: true, watermark_text: "adaresale.com" } as never} canManage />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear" }, slow));
    await waitFor(() => expect(sent.find(call => call.method === "PATCH")?.body).toEqual({ watermark_text: null }), slow);
    expect(await screen.findByText("Your store uses Udozo’s watermark again.", {}, slow)).toBeTruthy();
  });

  test("shows the API's refusal in its words", async () => {
    fakeApi({ [`PATCH ${path}`]: refusal(400, "text_refused", "This text cannot be used on photos.", "watermark_text") });
    renderSignedIn(<StoreWatermarkCard store={{ ...store, watermark_allowed: true, watermark_text: null } as never} canManage />);
    fireEvent.change(await screen.findByLabelText("Watermark text", {}, slow), { target: { value: "bad words" } });
    fireEvent.click(screen.getByRole("button", { name: "Save watermark" }));
    expect(await screen.findByText("This text cannot be used on photos.", {}, slow)).toBeTruthy();
  });

  test("team members who cannot manage the store only see it", async () => {
    fakeApi({});
    renderSignedIn(<StoreWatermarkCard store={{ ...store, watermark_allowed: true, watermark_text: "adaresale.com" } as never} canManage={false} />);
    expect(((await screen.findByLabelText("Watermark text", {}, slow)) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save watermark" })).toBeNull();
  });
});
