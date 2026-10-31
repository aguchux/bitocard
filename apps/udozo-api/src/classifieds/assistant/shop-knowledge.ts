import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { priceText } from '../rules.js';

/** BitoCard's sections of a shop assistant's knowledge for one country, in document order. */
export const shopKnowledgeKeys = ['shop', 'categories', 'posting', 'safe_pay', 'safe_trade', 'prohibited', 'badges', 'contact'] as const;
export type ShopKnowledgeKey = (typeof shopKnowledgeKeys)[number];
export const shopKnowledgeTitles: Record<ShopKnowledgeKey, string> = {
  shop: 'Udozo',
  categories: 'Categories and what to fill in',
  posting: 'Posting rules and limits',
  safe_pay: 'Safe pay',
  safe_trade: 'Safe Trade Guide',
  prohibited: 'Prohibited items',
  badges: 'Seller badges',
  contact: 'Reporting and help',
};

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32);
const marker = (key: string) => new RegExp(`<!-- bitocard:${key} -->\\n?([\\s\\S]*?)\\n?<!-- /bitocard:${key} -->`);

/** Each BitoCard section's text in a country document. */
export function shopSections(content: string): Partial<Record<ShopKnowledgeKey, string>> {
  const found: Partial<Record<ShopKnowledgeKey, string>> = {};
  for (const key of shopKnowledgeKeys) {
    const match = marker(key).exec(content);
    if (match) found[key] = match[1].trim();
  }
  return found;
}

/** The checks for every trade a buyer pays for themselves, as on the Safe Trade Guide page. */
export const safeTradeGuide = [
  { title: 'Before you meet', items: ['Keep the chat on Udozo', "Check the seller's badges", 'The price is close to similar listings', 'Agree the place, time and how you will pay', 'Tell someone where you are going'] },
  { title: 'At the meeting', items: ['A busy public place, in daylight', 'Inspect and test it with the checks for its category', 'Check papers and serial numbers', 'Pay only when you are happy; confirm a transfer in your own banking app'] },
  { title: 'If you are selling', items: ['Hand over only when the money shows in your own account', 'Never trust an SMS alert or a screenshot', 'Refuse overpayments; check cash notes'] },
];
export const redFlags = 'A price far below others, pressure to decide now, a deposit or "delivery fee" first, payment screenshots instead of money, overpaying and asking for change, moving the chat to another app, or asking for any code.';

