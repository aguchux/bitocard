/**
 * Where a visit to udozo.com came from, worked out from what the landing request carries: an ad network's click id
 * (`fbclid`, `gclid`…), a campaign's `utm_*` tags, else the page that linked here (its host only). Only these derived
 * words are ever kept, never the address, the click id itself or anything about the visitor.
 */

/** How people arrived: an ad they clicked, a social network, a search engine, a messaging app, an email, another site, a tagged campaign, or typed or bookmarked. */
export const trafficChannels = ['paid', 'social', 'search', 'messaging', 'email', 'referral', 'campaign', 'direct'] as const;
export type TrafficChannel = (typeof trafficChannels)[number];

/** What a landing page is, never its address: so the report says which kinds of page people arrive on. */
export const landingKinds = ['home', 'market', 'listing', 'category', 'search', 'place', 'seller', 'brand', 'start_here', 'invite', 'signup', 'sell', 'help', 'other'] as const;
export type LandingKind = (typeof landingKinds)[number];

export type Source = { channel: TrafficChannel; source: string; medium: string; campaign: string };

/** Ad networks' click ids, added to the landing address when someone clicks an ad (or, for `fbclid`, any link out of Facebook). */
const clickIds: Array<{ param: string; source: string; paid: boolean }> = [
  { param: 'gclid', source: 'google', paid: true },
  { param: 'gbraid', source: 'google', paid: true },
  { param: 'wbraid', source: 'google', paid: true },
  { param: 'gad_source', source: 'google', paid: true },
  { param: 'dclid', source: 'google', paid: true },
  { param: 'msclkid', source: 'bing', paid: true },
  { param: 'ttclid', source: 'tiktok', paid: true },
  { param: 'twclid', source: 'x', paid: true },
  { param: 'li_fat_id', source: 'linkedin', paid: true },
  { param: 'sccid', source: 'snapchat', paid: true },
  { param: 'epik', source: 'pinterest', paid: true },
  { param: 'yclid', source: 'yandex', paid: true },
  // Facebook adds fbclid to every link people follow out of Facebook and Instagram, ads or not: only a paid medium makes it an ad.
  { param: 'fbclid', source: 'facebook', paid: false },
  { param: 'igshid', source: 'instagram', paid: false },
];

/** Search engines by host (any of their country domains). */
const searchEngines: Array<[RegExp, string]> = [
  [/(^|\.)google\.[a-z.]+$/, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)search\.yahoo\.[a-z.]+$|(^|\.)yahoo\.[a-z.]+$/, 'yahoo'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
  [/(^|\.)yandex\.[a-z.]+$|(^|\.)ya\.ru$/, 'yandex'],
  [/(^|\.)baidu\.com$/, 'baidu'],
  [/(^|\.)ecosia\.org$/, 'ecosia'],
  [/(^|\.)search\.brave\.com$/, 'brave'],
  [/(^|\.)startpage\.com$/, 'startpage'],
  [/(^|\.)qwant\.com$/, 'qwant'],
  [/(^|\.)ask\.com$/, 'ask'],
  [/(^|\.)aol\.com$/, 'aol'],
  [/(^|\.)naver\.com$/, 'naver'],
  [/(^|\.)perplexity\.ai$/, 'perplexity'],
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, 'chatgpt'],
];

/** Social networks by host (link shims like l.facebook.com and t.co included). */
const socialHosts: Array<[RegExp, string]> = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$/, 'facebook'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, 'x'],
  [/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/, 'linkedin'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'youtube'],
  [/(^|\.)pinterest\.[a-z.]+$|(^|\.)pin\.it$/, 'pinterest'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)snapchat\.com$/, 'snapchat'],
  [/(^|\.)threads\.net$/, 'threads'],
  [/(^|\.)nairaland\.com$/, 'nairaland'],
];

/** Messaging apps by host. */
const messagingHosts: Array<[RegExp, string]> = [
  [/(^|\.)whatsapp\.com$|(^|\.)wa\.me$|(^|\.)l\.wl\.co$/, 'whatsapp'],
  [/(^|\.)t\.me$|(^|\.)telegram\.(org|me)$/, 'telegram'],
  [/(^|\.)messenger\.com$/, 'messenger'],
];

