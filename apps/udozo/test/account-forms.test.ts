import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignInForm, SignUpForm } from "@/components/account-forms";

const markets = [
  { code: "NG", name: "Nigeria", currency: "NGN" },
  { code: "GH", name: "Ghana", currency: "GHS" },
];

describe("signing in", () => {
  it("hides the password, with a button to show it", () => {
    const html = renderToStaticMarkup(createElement(SignInForm, { next: "/ng" }));
    expect(html).toMatch(/<input[^>]*type="password"[^>]*autoComplete="current-password"[^>]*name="password"/);
    expect(html).toMatch(/<button type="button" aria-label="Show password" aria-pressed="false"/);
  });
});

describe("signing up", () => {
  it("asks for the country from Udozo's markets, fixed for good, and never offers another site's sign-up", () => {
    const html = renderToStaticMarkup(createElement(SignUpForm, { next: "/ng", markets }));
    expect(html).toMatch(/<select[^>]*name="country"[^>]*required/);
    expect(html).toContain('<option value="NG">Nigeria (NGN)</option>');
    expect(html).toContain("It cannot be changed later.");
    expect(html).toMatch(/autoComplete="new-password"/);
    expect(html).not.toMatch(/bitocard/i);
    // No country chosen yet: no phone field (it is locked to the country once one is).
    expect(html).not.toContain('name="phone"');
  });

  it("a country already known (the market it was opened from) shows the phone field locked to it", () => {
    const html = renderToStaticMarkup(createElement(SignUpForm, { next: "/gh", markets, market: "GH" }));
    expect(html).toMatch(/<option value="GH" selected="">Ghana/);
    expect(html).toContain('name="phone"');
    expect(html).toContain("+233");
  });
});
