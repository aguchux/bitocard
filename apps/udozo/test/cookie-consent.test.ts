// Cookie consent: the choice remembered in udz_cookie_consent, the banner's two equal choices, and that every page and
// footer offers it.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { consentCookie, consentCookieValue, consentMaxAgeSeconds, optionalAllowed, readConsent } from "@/lib/cookie-consent";

const { CookieConsent, CookieConsentBody, CookieSettingsButton } = await import("@/components/cookie-consent");
const { legalDocument } = await import("@/lib/legal");
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the remembered choice", () => {
  test("is written host-only for 12 months, Secure on https, and read back", () => {
    const value = consentCookieValue("necessary", new Date("2026-11-01T09:00:00Z"), true);
    expect(value).toBe(`udz_cookie_consent=v3.necessary.2026-11-01; Max-Age=${consentMaxAgeSeconds}; Path=/; SameSite=Lax; Secure`);
    expect(value).not.toContain("Domain=");
    expect(consentCookieValue("all", new Date("2026-11-01T09:00:00Z"), false)).not.toContain("Secure");
    expect(readConsent(`udz_customer=abc; ${consentCookie}=v3.all.2026-11-01`)).toEqual({ choice: "all", at: "2026-11-01" });
  });

  test("anything else, an older version (v1, before udz_vid) or no cookie asks again; optional cookies only after Accept all", () => {
    for (const raw of [null, "", "other=1", `${consentCookie}=yes`, `${consentCookie}=v0.all.2026-11-01`, `${consentCookie}=v2.maybe.2026-11-01`, `${consentCookie}=v1.all.2026-11-01`]) expect(readConsent(raw)).toBeNull();
    expect(optionalAllowed(readConsent(`${consentCookie}=v3.all.2026-11-01`))).toBe(true);
    expect(optionalAllowed(readConsent(`${consentCookie}=v3.necessary.2026-11-01`))).toBe(false);
    expect(optionalAllowed(null)).toBe(false);
  });
});

describe("the banner", () => {
  const draw = (current: "necessary" | "all" | null) => renderToStaticMarkup(createElement(CookieConsentBody, { noticeHref: "/legal/cookies", current, onChoose: () => undefined }));

  test("offers Necessary only and Accept all as equals, says what the two optional cookies are for, and links the notice", () => {
    const html = draw(null);
    expect(html).toContain("Cookies on Udozo");
    expect(html).toContain("two optional cookies on udozo.com: one remembers what you look at");
    expect(html).toContain("one notes which link or ad brought you");
    expect(html).toContain("Never shared with advertisers.");
    expect(html).toContain('href="/legal/cookies"');
    const buttons = [...html.matchAll(/<button type="button" class="([^"]+)">([^<]+)<\/button>/g)];
    expect(buttons.map(match => match[2])).toEqual(["Necessary only", "Accept all"]);
    expect(buttons[0]![1]).toBe(buttons[1]![1]);
    expect(html).not.toContain("You chose");
  });

  test("reopened from Cookie settings, it says what was chosen", () => {
    expect(draw("necessary")).toContain("You chose Necessary only.");
    expect(draw("all")).toContain("You chose Accept all.");
  });

  test("is drawn only in the browser, so cached pages never carry it", () => {
    expect(renderToStaticMarkup(createElement(CookieConsent, { noticeHref: "/legal/cookies" }))).toBe("");
    expect(renderToStaticMarkup(createElement(CookieSettingsButton))).toContain("Cookie settings");
  });

  test("every page has it, every footer has Cookie settings, and the cookie notice describes it", () => {
    expect(read("../app/layout.tsx")).toContain("<CookieConsent noticeHref=");
    for (const footer of ["../components/footer.tsx", "../app/store/[store]/layout.tsx", "../app/start-here/page.tsx"]) expect(read(footer), footer).toContain("<CookieSettingsButton />");
    const notice = JSON.stringify(legalDocument("cookies"));
    expect(notice).toContain("udz_cookie_consent");
    expect(notice).toContain("Your cookie choices");
    expect(notice).not.toContain("asks for no consent");
  });
});
