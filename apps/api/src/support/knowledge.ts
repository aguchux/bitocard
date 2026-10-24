import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { formatMoney } from '../notifications/templates.js';
import { SettingsService } from '../settings/settings.service.js';
import { categoryLabels } from '../storefront/layout.js';

/** The longest knowledge document: the whole of it goes into the assistant's instructions (cached by the provider). */
export const maxKnowledgeChars = 60_000;

/** BitoCard's sections, in document order: regenerated from the store's data by Update knowledge base. */
export const managedKeys = ['store', 'catalogue', 'buying', 'delivery', 'refunds', 'accounts'] as const;
export type ManagedKey = (typeof managedKeys)[number];
export const managedTitles: Record<ManagedKey, string> = {
  store: 'The store',
  catalogue: 'What we sell',
  buying: 'Buying and paying',
  delivery: 'Delivery',
  refunds: 'Refunds and problems',
  accounts: 'Accounts and verification',
};

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32);
const marker = (key: string) => new RegExp(`<!-- bitocard:${key} -->\\n?([\\s\\S]*?)\\n?<!-- /bitocard:${key} -->`);

/** The text of each BitoCard section found in a document. */
export function managedSections(content: string): Partial<Record<ManagedKey, string>> {
  const found: Partial<Record<ManagedKey, string>> = {};
  for (const key of managedKeys) {
    const match = marker(key).exec(content);
    if (match) found[key] = match[1].trim();
  }
  return found;
}

export const sectionHashes = (content: string) => Object.fromEntries(Object.entries(managedSections(content)).map(([key, text]) => [key, sha(text ?? '')])) as Partial<Record<ManagedKey, string>>;

/** Replaces the chosen BitoCard sections of `current` with `fresh`'s; a section `current` lacks is added at the end. */
export function mergeSections(current: string, fresh: string, keys: readonly ManagedKey[]) {
  const sections = managedSections(fresh);
  let merged = current;
  for (const key of keys) {
    const text = sections[key];
    if (text === undefined) continue;
    const block = `<!-- bitocard:${key} -->\n${text}\n<!-- /bitocard:${key} -->`;
    merged = marker(key).test(merged) ? merged.replace(marker(key), () => block) : `${merged.trimEnd()}\n\n${block}\n`;
  }
  return merged;
}

/** A CSV of FAQs (`question,answer,category`, with a header row) as a Markdown FAQs section. Quoted fields allowed. */
export function csvToMarkdown(csv: string) {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const text = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = (rows.shift() ?? []).map(cell => cell.trim().toLowerCase());
  const q = header.indexOf('question');
  const a = header.indexOf('answer');
  const c = header.indexOf('category');
  if (q < 0 || a < 0) return null;
  const groups = new Map<string, Array<{ question: string; answer: string }>>();
  for (const cells of rows) {
    const question = cells[q]?.trim();
    const answer = cells[a]?.trim();
    if (!question || !answer) continue;
    const group = (c >= 0 ? cells[c]?.trim() : '') || 'General';
    groups.set(group, [...(groups.get(group) ?? []), { question, answer }]);
  }
  if (!groups.size) return null;
  const parts = ['# FAQs'];
  for (const [group, items] of groups) {
    if (groups.size > 1) parts.push(`\n## ${group}`);
    for (const item of items) parts.push(`\n### ${item.question}\n${item.answer}`);
  }
  return parts.join('\n');
}

/** The downloadable sample templates. */
export const knowledgeTemplate = {
  md: `---
store: Example Store
country: NG
currency: NGN
languages: [en]
support_hours: Mon–Sat 08:00–20:00 WAT
contact: support@example.com
---

# About the store
Who we are, what we sell and who we serve, in two or three sentences.

# What we sell
- Airtime and data for MTN, Airtel, Glo and 9mobile
- Electricity tokens for every distribution company
- Gift cards: Amazon, Apple, Steam

# Buying and paying
How prices are shown, the payment methods, the store wallet and top-ups.

# Delivery
How each product arrives (codes on the order page, tokens, eSIM install steps) and typical times.

# Refunds and problems
What can be refunded and when, and how to report a problem with an order.

# Accounts and verification
Signing in, when an identity check is asked, and keeping codes safe.

# FAQs
## How long does airtime take?
Usually seconds. If it has not arrived after 10 minutes, open the order page.

## Can I cancel an order?
Orders are delivered at once, so most cannot be cancelled. Report a problem from the order if something is wrong.

# Things the assistant must not do
- Promise refunds or delivery times
- Ask for codes, PINs or passwords
`,
  csv: `question,answer,category
How long does airtime take?,"Usually seconds. If it has not arrived after 10 minutes, open the order page.",Delivery
Can I cancel an order?,"Orders are delivered at once, so most cannot be cancelled. Report a problem from the order if something is wrong.",Orders
Which payment methods do you take?,"Card and bank transfer, or your store wallet.",Payments
`,
};

