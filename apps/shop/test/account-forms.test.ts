import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignInForm } from "@/components/account-forms";

describe("signing in", () => {
  it("hides the password, with a button to show it", () => {
    const html = renderToStaticMarkup(createElement(SignInForm, { next: "/ng" }));
    expect(html).toMatch(/<input type="password" autoComplete="current-password"[^>]*name="password"/);
    expect(html).toMatch(/<button type="button" aria-label="Show password" aria-pressed="false"/);
  });
});
