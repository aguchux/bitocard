/**
 * Udozo's help: the header's Get help menu, the Contact us form's choices and channels, and the FAQs. Claims stay true:
 * listing is free, Safe pay's fee is shown before anyone accepts an order, and nothing here promises a time or a
 * channel Udozo does not run.
 */

export type HelpIcon = "help" | "shield" | "package" | "questions" | "store" | "pickup" | "mail";
/** A place in the menu: `href` null is not open yet (shown, marked Soon, not a link). */
export type HelpLink = { label: string; href: string | null; icon: HelpIcon; hint: string };

export const helpLinks: HelpLink[] = [
  { label: "Help Centre", href: null, icon: "help", hint: "Guides to buying and selling" },
  { label: "Safe pay", href: "/safe-trade#safe-pay", icon: "shield", hint: "Pay safely: held until you have it" },
  { label: "Track orders", href: null, icon: "package", hint: "Where your order is" },
  { label: "FAQs", href: "/help/faqs", icon: "questions", hint: "Quick answers" },
  { label: "Resell on Udozo", href: "/start-here", icon: "store", hint: "Sell, or open a store" },
  { label: "Pickup centres", href: null, icon: "pickup", hint: "Collect near you" },
  { label: "Contact us", href: "/help/contact", icon: "mail", hint: "Write to our team" },
];

/** What a Contact us message is about (the API's `contactKinds`, in the form's words). */
export const contactKinds = [
  { value: "order", label: "An order" },
  { value: "safe_pay", label: "Safe pay" },
  { value: "account", label: "My account" },
  { value: "selling", label: "Selling" },
  { value: "reselling", label: "Reselling on Seller HQ" },
  { value: "report", label: "Reporting a person or listing" },
  { value: "partnership", label: "Partnerships and press" },
  { value: "other", label: "Something else" },
] as const;
export type ContactKind = (typeof contactKinds)[number]["value"];
export const isContactKind = (value: unknown): value is ContactKind => contactKinds.some(kind => kind.value === value);

/** How to reach Udozo besides the form. Only channels Udozo runs: add WhatsApp, phone or social accounts here once they exist. */
export const supportEmail = "support@udozo.com";

export type Faq = { q: string; a: string };
export type FaqGroup = { id: string; title: string; faqs: Faq[] };

export const faqGroups: FaqGroup[] = [
  {
    id: "buying",
    title: "Buying",
    faqs: [
      { q: "How do I buy something on Udozo?", a: "Find it by searching or browsing a category, then chat with the seller, call them in the browser, or ask them to call you back. Where the seller offers it, Buy with Safe pay holds your money until you have the item." },
      { q: "Can I see the item before I pay?", a: "Yes. Meet the seller in a busy public place, check the item, and only then pay. Never pay in advance for something you have not seen, unless you pay with Safe pay." },
      { q: "How do I call a seller without sharing my number?", a: "Press Call seller on the listing while the seller is on Udozo. The call goes through Udozo, so neither of you sees the other's number, and it is not recorded. You can also ask the seller to call you back, or ask for their contact details, which they choose to share." },
      { q: "Can I make an offer?", a: "Yes. Open the chat on the listing and make an offer. The seller can accept, decline or reply, and an accepted offer can be paid with Safe pay at that price." },
    ],
  },
  {
    id: "safe-pay",
    title: "Safe pay",
    faqs: [
      { q: "What is Safe pay?", a: "Safe pay holds your payment until you have the item. You pay from your Udozo wallet, the seller hands it over or sends it, and the money goes to the seller only once you confirm, or the time to raise a problem has passed." },
      { q: "Does Safe pay cost anything?", a: "A small fee, shown before you ask for a Safe pay order and before the seller accepts one. The fee depends on your country." },
      { q: "What if something goes wrong?", a: "Open a dispute from the order before you confirm you received it. Udozo looks at what both of you send and decides whether the money goes back to you or to the seller." },
      { q: "Should I give my release code to the seller?", a: "Only when you meet, once you have checked the item and are happy with it. The code releases your money to the seller. Udozo never asks for it." },
    ],
  },
  {
    id: "selling",
    title: "Selling",
    faqs: [
      { q: "Does it cost anything to sell?", a: "No. Signing up and listing are free. Safe pay orders carry a small fee, shown before you accept one." },
      { q: "How do I post an ad?", a: "Press Sell, add clear photos, a title, the price and the category, then where you are. Your ad goes live once it passes our checks; a first ad may be reviewed by our team." },
      { q: "How do buyers reach me?", a: "By chat, and by calls in the browser, call backs and contact requests, unless you choose chat only on the ad. Your number is never shown on the page: you decide who gets it." },
      { q: "How do I get paid with Safe pay?", a: "Once the buyer has the item, the money is released to your Udozo earnings, and you withdraw it to your own bank account." },
    ],
  },
  {
    id: "reselling",
    title: "Reselling on Udozo",
    faqs: [
      { q: "What is reselling on Udozo?", a: "On Seller HQ you open a store, choose listings that suppliers open to resellers, and set your own price within their limits. The supplier delivers to your buyer and you earn the difference, less Udozo's fee. You never hold stock." },
      { q: "Do I need a registered business?", a: "Not to sell your own things. To open a store on Seller HQ, your business passes a quick check first; if you are unregistered, your own identity check is enough." },
    ],
  },
  {
    id: "account",
    title: "Your account and safety",
    faqs: [
      { q: "Why do I need to confirm my mobile number?", a: "It keeps Udozo safer: every account confirms its email and mobile, so buyers and sellers know they are dealing with a real person." },
      { q: "I forgot my password. What do I do?", a: "On the sign-in page, choose Forgot password. We email you a code to set a new one." },
      { q: "How do I report a person or a listing?", a: "Use Report this listing on the listing, or Report in the chat. Our team reviews every report. You can also block someone in the chat." },
      { q: "Will Udozo ever ask for my password or a code?", a: "Never. Udozo will not ask for your password, a code we texted or emailed you, or a Safe pay release code. Anyone who does is not Udozo." },
    ],
  },
];
