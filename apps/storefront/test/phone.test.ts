import { describe, expect, test } from "vitest";
import { checkPhone, dialCode, flagEmoji, formatNational } from "@bitocard/ui/phone";

describe("account phone numbers (the shared phone input)", () => {
  test("a local or international mobile number of the account's country becomes E.164", () => {
    expect(checkPhone("0803 123 4567", "NG")).toEqual({ ok: true, e164: "+2348031234567" });
    expect(checkPhone("+234 803 123 4567", "NG")).toEqual({ ok: true, e164: "+2348031234567" });
    expect(checkPhone("024 123 4567", "GH")).toEqual({ ok: true, e164: "+233241234567" });
    expect(checkPhone("0711 123456", "KE")).toEqual({ ok: true, e164: "+254711123456" });
  });

  test("a number from another country is refused with the account's dialling code", () => {
    const check = checkPhone("+254711123456", "NG");
    expect(check.ok).toBe(false);
    expect(!check.ok && check.error).toBe("Use a mobile number from your country (+234).");
  });

  test("too short, not a mobile, or empty", () => {
    expect(checkPhone("0803", "NG")).toEqual({ ok: false, error: "Enter a valid mobile number for +234." });
    expect(checkPhone("   ", "NG")).toEqual({ ok: false, error: null });
  });

  test("the locked prefix and as-you-type formatting", () => {
    expect(dialCode("GH")).toBe("+233");
    expect(flagEmoji("ng")).toBe("🇳🇬");
    expect(formatNational("08031234567", "NG")).toBe("0803 123 4567");
  });
});
