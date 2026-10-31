import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";
import type { AssistantContext } from "@bitocard/admin-ui/support";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/support/assistants" }));

await import("@/app/api-product");
const { ShopAssistantForm } = await import("@/components/shop-assistants/form");

const context = {
  base: "/v1/admin/support",
  admin: true,
  stores: [],
  ai: { premium: true, bitocard: { anthropic: ["claude-haiku-5-5"], openai: ["gpt-5-mini"], deepseek: ["deepseek-chat"] }, own: {} },
  realm: "admin",
  avatarPurpose: "shop_bot_avatar",
} as unknown as AssistantContext;

afterEach(cleanup);

// Udozo's assistants run on Claude, OpenAI or DeepSeek; DeepSeek reads text only, so it never helps sellers from photos.
describe("the shop assistant form", () => {
  test("offers Claude, OpenAI and DeepSeek, and sends the one chosen", () => {
    const onSubmit = vi.fn();
    render(
      <AdminProviders>
        <ShopAssistantForm context={context} submitLabel="Create assistant" onSubmit={onSubmit} />
      </AdminProviders>,
    );
    const provider = screen.getByLabelText("Provider") as HTMLSelectElement;
    expect([...provider.options].map(option => option.textContent)).toEqual(["Anthropic (Claude)", "OpenAI", "DeepSeek"]);
    fireEvent.change(provider, { target: { value: "deepseek" } });
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("deepseek-chat");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Deji" } });
    fireEvent.click(screen.getByRole("button", { name: "Create assistant" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ provider: "deepseek", model: "deepseek-chat", roles: ["browse", "help"] }));
  });

  test("DeepSeek with Sellers says why and cannot be saved", () => {
    const onSubmit = vi.fn();
    render(
      <AdminProviders>
        <ShopAssistantForm context={context} submitLabel="Create assistant" onSubmit={onSubmit} />
      </AdminProviders>,
    );
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "deepseek" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Deji" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Sellers/ }));
    expect(screen.getByText(/DeepSeek reads text only: choose Claude or OpenAI/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create assistant" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "openai" } });
    fireEvent.click(screen.getByRole("button", { name: "Create assistant" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ provider: "openai", roles: ["browse", "help", "sell"] }));
  });
});
