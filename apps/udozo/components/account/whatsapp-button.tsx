import { continueWithWhatsapp } from "@/lib/whatsapp-sign-in-actions";
import { WhatsappMark, whatsappGreen } from "../whatsapp-mark";

/**
 * "Continue with WhatsApp", beside Google's and Facebook's: signing in from the WhatsApp an account uses (they say yes
 * there), or signing up there step by step (names and email, its code typed on WhatsApp; the number becomes the
 * account's confirmed mobile). `ref` is a campaign's or invite's code, kept on an account made through it.
 */
export function WhatsappButton({ intent, next, refCode = null, className = "" }: { intent: "signin" | "signup"; next: string; refCode?: string | null; className?: string }) {
  return (
    <form action={continueWithWhatsapp} className={className}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="next" value={next} />
      {refCode ? <input type="hidden" name="ref" value={refCode} /> : null}
      <button type="submit" className="inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-navy-200 bg-white px-5 font-bold text-navy-900 hover:border-navy-300 hover:bg-navy-50">
        <WhatsappMark color={whatsappGreen} />
        {intent === "signup" ? "Sign up with WhatsApp" : "Continue with WhatsApp"}
      </button>
    </form>
  );
}
