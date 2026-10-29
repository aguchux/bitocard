import { MessageCircle, Phone } from 'lucide-react';
import { cn } from '../format';

/**
 * WhatsApp's click-to-chat address for an E.164 number (`+2348031234567` → `https://wa.me/2348031234567`): it opens
 * the WhatsApp app on phones, and WhatsApp Desktop or WhatsApp Web elsewhere. Null when the number has no digits.
 */
export function whatsappUrl(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : null;
}

/** A phone number to call (a `tel:` link) with a WhatsApp button beside it that opens a chat with the number. */
export function PhoneContact({ phone, className }: { phone: string; className?: string }) {
  const whatsapp = whatsappUrl(phone);
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-2', className)}>
      <a href={`tel:${phone}`} className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline">
        <Phone className="size-3.5" aria-hidden />
        {phone}
      </a>
      {whatsapp ? (
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Chat with ${phone} on WhatsApp (opens WhatsApp)`}
          className="inline-flex min-h-8 items-center gap-1 rounded-full bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
        >
          <MessageCircle className="size-3.5" aria-hidden />
          WhatsApp
        </a>
      ) : null}
    </span>
  );
}
