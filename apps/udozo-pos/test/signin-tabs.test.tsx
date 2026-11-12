// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/staff-actions", () => ({ staffSignIn: vi.fn() }));
vi.mock("@/lib/offline-store", () => ({ rememberPin: vi.fn() }));

const { SignInTabs } = await import("@/components/signin-tabs");
const { StaffSignInForm } = await import("@/components/staff-auth");

describe("sign-in tabs", () => {
  it("shows one door at a time and moves with the arrow keys", () => {
    render(<SignInTabs owner={<p>Owner door</p>} staff={<p>Staff door</p>} />);
    expect(screen.getByRole("tab", { name: "Shop owner" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Owner door")).toBeTruthy();
    expect(screen.getByText("Staff door").closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(true);
    act(() => fireEvent.keyDown(screen.getByRole("tab", { name: "Shop owner" }), { key: "ArrowRight" }));
    expect(screen.getByRole("tab", { name: "Staff" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Owner door").closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(true);
  });

  it("opens on Staff when asked", () => {
    render(<SignInTabs initial="staff" owner={<p>Owner door</p>} staff={<p>Staff door</p>} />);
    expect(screen.getByRole("tab", { name: "Staff" }).getAttribute("aria-selected")).toBe("true");
  });

  it("asks staff for their PIN in six boxes, with no keypad", () => {
    render(<StaffSignInForm />);
    expect(screen.getAllByLabelText(/Your PIN, digit/)).toHaveLength(6);
    expect(screen.queryByRole("button", { name: "5" })).toBeNull();
  });
});
