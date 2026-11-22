/**
 * The emails BitoCard's team sends a reseller from the reseller's page in the admin app: quick emails nudging them
 * through onboarding (each suggested while it applies), a few about growing their business, and a custom one.
 * Every one is written to the reseller's owner, links into SHQ, and never carries codes or anyone else's details.
 */

/** What the reseller's account looks like now, to say which quick emails apply. */
export type ResellerEmailState = {
  status: 'pending' | 'active' | 'suspended';
  verified: boolean;
  identityWaived: boolean;
  emailConfirmed: boolean;
  mobileConfirmed: boolean;
  stores: number;
  publishedStores: number;
  listedProducts: number;
  liveApiKeys: number;
  /** The reseller’s market, and whether admins gave it a WhatsApp group link. */
  market: string | null;
  whatsappGroup: boolean;
};

export type QuickEmailKind = 'onboarding' | 'growth';

export type QuickEmail = {
  key: string;
  kind: QuickEmailKind;
  label: string;
  /** What it asks of the reseller, shown in the admin app before sending. */
  description: string;
  subject: string;
  heading: string;
  paragraphs: (input: { firstName: string; business: string }) => string[];
  /** The SHQ page it sends them to. */
  path: string;
  /** Links to the reseller market’s WhatsApp group instead of SHQ: only sendable where admins set one. */
  whatsappGroup?: true;
  linkLabel: string;
  /** Why it is suggested now, or null when it does not apply (it can still be sent). */
  suggested: (state: ResellerEmailState) => string | null;
};

