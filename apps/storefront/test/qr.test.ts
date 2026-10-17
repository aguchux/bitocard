// Deposit address QR codes carry the BitoCard mark in their middle: they must be made at level H, and the mark must
// stay well inside what level H rebuilds, so the address scans exactly as written.
import QRCode from "qrcode";
import { describe, expect, test } from "vitest";
import { colors } from "@bitocard/ui/tokens";
import { addressQr, qrLogoShare, qrMargin } from "@/lib/qr";

const addresses = [
  "ltc1qg82r7m4wvj4e0y0r0tq6ut8yd0g6fa3e6ztn9h", // Litecoin
  "0x52908400098527886E0F7030069857D2E4169EE7", // EVM
  "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8", // TRON
  "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297", // Bitcoin Taproot, the longest
];

describe("addressQr", () => {
  test("draws the address navy on white", async () => {
    const svg = await addressQr(addresses[0]);
    expect(svg).toContain("<svg");
    expect(svg?.toLowerCase()).toContain(colors.navy900);
  });

  test("no address, no code", async () => {
    expect(await addressQr("")).toBeNull();
  });

  test.each(addresses)("%s is level H and the mark covers far less than it rebuilds", address => {
    const code = QRCode.create(address, { errorCorrectionLevel: "H" });
    expect(code.errorCorrectionLevel.bit).toBe(QRCode.create("x", { errorCorrectionLevel: "H" }).errorCorrectionLevel.bit);
    const size = code.modules.size;
    // The mark is a share of the whole image, quiet zone included: in modules of the code itself, a square this wide.
    const markModules = Math.ceil(qrLogoShare * (size + 2 * qrMargin));
    const covered = (markModules * markModules) / (size * size);
    expect(covered).toBeLessThan(0.1);
  });
});
