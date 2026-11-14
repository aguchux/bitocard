import { describe, expect, it } from "vitest";
import { categoryTheme, themeOf } from "../components/store/theme";

describe("themeOf", () => {
  it("gives each known category its own theme", () => {
    expect(themeOf("vpn")).toBe(categoryTheme.vpn);
  });

  it("falls back for a category the store no longer knows, instead of crashing the page", () => {
    // The API may still send categories the store has dropped (eSIMs and virtual numbers, until it is redeployed).
    expect(themeOf("esim")).toBe(categoryTheme.gift_cards);
    expect(themeOf("virtual_numbers").icon).toBeDefined();
  });
});
