import QRCode from "qrcode";
import { colors } from "@bitocard/ui/tokens";

/**
 * How much of the QR code's width the Afrippa mark in its middle may cover (its white pad included). The code is made
 * at error correction level H, which rebuilds up to 30% of it; a fifth of the width is about 4% of its area (5% of the
 * data area, inside the quiet zone), so the address always scans exactly as written.
 */
export const qrLogoShare = 0.2;

/** The quiet zone around the code, in modules (the white card around it adds more). */
export const qrMargin = 2;

/** A deposit address as a QR code (SVG, navy on white, level H so the centre mark never hides data), or null. */
export async function addressQr(address: string): Promise<string | null> {
  if (!address) return null;
  try {
    return await QRCode.toString(address, { type: "svg", margin: qrMargin, errorCorrectionLevel: "H", color: { dark: colors.navy900, light: "#ffffff" } });
  } catch {
    return null;
  }
}
