import type { GiftCardCategory, GiftCardRedemptionChannel } from '../generated/prisma/client.js';

export const giftCardCategories = [
  'online_marketplaces', 'travel', 'food_groceries', 'restaurants_delivery', 'gaming',
  'gasoline_automotive', 'transportation', 'electronics', 'fashion', 'privacy_tools', 'ai',
  'department_stores', 'multi_brand', 'entertainment', 'music_streaming', 'home_diy',
  'health_beauty', 'sports_outdoors', 'gifts_experiences', 'kids', 'crypto_payments',
  'app_stores_mobile', 'books_learning',
] as const satisfies readonly GiftCardCategory[];

export const giftCardCategoryLabels: Record<GiftCardCategory, string> = {
  online_marketplaces: 'Online Marketplaces', travel: 'Travel', food_groceries: 'Food & Groceries',
  restaurants_delivery: 'Restaurants & Delivery', gaming: 'Gaming', gasoline_automotive: 'Gasoline & Automotive',
  transportation: 'Transportation', electronics: 'Electronics', fashion: 'Fashion', privacy_tools: 'Privacy & Tools',
  ai: 'AI', department_stores: 'Department Stores', multi_brand: 'Multi-Brand', entertainment: 'Entertainment',
  music_streaming: 'Music & Streaming', home_diy: 'Home & DIY', health_beauty: 'Health & Beauty',
  sports_outdoors: 'Sports & Outdoors', gifts_experiences: 'Gifts & Experiences', kids: 'Kids',
  crypto_payments: 'Crypto & Payments', app_stores_mobile: 'App Stores & Mobile', books_learning: 'Books & Learning',
};

export const giftCardRedemptionChannels = ['online', 'in_store', 'app', 'phone'] as const satisfies readonly GiftCardRedemptionChannel[];
export const giftCardRedemptionChannelLabels: Record<GiftCardRedemptionChannel, string> = {
  online: 'Redeemable online', in_store: 'Redeemable in store', app: 'Redeemable in an app', phone: 'Redeemable by phone',
};

