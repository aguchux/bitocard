/**
 * The Start here page (`/start-here`), where Udozo's marketers and ads send people to sign up and start selling. Its
 * sign-up links carry the visitor's referral and campaign tags (`ref`, `utm_*`) on to sign-up, so a campaign can be
 * told apart there; nothing is stored here and no cookie is set.
 */

/** Seller HQ, for sellers who open their own store. */
export const sellerHqUrl = (process.env.NEXT_PUBLIC_SHQ_URL ?? "https://shq.udozo.com").replace(/\/$/, "");

/** The tags a campaign link may carry, kept as they came (short, plain characters only). */
const campaignTags = ["ref", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

/** The referral and campaign tags of the visit, cleaned: anything long or with odd characters is left out. */
export function campaignOf(params: Record<string, string | string[] | undefined>) {
  const kept: [string, string][] = [];
  for (const tag of campaignTags) {
    const raw = params[tag];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value && /^[\w.~-]{1,64}$/.test(value)) kept.push([tag, value]);
  }
  return kept;
}

/** Where the page's buttons go: a Udozo account then posting a listing, or Seller HQ's sign-up for a store. */
export function startLinks(campaign: [string, string][]) {
  const sell = new URLSearchParams([["next", "/sell"], ...campaign]);
  const store = new URLSearchParams(campaign);
  return {
    sell: `/signup?${sell.toString()}`,
    store: `${sellerHqUrl}/signup${store.size ? `?${store.toString()}` : ""}`,
    signIn: "/signin?next=/sell",
  };
}

export const steps = [
  { title: "Sign up in two minutes", body: "Your email and mobile, each confirmed with a code. One account works on udozo.com and every Udozo store." },
  { title: "Post your first listing", body: "A few photos, a title and your price. Listing is free, and buyers near you see it first." },
  { title: "Sell and get paid", body: "Chat with buyers on Udozo. With Safe pay the buyer's money is held until they have the item, then it is yours to withdraw to your bank." },
];

export const reasons = [
  { icon: "badge-percent", title: "Free to list", body: "Post listings at no cost. Safe pay has a small fee, always shown before you accept an order." },
  { icon: "shield-check", title: "Paid safely", body: "No fake transfer alerts or screenshots: with Safe pay the money is in Udozo's hands before you hand anything over." },
  { icon: "map-pin", title: "Buyers near you", body: "Listings show to people in your area first, then nearby, then the rest of the country." },
  { icon: "messages-square", title: "Chat in one place", body: "Questions, offers and photos stay in Udozo's chat, so you never share more than you want to." },
  { icon: "badge-check", title: "Trust that sells", body: "Confirmed sellers earn badges buyers look for, and good sales build your standing." },
  { icon: "store", title: "Grow into a store", body: "Ready for more? Open your own store on Seller HQ, with your own domain and every feature, free." },
];

export const faqs = [
  { q: "Does it cost anything to start?", a: "No. Signing up and listing are free. Safe pay orders carry a small fee, shown before you accept one, and Seller HQ has no setup fee or monthly plan." },
  { q: "How do I get paid?", a: "With Safe pay, the buyer pays into Udozo first. Once they have the item, the money is released to your Udozo earnings, and you withdraw it to your own bank account. You can also agree to be paid directly when you meet." },
  { q: "What can I sell?", a: "Phones, electronics, vehicles, property, fashion, home and living, and much more. Some things are never allowed, such as weapons, drugs, counterfeits and stolen goods: the terms list them." },
  { q: "Do I need a business?", a: "Not to sell your own things. To open a store on Seller HQ and resell suppliers' listings, your business passes a quick check first; if you are unregistered, your own identity check is enough." },
  { q: "What is reselling on Udozo?", a: "On Seller HQ you choose listings that suppliers open to resellers, set your own price within their limits, and sell them on your store. The supplier delivers to your buyer; you earn the difference, less Udozo's fee. You never hold stock." },
];
