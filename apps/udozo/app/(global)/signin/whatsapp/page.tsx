import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { WhatsappWaiting } from "@/components/account/whatsapp-waiting";
import { currentCustomer, safeNext } from "@/lib/customer";
import { readWhatsappFlow } from "@/lib/whatsapp-sign-in";

export const metadata: Metadata = { title: "Continue with WhatsApp", robots: { index: false, follow: false } };

/**
 * Signing up or in with WhatsApp, once started (`continueWithWhatsapp`): the message to send Udozo's number (Open
 * WhatsApp fills it in; on a computer, the QR code opens it on the phone), what happens there, and this page waits for
 * WhatsApp's answer, then carries on signed in. Nothing to wait for: back to sign-in.
 */
export default async function WhatsappSignInPage() {
  const flow = await readWhatsappFlow();
  if (!flow) redirect("/signin");
  if (await currentCustomer()) redirect(safeNext(flow.next));
  // The link alone, drawn on the server at error correction level M: a phone camera opens it in WhatsApp.
  const svg = await QRCode.toString(flow.link, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).catch(() => null);
  const qr = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
  return (
    <div className="mx-auto grid max-w-lg gap-4 px-4 py-8">
      <WhatsappWaiting intent={flow.intent} text={flow.text} link={flow.link} qr={qr} next={flow.next} />
    </div>
  );
}