export const quickEmails: QuickEmail[] = [
  {
    key: 'welcome',
    kind: 'onboarding',
    label: 'Welcome',
    description: 'Says hello, what BitoCard SHQ does and the steps to their first sale.',
    subject: 'Welcome to BitoCard',
    heading: 'Welcome to BitoCard',
    paragraphs: ({ firstName, business }) => [
      `Hi ${firstName},`,
      `Thank you for creating ${business} on BitoCard. You can sell gift cards, airtime, data and bills under your own brand and your own prices, from your own store or through our API.`,
      'Your first steps: confirm your identity, set up your store, choose what to sell, then fund your wallet. Store setup takes minutes; the identity check and funding can take a little longer.',
      'Reply to this email if you need a hand. We are happy to help.',
    ],
    path: '/',
    linkLabel: 'Open BitoCard SHQ',
    suggested: state => (state.stores === 0 && !state.verified ? 'New account: nothing set up yet.' : null),
  },
  {
    key: 'start_kyc',
    kind: 'onboarding',
    label: 'Start KYC',
    description: 'Asks the owner to complete the identity check, which they need before going live.',
    subject: 'Complete your identity check to go live',
    heading: 'Complete your identity check',
    paragraphs: ({ firstName }) => [
      `Hi ${firstName},`,
      'Before your account can take live orders, top up its wallet or withdraw earnings, we need to confirm who you are. It takes about five minutes: a photo of your ID, a selfie and two short movements.',
      'If you started the check and got stuck, you can start it again from the same page.',
    ],
    path: '/settings/verification',
    linkLabel: 'Start your identity check',
    suggested: state => (!state.verified && !state.identityWaived ? 'The identity check is not done.' : null),
  },
  {
    key: 'verify_email',
    kind: 'onboarding',
    label: 'Confirm email',
    description: 'Asks the owner to confirm their email address with the code SHQ sends.',
    subject: 'Confirm your email address',
    heading: 'Confirm your email address',
    paragraphs: ({ firstName }) => [
      `Hi ${firstName},`,
      'Your email address is not confirmed yet. Sign in to BitoCard SHQ and ask for a new code to confirm it: we need it to send you order updates, receipts and security notices.',
    ],
    path: '/',
    linkLabel: 'Sign in and confirm',
    suggested: state => (!state.emailConfirmed ? 'The owner’s email is not confirmed.' : null),
  },
  {
    key: 'verify_mobile',
    kind: 'onboarding',
    label: 'Verify mobile',
    description: 'Asks the owner to add and confirm a mobile number, for sign-in and two-step codes.',
    subject: 'Add and confirm your mobile number',
    heading: 'Confirm your mobile number',
    paragraphs: ({ firstName }) => [
      `Hi ${firstName},`,
      'Add your mobile number in BitoCard SHQ and confirm it with the code we text you. You can then sign in with it, receive sign-in codes by text, and we can reach you quickly about your orders.',
    ],
    path: '/settings/profile',
    linkLabel: 'Confirm your mobile',
    suggested: state => (!state.mobileConfirmed ? 'No confirmed mobile number.' : null),
  },
  {
    key: 'setup_store',
    kind: 'onboarding',
    label: 'Set up your store',
    description: 'Invites them to create their store: a design, a name and a bitocard.com address.',
    subject: 'Set up your store in a few minutes',
    heading: 'Set up your store',
    paragraphs: ({ firstName, business }) => [
      `Hi ${firstName},`,
      `${business} does not have a store yet. Choose what it sells, pick a design and colours, and give it a name and its own bitocard.com address. It takes a few minutes, and you can change everything later.`,
    ],
    path: '/store/new',
    linkLabel: 'Create your store',
    suggested: state => (state.stores === 0 ? 'No store yet.' : null),
  },
  {
    key: 'list_products',
    kind: 'onboarding',
    label: 'Add products',
    description: 'Asks them to choose the products their store sells and set their prices.',
    subject: 'Choose what your store sells',
    heading: 'Add products to your store',
    paragraphs: ({ firstName }) => [
      `Hi ${firstName},`,
      'Your store has nothing on sale yet. Open your catalogue, list the gift cards, airtime, data and bills you want to sell, and set your prices. You see your profit on every sale before you list it.',
    ],
    path: '/catalogue',
    linkLabel: 'Open your catalogue',
    suggested: state => (state.stores > 0 && state.listedProducts === 0 ? 'A store with nothing listed.' : null),
  },
  {
    key: 'publish_store',
    kind: 'onboarding',
    label: 'Publish your store',
    description: 'Asks them to publish their draft store so customers can find it.',
    subject: 'Your store is ready to publish',
    heading: 'Publish your store',
    paragraphs: ({ firstName }) => [
      `Hi ${firstName},`,
      'Your store is still a draft, so customers cannot see it yet. Check its design and products, then publish it from the store page. You can keep changing it after it is live.',
    ],
    path: '/store',
    linkLabel: 'Publish your store',
    suggested: state => (state.stores > 0 && state.publishedStores === 0 ? 'Store still a draft.' : null),
  },
  {
    key: 'fund_wallet',
    kind: 'onboarding',
    label: 'Fund your wallet',
    description: 'Explains that orders are paid from a funded wallet and how to top it up.',
    subject: 'Fund your wallet to start taking orders',
    heading: 'Fund your wallet',
    paragraphs: ({ firstName }) => [
      `Hi ${firstName},`,
      'Every order is paid for from your BitoCard wallet before it is delivered, so your customers get their codes at once. Top it up by card, bank transfer or mobile money from your wallet page. Your profit from each sale comes back to your wallet.',
    ],
    path: '/wallet',
    linkLabel: 'Top up your wallet',
    suggested: state => (state.status === 'active' && state.publishedStores > 0 ? 'Live store: make sure the wallet is funded.' : null),
  },
  {
    key: 'try_api',
    kind: 'growth',
    label: 'Use the API',
    description: 'For resellers with their own website or app: the API, sandbox keys and the docs.',
    subject: 'Sell from your own website or app with the BitoCard API',
    heading: 'Sell from your own website or app',
    paragraphs: ({ firstName }) => [
      `Hi ${firstName},`,
      'Already have a website, app or point of sale? Connect it to BitoCard with our API: the catalogue, prices, orders and delivery, with signed webhooks. Start with sandbox keys, which never touch real money, then switch to live keys when you are ready.',
      'The documentation is at https://docs.bitocard.com.',
    ],
    path: '/developers',
    linkLabel: 'Create your API keys',
    suggested: state => (state.status === 'active' && state.liveApiKeys === 0 ? 'Live, but no live API keys.' : null),
  },

  {
    key: 'join_whatsapp',
    kind: 'growth',
    label: 'Join WhatsApp group',
    description: 'Invites them to BitoCard’s WhatsApp group for resellers in their market: tips, product news and help from our team.',
    subject: 'Join BitoCard’s WhatsApp group for resellers',
    heading: 'Join our WhatsApp group',
    paragraphs: ({ firstName }) => [
      `Hi ${firstName},`,
      'We run a WhatsApp group for BitoCard resellers in your country, where our team shares tips, new products and price news, and answers questions. Join it with the button below.',
      'Please keep it friendly and never share codes, passwords or your customers’ details in the group. Our team will never ask for them.',
    ],
    path: '/',
    linkLabel: 'Join the WhatsApp group',
    whatsappGroup: true,
    suggested: state => (state.whatsappGroup && state.status !== 'suspended' ? 'Their market has a WhatsApp group.' : null),
  },
  {
    key: 'need_help',
    kind: 'growth',
    label: 'Need help?',
    description: 'A friendly check-in offering help, for a reseller who has gone quiet.',
    subject: 'Can we help you get started?',
    heading: 'Can we help?',
    paragraphs: ({ firstName, business }) => [
      `Hi ${firstName},`,
      `We noticed ${business} has not finished setting up on BitoCard. If anything is in the way, from the identity check to choosing products or prices, reply to this email or chat with us from BitoCard SHQ and we will help.`,
    ],
    path: '/support',
    linkLabel: 'Get help',
    suggested: () => null,
  },
];

export const quickEmailKeys = quickEmails.map(email => email.key);
export const customEmailKey = 'custom';

/** A custom email's body: paragraphs split on blank lines, trimmed, empty ones dropped. */
export function paragraphsOf(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean);
}
