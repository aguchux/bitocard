// Every action that changes something people cannot simply take back asks first in Udozo's own dialog, never the
// browser's confirm, prompt or alert: what the dialog says, and a guard over every Udozo app's source.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ConfirmBody, offerQuestion, type ConfirmOptions } from "@/components/confirm-dialog";

const draw = (options: ConfirmOptions) => renderToStaticMarkup(createElement(ConfirmBody, { options, titleId: "t", onConfirm: () => undefined, onDismiss: () => undefined }));

describe("the confirmation dialog", () => {
  test("names what happens on its button, offers a way out first, and colours danger and money", () => {
    const html = draw({ title: "Delete this listing for good?", body: "Its photos go too.", action: "Delete listing", dismiss: "Keep it", tone: "danger" });
    expect(html).toContain('id="t"');
    expect(html).toContain("Delete this listing for good?");
    expect(html).toContain("Its photos go too.");
    expect(html.indexOf("Keep it")).toBeLessThan(html.indexOf("Delete listing"));
    expect(html).toContain("bg-red-700");
    expect(html).not.toContain("<form");
    expect(draw({ title: "Pay?", action: "Pay ₦25,100", tone: "money" })).toContain("bg-mint-700");
    expect(draw({ title: "Mark it sold?", action: "Mark sold" })).toContain(">Cancel<");
  });

  test("asks for a reason where one is wanted: optional by default, the button waiting while a required one is empty", () => {
    const optional = draw({ title: "Decline?", action: "Decline", reason: { label: "Tell them why" } });
    expect(optional).toContain("Tell them why");
    expect(optional).toContain("(optional)");
    expect(optional).toContain("<textarea");
    const required = draw({ title: "Refuse this note?", action: "Refuse note", reason: { label: "Why", required: true } });
    expect(required).not.toContain("(optional)");
    expect(required).toMatch(/<button type="button" disabled=""[^>]*>Refuse note<\/button>/);
  });

  test("offers: accepting agrees the price, declining and withdrawing end it", () => {
    expect(offerQuestion("accept", "₦240,000", "Kemi")).toMatchObject({ title: "Accept ₦240,000?", action: "Accept ₦240,000", tone: "money" });
    expect(offerQuestion("decline", "₦240,000", "Kemi").body).toContain("Kemi is told");
    expect(offerQuestion("withdraw", "₦240,000", "Kemi")).toMatchObject({ action: "Withdraw offer", tone: "danger" });
  });
});

describe("no browser dialogs anywhere in Udozo's apps", () => {
  const apps = ["../", "../../udozo-shq/", "../../udozo-admin/"].map(path => fileURLToPath(new URL(path, import.meta.url)));
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap(name => {
      if (["node_modules", ".next", "test", "public"].includes(name)) return [];
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sources(path) : /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
    });

  test("never window.confirm, window.prompt or window.alert", () => {
    const found = apps.flatMap(sources).filter(path => /\bwindow\.(confirm|prompt|alert)\s*\(|(^|[^.\w])(confirm|prompt|alert)\s*\(\s*["'`]/m.test(readFileSync(path, "utf8")));
    expect(found).toEqual([]);
  });
});
