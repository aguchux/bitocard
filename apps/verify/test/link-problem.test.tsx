// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LinkProblem } from "@/components/link-problem";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the expired link page", () => {
  // Arriving from SHQ with a spent link used to loop forever (React #185): the referrer's hint was a new object each read.
  test("names and links the BitoCard site the applicant came from, and renders once settled", () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://shq.bitocard.com/settings/verification");
    render(<LinkProblem />);
    expect(screen.getByRole("heading", { name: "This link has expired" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to BitoCard SHQ" }).getAttribute("href")).toBe("https://shq.bitocard.com/");
  });

  test("offers no link back to a site that is not BitoCard's", () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://example.com/");
    render(<LinkProblem />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
