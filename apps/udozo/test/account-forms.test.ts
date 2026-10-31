import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignInForm, SignUpForm } from "@/components/account/sign-in-up";

const markets = [
  { code: "NG", name: "Nigeria", currency: "NGN" },
  { code: "GH", name: "Ghana", currency: "GHS" },
];

describe("signing in", () => {
  it("starts with the email alone; the password comes once an account is found", () => {
    const html = renderToStaticMarkup(createElement(SignInForm, { next: "/ng", email: "ada@example.com" }));
    expect(html).toMatch(/<input[^>]*type="email"[^>]*value="ada@example.com"/);
    expect(html).not.toContain('type="password"');
    expect(html).toContain("Continue");
  });
});

describe("signing up", () => {
  it("starts with the email alone, step 1 of 4, and never offers another site's sign-up", () => {
    const html = renderToStaticMarkup(createElement(SignUpForm, { next: "/ng", markets }));
    expect(html).toContain("Step 1 of 4");
    expect(html).toMatch(/<input[^>]*type="email"/);
    expect(html).toContain("We email you a 6-digit code to confirm it.");
    expect(html).not.toContain('name="country"');
    expect(html).not.toContain('name="phone"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toMatch(/bitocard/i);
  });

  it("an email from sign-in's “Create an account with it” is filled in", () => {
    const html = renderToStaticMarkup(createElement(SignUpForm, { next: "/gh", markets, market: "GH", email: "new@example.com" }));
    expect(html).toMatch(/<input[^>]*type="email"[^>]*value="new@example.com"/);
  });
});