const bpsText = (bps: number) => `${(bps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;

export type ShopKnowledgeData = Awaited<ReturnType<ShopKnowledgeService['gather']>>;

/**
 * A shop assistant's knowledge for one country, generated from what BitoCard holds (no AI, so every fact is exact): the
 * Shop, its categories and their suggested features and checks, the posting rules, Safe pay with the market's own fees
 * and deadlines, the Safe Trade Guide, prohibited items, badges and help. Wholly BitoCard's: regenerated whenever the
 * market's settings change. The admin's own sections live in the assistant's shared document.
 */
@Injectable()
export class ShopKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async gather(country: string) {
    const [market, settings, safePay, categories, safePayOn] = await Promise.all([
      this.prisma.country.findUnique({ where: { code: country }, select: { name: true, currency: true } }),
      this.prisma.classifiedMarketSettings.findUnique({ where: { country } }),
      this.prisma.classifiedSafePaySettings.findUnique({ where: { country } }),
      this.prisma.classifiedCategory.findMany({
        where: { enabled: true, parentId: null, countries: { some: { country, enabled: true } } },
        orderBy: { position: 'asc' },
        include: {
          children: { where: { enabled: true, countries: { some: { country, enabled: true } } }, orderBy: { position: 'asc' }, select: { name: true, safetyChecklist: true } },
          features: { orderBy: { position: 'asc' }, take: 8, include: { feature: { select: { name: true, enabled: true } } } },
        },
      }),
      this.settings.isOnForCountry('classifieds_safe_pay', country).catch(() => false),
    ]);
    const fees = safePay && safePay.buyerFeeBps !== null && safePay.buyerFeeCapMinor !== null && safePay.sellerFeeBps !== null && safePay.sellerFeeCapMinor !== null ? safePay : null;
    const currency = market?.currency ?? 'NGN';
    return {
      country,
      name: market?.name ?? country,
      currency,
      listingDays: settings?.listingDays ?? 30,
      monthlyLimit: settings?.monthlyListingLimit ?? 10,
      firstReviewed: settings?.firstListingsReviewed ?? 3,
      minPhotos: settings?.minPhotos ?? 4,
      maxPhotos: settings?.maxPhotos ?? 12,
      safePay: safePayOn && fees
        ? {
            buyer: `${bpsText(fees.buyerFeeBps!)} of the price, at most ${priceText(fees.buyerFeeCapMinor!, currency)}`,
            seller: `${bpsText(fees.sellerFeeBps!)} of the price, at most ${priceText(fees.sellerFeeCapMinor!, currency)}`,
            acceptHours: fees.acceptHours,
            payHours: fees.payHours,
            handoverDays: fees.handoverDays,
            confirmDays: fees.confirmDays,
          }
        : null,
      categories: categories.map(category => ({
        name: category.name,
        b2b: category.b2b,
        children: category.children.map(child => child.name),
        features: category.features.filter(link => link.feature.enabled).map(link => link.feature.name),
        checks: category.safetyChecklist,
      })),
    };
  }

  hash(data: ShopKnowledgeData) {
    return sha(JSON.stringify(data));
  }

  private sections(data: ShopKnowledgeData): Record<ShopKnowledgeKey, string> {
    const sp = data.safePay;
    return {
      shop: [
        `# ${shopKnowledgeTitles.shop}`,
        `- Udozo in ${data.name}: udozo.com/${data.country.toLowerCase()}. People buy and sell near them: phones, cars, property, electronics and more.`,
        `- Prices are in ${data.currency}. Every account can buy and sell; sellers post from their account on udozo.com (Sell).`,
        '- Buyers chat with sellers on Udozo, make offers, and can pay with Safe pay where it is open.',
      ].join('\n'),
      categories: [
        `# ${shopKnowledgeTitles.categories}`,
        ...(data.categories.length
          ? data.categories.map(category => `## ${category.name}${category.b2b ? ' (business)' : ''}\n${category.children.length ? `- Includes: ${category.children.join(', ')}.\n` : ''}${category.features.length ? `- Sellers fill in: ${category.features.join(', ')}.` : '- No suggested features.'}`)
          : ['No categories are open yet.']),
      ].join('\n\n'),
      posting: [
        `# ${shopKnowledgeTitles.posting}`,
        `- A listing needs a title (5 to 90 characters), a category, a price (or "on request"), its area, ${data.minPhotos} to ${data.maxPhotos} photos and, optionally, a video of up to 60 seconds.`,
        '- Titles and descriptions cannot contain links, web addresses, phone numbers to take buyers elsewhere, or HTML.',
        `- A listing stays up ${data.listingDays} days and can be renewed. Each seller can post ${data.monthlyLimit} listings a month.`,
        `- A new seller's first ${data.firstReviewed} listings are checked by a moderator before they go live; so are listings that look doubtful.`,
        '- Sellers mark a listing sold, renew it or delete it from My listings.',
      ].join('\n'),
      safe_pay: sp
        ? [
            `# ${shopKnowledgeTitles.safe_pay}`,
            '- The buyer asks to buy with Safe pay at the listed price or an accepted offer; the seller accepts; the buyer pays from their Udozo wallet and Udozo holds the money.',
            `- Fees: the buyer pays ${sp.buyer} on top; the seller pays ${sp.seller} out of what they are paid. The total is shown before paying.`,
            `- Deadlines: the seller accepts within ${sp.acceptHours} hours, the buyer pays within ${sp.payHours} hours, the hand-over happens within ${sp.handoverDays} days, and a delivery is confirmed within ${sp.confirmDays} days (then it is released by itself).`,
            '- At a meet-up the buyer gives the seller their release code only once they have inspected the item; the seller enters it and is paid. For a delivery the buyer confirms it arrived.',
            '- Never share the release code before inspecting, and never anywhere but face to face. Udozo never asks for it.',
            '- If the seller cancels or does not hand over in time, the buyer is refunded in full, fee included. Not as described, or it never came: the buyer opens a dispute and Udozo decides (a refund, part refund or release).',
            '- Sellers need an identity check and a payout bank account in their verified name before their first Safe pay sale; what they are paid can be withdrawn after the payout hold.',
          ].join('\n')
        : `# ${shopKnowledgeTitles.safe_pay}\n- Safe pay is not open in ${data.name} yet: buyers and sellers arrange payment themselves. Follow the Safe Trade Guide.`,
      safe_trade: [
        `# ${shopKnowledgeTitles.safe_trade}`,
        ...safeTradeGuide.map(group => `## ${group.title}\n${group.items.map(item => `- ${item}`).join('\n')}`),
        `## Red flags\n${redFlags}`,
        ...data.categories.filter(category => category.checks.length).map(category => `## Checks for ${category.name}\n${category.checks.map(item => `- ${item}`).join('\n')}`),
      ].join('\n\n'),
      prohibited: [
        `# ${shopKnowledgeTitles.prohibited}`,
        '- Not allowed: weapons and ammunition, drugs and prescription medicines, stolen goods, counterfeits and replicas, animals protected by law, human remains or organs, adult content, documents and IDs, financial schemes and anything illegal in the country.',
        '- Listings that mention them are refused or removed; repeated attempts suspend the seller.',
      ].join('\n'),
      badges: [
        `# ${shopKnowledgeTitles.badges}`,
        '- Phone confirmed: the seller confirmed a mobile number with a code.',
        '- ID checked: Udozo checked the seller’s identity document.',
        '- Badges say what was checked, not that a seller or item is trustworthy: still inspect before paying.',
      ].join('\n'),
      contact: [
        `# ${shopKnowledgeTitles.contact}`,
        '- Report a listing or a chat from its menu; enough reports send it back to a moderator.',
        '- A Safe pay order’s problems go through its dispute, from the order.',
        '- Anything else: Talk to a person opens a chat with Udozo’s support.',
      ].join('\n'),
    };
  }

  /** The country document: every section, wrapped in its markers. */
  render(data: ShopKnowledgeData) {
    const sections = this.sections(data);
    return shopKnowledgeKeys.map(key => `<!-- bitocard:${key} -->\n${sections[key]}\n<!-- /bitocard:${key} -->`).join('\n\n');
  }

  /** The shared document's starting point: the admin's own sections, for every country the assistant serves. */
  sharedTemplate(name: string) {
    return [
      `# About ${name}`,
      `(Who ${name} is and how it should come across, in two or three sentences. Udozo's sections for each country are added by themselves.)`,
      '# FAQs',
      '(Questions people ask most, each as "## Question" followed by the answer.)',
      '# Things the assistant must not do',
      '- Promise that an item is genuine or a price fair\n- Ask for release codes, passwords or one-time codes',
    ].join('\n\n');
  }
}
