// Africa's Talking's data plans as rows: read from the setting's text, edited row by row, and written back one plan a
// line in the format the API reads.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { formatPlans, parsePlans, rowsProblem } = await import("@/components/data-plans");
const { DataPlansField } = await import("@/components/data-plans-field");

afterEach(cleanup);

describe("data plan rows", () => {
  test("the setting's lines become rows and back, with lines not understood kept apart", () => {
    const { rows, unreadable } = parsePlans("KE safaricom 1GB Month 299 250; ng MTN 500mb week 350 320\nKE nonsense");
    expect(rows.map(row => [row.country, row.network, row.size, row.unit, row.validity, row.price, row.cost])).toEqual([
      ["KE", "safaricom", "1", "GB", "Month", "299", "250"],
      ["NG", "mtn", "500", "MB", "Week", "350", "320"],
    ]);
    expect(unreadable).toEqual(["KE nonsense"]);
    expect(formatPlans(rows)).toBe("KE safaricom 1GB Month 299 250\nNG mtn 500MB Week 350 320");
    expect(rowsProblem(rows, unreadable)).toMatch(/not understood: KE nonsense/);
    expect(rowsProblem(rows)).toBeNull();
  });

  test("a row says what it still needs, a dearer cost and repeats are refused", () => {
    const [row] = parsePlans("NG mtn 1GB Month 1000 900").rows;
    expect(rowsProblem([{ ...row, price: "" }])).toMatch(/Data plan 1: Enter the price/);
    expect(rowsProblem([{ ...row, cost: "1200" }])).toMatch(/costs more than its price/);
    expect(rowsProblem([row, { ...row, id: "other", size: "1.0" }])).toMatch(/same country, network, size and validity/);
  });
});

describe("the data plans editor", () => {
  test("adds a plan with the guided fields, writes the line, and removes it again", () => {
    const onChange = vi.fn();
    render(<DataPlansField value="KE safaricom 1GB Month 299 250" onChange={onChange} />);
    expect(screen.getAllByRole("listitem", { name: /Data plan/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Add data plan" }));
    const plan = screen.getByRole("listitem", { name: "Data plan 2" });
    // A new plan starts on the last one's country: an incomplete row cannot be saved.
    expect(onChange.mock.lastCall?.[1]).toMatch(/Data plan 2: Enter the bundle size/);
    fireEvent.change(within(plan).getByLabelText("Country"), { target: { value: "NG" } });
    expect((within(plan).getByLabelText("Network") as HTMLSelectElement).value).toBe("mtn");
    fireEvent.change(within(plan).getByLabelText("Network"), { target: { value: "glo" } });
    fireEvent.change(within(plan).getByLabelText("Size"), { target: { value: "500" } });
    fireEvent.change(within(plan).getByLabelText("Unit"), { target: { value: "MB" } });
    fireEvent.change(within(plan).getByLabelText("Lasts"), { target: { value: "Week" } });
    fireEvent.change(within(plan).getByLabelText("Price (NGN)"), { target: { value: "350" } });
    fireEvent.change(within(plan).getByLabelText("Our cost (NGN)"), { target: { value: "320" } });
    expect(onChange.mock.lastCall).toEqual(["KE safaricom 1GB Month 299 250\nNG glo 500MB Week 350 320", null]);

    fireEvent.click(within(screen.getByRole("listitem", { name: "Data plan 1" })).getByRole("button", { name: "Remove" }));
    expect(onChange.mock.lastCall).toEqual(["NG glo 500MB Week 350 320", null]);
  });

  test("lines not understood are shown to remove, and block saving until removed", () => {
    const onChange = vi.fn();
    render(<DataPlansField value="KE nonsense" onChange={onChange} />);
    expect(screen.getByText("KE nonsense")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onChange.mock.lastCall).toEqual(["", null]);
    expect(screen.getByText(/No plans: Africa’s Talking’s published Kenya, Nigeria and Uganda packages/)).toBeTruthy();
  });
});