const deliveryText: Record<string, string> = {
  gift_cards: 'Gift cards: the code (and PIN) is on the order page, hidden until Reveal, and emailed. Redeem it as the brand explains.',
  airtime: 'Airtime: sent straight to the mobile number given, usually within seconds.',
  data: 'Data bundles: sent straight to the mobile number given, usually within seconds.',
  bills: 'Electricity and bills: paid to the meter or account number checked before paying; electricity tokens are on the order page.',
  pay_tv: 'Pay-TV: the subscription is paid to the smartcard or IUC number checked before paying; it shows on the decoder within minutes.',
  esim: 'eSIMs: installed from the order page (a QR code, or Install on iPhone or Android), shown after Show eSIM. An eSIM installs once.',
  software: 'Software: the licence key is on the order page, hidden until Reveal.',
  vpn: 'VPN access: the username and password are on the order page; access lasts 30 days and never renews automatically.',
  rdp: 'RDP: the server sign-in details are on the order page.',
  virtual_numbers: 'Virtual numbers: the number is on the order page; it lasts a month and is renewed from there, or deleted 15 days after it expires.',
  virtual_cards: 'Virtual cards: shown securely on the order page.',
  mobile_money: 'Mobile money: sent to the mobile money wallet of the number given.',
};

const refundText: Record<string, string> = {
  gift_cards: 'Gift cards: a code that was revealed cannot be refunded; a code that does not work is investigated (report a problem from the order).',
  software: 'Software: a revealed licence key cannot be refunded; a key that does not activate is replaced or refunded after checking.',
  esim: 'eSIMs: refunded only while never installed.',
  vpn: 'VPN access: a full refund within 14 days while the sign-in details were never shown; afterwards only if it cannot be made to work.',
};

const gatewayLabels: Record<string, string> = { stripe: 'card', flutterwave: 'card, bank transfer or mobile money', monnify: 'bank transfer or card', pawapay: 'mobile money', paystack: 'card, bank transfer or USSD' };

export type StoreKnowledgeData = Awaited<ReturnType<StoreKnowledgeService['gather']>>;

/**
 * Generates a store's knowledge document from what BitoCard holds, filling the template without AI so every fact is
 * exact. BitoCard's sections are wrapped in markers so Update knowledge base can refresh them later; the owner's
 * sections (about, FAQs, contact, rules) are placeholders to fill and are never touched again.
 */
