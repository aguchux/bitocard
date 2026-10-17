import { describe, expect, test } from "vitest";
import { accountSections, activeAccountSection } from "@/components/app/account-sections";
import { initials } from "@/components/app/profile-card";
import { activeTab } from "@/components/app/tabs";

describe("account screens", () => {
  test("every screen has its own address, in menu order, with the identity check at its old one", () => {
    expect(accountSections.map(section => section.key)).toEqual(["profile", "security", "identity", "referrals", "notifications"]);
    expect(new Set(accountSections.map(section => section.href)).size).toBe(accountSections.length);
    expect(accountSections.find(section => section.key === "identity")?.href).toBe("/account/verification");
  });

  test("only what is not built yet is marked Soon", () => {
    expect(accountSections.filter(section => section.soon).map(section => section.key)).toEqual(["referrals", "notifications"]);
  });

  test("the current pill follows the path, ignoring queries, fragments and a trailing slash", () => {
    expect(activeAccountSection("/account/profile/details")).toBe("profile");
    expect(activeAccountSection("/account/profile/details#country")).toBe("profile");
    expect(activeAccountSection("/account/profile/security/")).toBe("security");
    expect(activeAccountSection("/account/verification?country=NG")).toBe("identity");
    expect(activeAccountSection("/account/profile/notifications")).toBe("notifications");
    expect(activeAccountSection("/account/profile")).toBeNull();
    expect(activeAccountSection("/account/profile/detailsx")).toBeNull();
    expect(activeAccountSection("/account/wallet")).toBeNull();
  });

  test("every account screen sits under the Account tab", () => {
    for (const section of accountSections) expect(activeTab(section.href)).toBe("/account/profile");
    expect(activeTab("/account/profile")).toBe("/account/profile");
  });

  test("initials take the first letters of up to two names", () => {
    expect(initials("Obiageli Agu")).toBe("OA");
    expect(initials("  ada  lovelace byron ")).toBe("AL");
    expect(initials("")).toBe("");
  });
});