const rules: Array<[GiftCardCategory, RegExp]> = [
  ['ai', /\b(ai|chatgpt|openai|claude|anthropic|perplexity|midjourney)\b/i],
  ['gaming', /\b(gaming|game|playstation|psn|xbox|nintendo|steam|roblox|riot|valorant|fortnite|razer|pubg)\b/i],
  ['app_stores_mobile', /\b(app store|google play|itunes|appgallery|mobile)\b/i],
  ['music_streaming', /\b(spotify|music|deezer|pandora|tidal)\b/i],
  ['entertainment', /\b(netflix|cinema|movie|disney|youtube|streaming|entertainment|ticketmaster|crunchyroll)\b/i],
  ['restaurants_delivery', /\b(restaurant|starbucks|mcdonald|deliveroo|uber eats|just eat|talabat|doordash|food delivery)\b/i],
  ['food_groceries', /\b(grocery|groceries|supermarket|carrefour|tesco|asda|aldi|lidl)\b/i],
  ['travel', /\b(travel|airbnb|booking\.com|hotel|airline|flight|expedia)\b/i],
  ['gasoline_automotive', /\b(gasoline|petrol|fuel|shell|chevron|exxon|bp|totalenergies|automotive)\b/i],
  ['transportation', /\b(transport|uber|lyft|bolt|trainline|taxi|transit)\b/i],
  ['health_beauty', /\b(health|beauty|sephora|boots|ulta|spa|cosmetic)\b/i],
  ['sports_outdoors', /\b(sport|outdoor|nike|adidas|decathlon|puma|under armour)\b/i],
  ['fashion', /\b(fashion|clothing|apparel|zalando|asos|h&m|zara|nordstrom)\b/i],
  ['home_diy', /\b(home|diy|ikea|wayfair|furniture|hardware|lowe'?s|home depot)\b/i],
  ['electronics', /\b(electronic|apple|samsung|best buy|currys|huawei)\b/i],
  ['privacy_tools', /\b(privacy|vpn|antivirus|nordvpn|expressvpn|mcafee|software|tool)\b/i],
  ['crypto_payments', /\b(crypto|bitcoin|binance|coinbase|paypal|paysafe|visa|mastercard)\b/i],
  ['books_learning', /\b(book|audible|kindle|learning|education|course)\b/i],
  ['kids', /\b(kids?|children|toy|lego|baby)\b/i],
  ['department_stores', /\b(department store|walmart|target|macy'?s|john lewis)\b/i],
  ['multi_brand', /\b(multi[ -]?brand|one4all|love2shop)\b/i],
  ['online_marketplaces', /\b(amazon|ebay|etsy|marketplace|shopee|aliexpress)\b/i],
  ['gifts_experiences', /\b(gift|experience|groupon)\b/i],
];

export function inferGiftCardClassification(input: { name: string; brand: string; description?: string; redeemInstructions?: string; country: string }) {
  const text = [input.name, input.brand, input.description, input.redeemInstructions].filter(Boolean).join(' ');
  const categories = rules.filter(([, rule]) => rule.test(text)).map(([category]) => category);
  const instructions = input.redeemInstructions ?? '';
  const channels: GiftCardRedemptionChannel[] = [];
  if (/\b(online|website|web site|webpage)\b/i.test(instructions)) channels.push('online');
  if (/\b(app|application)\b/i.test(instructions)) channels.push('app');
  if (/\b(in[ -]?store|store|shop|retail location)\b/i.test(instructions)) channels.push('in_store');
  if (/\b(phone|telephone|call)\b/i.test(instructions)) channels.push('phone');
  const uniqueCategories = [...new Set(categories)];
  return {
    giftCardPrimaryCategory: uniqueCategories[0] ?? null,
    giftCardCategories: uniqueCategories,
    giftCardRedemptionChannels: [...new Set(channels)],
    giftCardCountries: input.country === 'WW' ? [] : [input.country],
    giftCardRedemptionScope: input.country === 'WW' ? 'global' as const : 'single_country' as const,
    giftCardClassificationStatus: uniqueCategories.length && channels.length ? 'inferred' as const : 'needs_review' as const,
    giftCardClassifiedAt: new Date(),
  };
}

/** Exact category names/codes and common shopper words can be used in the normal catalogue search box. */
export function giftCardCategorySearch(query: string): GiftCardCategory | null {
  const term = query.trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const aliases: Partial<Record<string, GiftCardCategory>> = {
    fuel: 'gasoline_automotive', petrol: 'gasoline_automotive', groceries: 'food_groceries', food: 'food_groceries',
    restaurants: 'restaurants_delivery', delivery: 'restaurants_delivery', games: 'gaming', transport: 'transportation',
    beauty: 'health_beauty', sports: 'sports_outdoors', gifts: 'gifts_experiences', crypto: 'crypto_payments',
    streaming: 'entertainment', marketplaces: 'online_marketplaces', books: 'books_learning', apps: 'app_stores_mobile',
  };
  return giftCardCategories.find(category => category === term || giftCardCategoryLabels[category].toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') === term) ?? aliases[term] ?? null;
}

export function giftCardFacets(rows: readonly { giftCardCategories: string[]; giftCardRedemptionChannels: string[] }[]) {
  const categoryCounts = new Map<GiftCardCategory, number>();
  const channelCounts = new Map<GiftCardRedemptionChannel, number>();
  for (const row of rows) {
    for (const category of row.giftCardCategories) if (giftCardCategories.includes(category as GiftCardCategory)) categoryCounts.set(category as GiftCardCategory, (categoryCounts.get(category as GiftCardCategory) ?? 0) + 1);
    for (const channel of row.giftCardRedemptionChannels) if (giftCardRedemptionChannels.includes(channel as GiftCardRedemptionChannel)) channelCounts.set(channel as GiftCardRedemptionChannel, (channelCounts.get(channel as GiftCardRedemptionChannel) ?? 0) + 1);
  }
  return {
    object: 'gift_card_facets' as const,
    categories: giftCardCategories.map(code => ({ code, name: giftCardCategoryLabels[code], products: categoryCounts.get(code) ?? 0 })),
    redemption_channels: giftCardRedemptionChannels.map(code => ({ code, name: giftCardRedemptionChannelLabels[code], products: channelCounts.get(code) ?? 0 })),
    unclassified: rows.filter(row => row.giftCardCategories.length === 0).length,
  };
}