@Injectable()
export class StoreKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** The store data the document is made from (and its fingerprint). */
  async gather(storeId: string) {
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: storeId }, include: { reseller: true } });
    const house = store.reseller.house;
    const countryCode = store.reseller.country;
    const country = countryCode ? await this.prisma.country.findUnique({ where: { code: countryCode }, include: { categories: true } }) : null;
    const products = await this.prisma.product.findMany({
      where: { active: true, ...(house ? { listed: true } : { listings: { some: { resellerId: store.resellerId } } }) },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      take: 500,
      select: { name: true, category: true, brand: true, faceCurrency: true, fixedValues: true, minValueMinor: true, maxValueMinor: true },
    });
    const domains = await this.prisma.storeDomain.findMany({ where: { storeId, status: 'active' }, select: { name: true } });
    const gateways = country ? await this.prisma.paymentMethod.findMany({ where: { countryCode: country.code, purpose: 'checkout', enabled: true }, orderBy: { position: 'asc' }, select: { gateway: true } }) : [];
    const wallets = await this.settings.isOn('customer_wallets', store.resellerId).catch(() => true);
    const categories = [...new Set(products.map(product => product.category))];
    const checked = country ? country.categories.filter(item => item.customerVerification && categories.includes(item.category)).map(item => item.category) : [];
    return {
      name: store.name,
      address: house ? 'bitocard.com' : `${store.subdomain}.bitocard.com`,
      domains: domains.map(item => item.name).sort(),
      country: country?.name ?? null,
      currency: country?.currency ?? null,
      products: products.slice(0, 150).map(product => ({
        name: product.name,
        category: product.category as string,
        brand: product.brand,
        range: product.fixedValues.length
          ? product.fixedValues.length === 1
            ? formatMoney(product.fixedValues[0], product.faceCurrency)
            : `${formatMoney(product.fixedValues[0], product.faceCurrency)} to ${formatMoney(product.fixedValues.at(-1)!, product.faceCurrency)}`
          : product.minValueMinor !== null && product.maxValueMinor !== null
            ? `${formatMoney(product.minValueMinor, product.faceCurrency)} to ${formatMoney(product.maxValueMinor, product.faceCurrency)}`
            : null,
      })),
      productCount: products.length,
      categories,
      payments: gateways.map(item => gatewayLabels[item.gateway] ?? item.gateway),
      wallets,
      checked: store.customerVerification ? checked : [],
    };
  }

  hash(data: StoreKnowledgeData) {
    return sha(JSON.stringify(data));
  }

  /** The whole document: BitoCard's sections from the data, and placeholders for the owner's own. */
  render(data: StoreKnowledgeData) {
    const managed = this.sections(data);
    const block = (key: ManagedKey) => `<!-- bitocard:${key} -->\n${managed[key]}\n<!-- /bitocard:${key} -->`;
    return [
      `---\nstore: ${data.name}\ncountry: ${data.country ?? ''}\ncurrency: ${data.currency ?? ''}\nsupport_hours: (add your hours)\ncontact: (add your support email or phone)\n---`,
      `# About the store\n(Who you are and who you serve, in two or three sentences. BitoCard never changes this section.)`,
      block('store'),
      block('catalogue'),
      block('buying'),
      block('delivery'),
      block('refunds'),
      block('accounts'),
      `# FAQs\n(Add the questions your customers ask most, each as "## Question" followed by the answer.)`,
      `# Things the assistant must not do\n- Promise refunds, credits or delivery times\n- Ask for codes, PINs or passwords`,
    ].join('\n\n');
  }

  private sections(data: StoreKnowledgeData): Record<ManagedKey, string> {
    const byCategory = new Map<string, StoreKnowledgeData['products']>();
    for (const product of data.products) byCategory.set(product.category, [...(byCategory.get(product.category) ?? []), product]);
    const label = (category: string) => categoryLabels[category as keyof typeof categoryLabels] ?? category;
    const catalogue = data.categories.length
      ? [...byCategory].map(([category, items]) => `## ${label(category)}\n${items.slice(0, 40).map(item => `- ${item.name}${item.range ? ` (${item.range})` : ''}`).join('\n')}`).join('\n\n')
      : 'Nothing is on sale yet.';
    return {
      store: [
        `# ${managedTitles.store}`,
        `- Name: ${data.name}`,
        `- Address: ${[data.address, ...data.domains].join(', ')}`,
        ...(data.country ? [`- Country: ${data.country}${data.currency ? `, prices in ${data.currency}` : ''}`] : []),
        '- Sold and delivered by BitoCard, under this store’s name.',
      ].join('\n'),
      catalogue: `# ${managedTitles.catalogue}\n${data.productCount} products${data.productCount > data.products.length ? ` (the first ${data.products.length} below)` : ''}. Prices are shown at checkout; face values below.\n\n${catalogue}`,
      buying: [
        `# ${managedTitles.buying}`,
        '- Customers sign in to buy. The price is shown before paying.',
        ...(data.wallets ? ['- Purchases are paid from the store wallet, topped up by the customer; the wallet is spent only in this store and never withdrawn.'] : []),
        ...(data.payments.length ? [`- Ways to pay or top up: ${[...new Set(data.payments)].join('; ')}.`] : []),
      ].join('\n'),
      delivery: `# ${managedTitles.delivery}\n${data.categories.map(category => `- ${deliveryText[category] ?? `${label(category)}: delivered on the order page.`}`).join('\n') || '- Delivered on the order page.'}`,
      refunds: [
        `# ${managedTitles.refunds}`,
        '- A failed order is refunded in full, the way it was paid.',
        ...data.categories.filter(category => refundText[category]).map(category => `- ${refundText[category]}`),
        '- For a problem with an order’s money, customers use “Report a problem” on the order page; the store answers first and BitoCard decides refunds.',
      ].join('\n'),
      accounts: [
        `# ${managedTitles.accounts}`,
        '- A customer account belongs to this store only. Email confirmed before buying.',
        data.checked.length ? `- A one-time identity check is asked before buying: ${data.checked.map(label).join(', ')}.` : '- No identity check is asked for this store’s products.',
        '- Never share codes, PINs or passwords: the store will never ask for them.',
      ].join('\n'),
    };
  }
}