/** Webmail by host. */
const emailHosts: Array<[RegExp, string]> = [
  [/(^|\.)mail\.google\.com$/, 'gmail'],
  [/(^|\.)outlook\.(live|office|office365)\.com$/, 'outlook'],
  [/(^|\.)mail\.yahoo\.com$/, 'yahoo_mail'],
];

/** Android apps that open links (`android-app://<package>` referrers). */
const androidApps: Record<string, Source> = {
  'com.google.android.gm': { channel: 'email', source: 'gmail', medium: '', campaign: '' },
  'com.google.android.googlequicksearchbox': { channel: 'search', source: 'google', medium: '', campaign: '' },
  'com.facebook.katana': { channel: 'social', source: 'facebook', medium: '', campaign: '' },
  'com.facebook.orca': { channel: 'messaging', source: 'messenger', medium: '', campaign: '' },
  'com.instagram.android': { channel: 'social', source: 'instagram', medium: '', campaign: '' },
  'com.whatsapp': { channel: 'messaging', source: 'whatsapp', medium: '', campaign: '' },
  'org.telegram.messenger': { channel: 'messaging', source: 'telegram', medium: '', campaign: '' },
  'com.twitter.android': { channel: 'social', source: 'x', medium: '', campaign: '' },
  'com.zhiliaoapp.musically': { channel: 'social', source: 'tiktok', medium: '', campaign: '' },
  'com.linkedin.android': { channel: 'social', source: 'linkedin', medium: '', campaign: '' },
};

/** What people write in `utm_source` for the same place, as one name. */
const sourceAliases: Record<string, string> = {
  fb: 'facebook',
  'facebook.com': 'facebook',
  meta: 'facebook',
  ig: 'instagram',
  'instagram.com': 'instagram',
  twitter: 'x',
  'x.com': 'x',
  'google.com': 'google',
  adwords: 'google',
  googleads: 'google',
  'bing.com': 'bing',
  microsoft: 'bing',
  wa: 'whatsapp',
  'whatsapp.com': 'whatsapp',
  tg: 'telegram',
  yt: 'youtube',
};

const paidMediums = /^(cpc|ppc|cpm|cpv|paid|paid[_-]?social|paidsocial|paid[_-]?search|ads?|display|banner|sponsored|retargeting|remarketing)$/;
const socialMediums = /^(social|social[_-]?media|organic[_-]?social|sm|post|story|reel)$/;
const emailMediums = /^(e-?mail|newsletter|mailchimp)$/;
const messagingMediums = /^(sms|whatsapp|telegram|messenger|chat|broadcast)$/;
const referralMediums = /^(referral|affiliate|partner|influencer)$/;
const searchSources = new Set(searchEngines.map(([, name]) => name));
const socialSources = new Set(socialHosts.map(([, name]) => name));
const messagingSources = new Set(messagingHosts.map(([, name]) => name));

/**
 * A campaign's word cleaned to what may be kept: lower case, letters, digits, `.`, `_` and `-` only, at most 60
 * characters; anything holding a phone number, an email or a long code is dropped, as tags sometimes carry them.
 */
export function cleanTag(value: string | null | undefined, max = 60): string {
  if (!value) return '';
  const raw = value.trim().toLowerCase();
  if (raw.includes('@') || /\d{7,}/.test(raw.replace(/[\s()+-]/g, '')) || /[a-z0-9]{32,}/.test(raw)) return '';
  return raw
    .replace(/[\s+]+/g, '_')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/_{2,}/g, '_')
    .slice(0, max);
}

const firstMatch = (host: string, list: Array<[RegExp, string]>) => list.find(([pattern]) => pattern.test(host))?.[1] ?? null;

/** A host as the report names it: lower case, without `www.` or `m.`, at most 60 characters. */
export function hostName(host: string) {
  return host.toLowerCase().replace(/^(www\d?|m|mobile|l|lm)\./, '').slice(0, 60);
}

