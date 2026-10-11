import { describe, expect, test } from "vitest";
import { esimInstall } from "@/lib/esim";

describe("eSIM install details", () => {
  test("an LPA string gives the SM-DP+ address, the activation code and Apple's and Google's one-tap links", () => {
    const install = esimInstall("LPA:1$rsp-eu.example.com$43DE23C67EE747BCAD6B63E8B67B261F");
    expect(install).toEqual({
      lpa: "LPA:1$rsp-eu.example.com$43DE23C67EE747BCAD6B63E8B67B261F",
      smdp: "rsp-eu.example.com",
      activationCode: "43DE23C67EE747BCAD6B63E8B67B261F",
      apple: "https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA%3A1%24rsp-eu.example.com%2443DE23C67EE747BCAD6B63E8B67B261F",
      android: "https://esimsetup.android.com/esim_qrcode_provisioning?carddata=LPA%3A1%24rsp-eu.example.com%2443DE23C67EE747BCAD6B63E8B67B261F",
    });
  });

  test("anything else is not an LPA string", () => {
    for (const value of [null, "", "SANDBOX-CODE", "LPA:1$only-address", "LPA:2$a$b", "LPA:1$a$b$c", "LPA:1$a b$c"]) expect(esimInstall(value)).toBeNull();
    expect(esimInstall("  LPA:1$a.example$X1  ")?.smdp).toBe("a.example");
  });
});