function fromHost(host: string): Source {
  const search = firstMatch(host, searchEngines);
  if (search) return { channel: 'search', source: search, medium: '', campaign: '' };
  const social = firstMatch(host, socialHosts);
  if (social) return { channel: 'social', source: social, medium: '', campaign: '' };
  const messaging = firstMatch(host, messagingHosts);
  if (messaging) return { channel: 'messaging', source: messaging, medium: '', campaign: '' };
  const email = firstMatch(host, emailHosts);
  if (email) return { channel: 'email', source: email, medium: '', campaign: '' };
  return { channel: 'referral', source: hostName(host), medium: '', campaign: '' };
}

const channelOfMedium = (medium: string, source: string): TrafficChannel => {
  if (paidMediums.test(medium)) return 'paid';
  if (socialMediums.test(medium)) return 'social';
  if (emailMediums.test(medium)) return 'email';
  if (messagingMediums.test(medium)) return 'messaging';
  if (referralMediums.test(medium)) return 'referral';
  if (medium === 'organic' && searchSources.has(source)) return 'search';
  if (!medium) {
    if (searchSources.has(source)) return 'search';
    if (socialSources.has(source)) return 'social';
    if (messagingSources.has(source)) return 'messaging';
  }
  return 'campaign';
};

/** The referrer's host when it is another site (never udozo.com itself or one of its stores), else null. */
export function referrerHost(referrer: string | null | undefined, ownHosts: string[]): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol === 'android-app:') return `android-app:${url.hostname.toLowerCase()}`;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    if (ownHosts.some(own => host === own || host.endsWith(`.${own}`))) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * Where a visit came from: a click id first (with `utm_medium` deciding whether a Facebook click was an ad), then the
 * `utm_*` tags, then the linking page's host, else direct. `params` are the landing address's query parameters.
 */
export function classify(params: Record<string, string | undefined>, referrer: string | null, ownHosts: string[]): Source {
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) if (typeof value === 'string') lower[key.toLowerCase()] = value;
  const utmSource = cleanTag(lower.utm_source);
  const medium = cleanTag(lower.utm_medium, 40);
  const campaign = cleanTag(lower.utm_campaign, 80);
  const named = utmSource ? (sourceAliases[utmSource] ?? utmSource) : '';

  const click = clickIds.find(item => lower[item.param]);
  if (click) {
    const source = named || click.source;
    const channel: TrafficChannel = click.paid || paidMediums.test(medium) ? 'paid' : source === 'instagram' || source === 'facebook' ? 'social' : channelOfMedium(medium, source);
    return { channel, source, medium, campaign };
  }
  if (named) return { channel: channelOfMedium(medium, named), source: named, medium, campaign };

  const host = referrerHost(referrer, ownHosts);
  if (host?.startsWith('android-app:')) return androidApps[host.slice('android-app:'.length)] ?? { channel: 'referral', source: cleanTag(host.slice('android-app:'.length)) || 'android_app', medium: '', campaign: '' };
  if (host) return { ...fromHost(host), campaign };
  return { channel: 'direct', source: 'direct', medium: '', campaign };
}

/** The kind of page a visit landed on, from its path (`/ng/l/123-tv` is a listing); the path itself is never kept. */
export function landingOf(path: string): { kind: LandingKind; country: string | null } {
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  if (clean === '/') return { kind: 'home', country: null };
  const parts = clean.split('/').filter(Boolean);
  const market = /^[a-z]{2}$/.test(parts[0]!) ? parts[0]!.toUpperCase() : null;
  if (market) {
    const second = parts[1];
    if (!second) return { kind: 'market', country: market };
    if (second === 'l') return { kind: 'listing', country: market };
    if (second === 'c') return { kind: 'category', country: market };
    if (second === 'search') return { kind: 'search', country: market };
    if (second === 'seller') return { kind: 'seller', country: market };
    if (second === 'brand') return { kind: 'brand', country: market };
    if (second === 'areas' || second === 'wanted') return { kind: 'other', country: market };
    return { kind: 'place', country: market };
  }
  const first = parts[0]!;
  if (first === 'start-here') return { kind: 'start_here', country: null };
  if (first === 'i') return { kind: 'invite', country: null };
  if (first === 'signup' || first === 'signin') return { kind: 'signup', country: null };
  if (first === 'sell') return { kind: 'sell', country: null };
  if (first === 'help' || first === 'safe-trade') return { kind: 'help', country: null };
  if (first === 'c') return { kind: 'category', country: null };
  return { kind: 'other', country: null };
}
