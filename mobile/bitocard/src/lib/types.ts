/** What BitoCard's API answers, as the app reads it (`apps/api`'s presenters). Only the fields the app uses. */

export type Customer = {
  object: 'customer';
  id: string;
  email: string;
  name: string;
  email_verified: boolean;
  phone: string | null;
  phone_verified: boolean;
  /** Fixed at sign-up: the wallet, checkouts and prices are in its currency. Null for older accounts until chosen. */
  country: string | null;
  currency: string | null;
  created_at: string;
};

/** Sign-in and sign-up answer the account and a session the app keeps in the secure store. */
export type SessionReply = { customer: Customer; session: { token: string; expires_at: string } };

export type Market = { code: string; name: string; currency: string };

export type PaymentMethod = { object: 'payment_method'; id: string; label: string; description: string; networks: string[] };

export type ReservedAccount = { object: 'reserved_account'; id: string; currency: string; bank_name: string; account_number: string; account_name: string };

export type Wallet = {
  object: 'customer_wallet';
  mode: 'live' | 'test';
  country: string;
  currency: string;
  /** Wallets are on: purchases are paid only from the wallet. */
  enabled: boolean;
  balance: number;
  top_up_methods: PaymentMethod[];
  reserved_accounts: ReservedAccount[];
  reserved_accounts_available: boolean;
  /** Nigeria: the bank needs the BVN to open an account number (passed on, never kept). */
  reserved_account_needs_bvn: boolean;
  wallets: { currency: string; primary: boolean; balance: number; removable: boolean }[];
};

export type WalletTransaction = {
  object: 'wallet_transaction';
  id: string;
  type: string;
  description: string;
  /** Positive: money in; negative: money out. */
  amount: number;
  currency: string;
  checkout_id: string | null;
  top_up_id: string | null;
  created_at: string;
};

export type TopUp = {
  object: 'customer_top_up';
  id: string;
  mode: 'live' | 'test';
  status: 'pending' | 'succeeded' | 'failed';
  amount: number;
  currency: string;
  method: { id: string; label: string };
  checkout_url: string | null;
  failure_reason: string | null;
};

export type Conversion = {
  object: 'wallet_conversion';
  id: string | null;
  from: { amount: number; currency: string };
  to: { amount: number; currency: string };
  rate: string;
};

export type BankDepositOptions = {
  object: 'bank_deposit_options';
  currency: string;
  available: boolean;
  accounts: { id: string; bank_name: string; account_name: string; account_number: string; details: string | null }[];
  min_amount: number;
  window_hours: number;
};

export type BankDeposit = {
  object: 'bank_deposit';
  id: string;
  number: string;
  mode: 'live' | 'test';
  status: 'awaiting_payment' | 'sent' | 'credited' | 'rejected' | 'cancelled' | 'expired';
  currency: string;
  amount: number;
  credited_amount: number | null;
  reference: string;
  account: { bank_name: string; account_name: string; account_number: string; details: string | null };
  decision_note: string | null;
  expires_at: string;
};

export type StoreBrand = { slug: string; name: string; logo_url: string | null; color: string | null; initials: string };

export type StoreProduct = {
  object: 'store_product';
  id: string;
  key: string;
  name: string;
  category: string;
  country: string;
  face_currency: string;
  denomination_type: 'fixed' | 'range';
  from: number;
  to: number;
  logo_url: string | null;
  brand: StoreBrand;
};

export type StoreProductDetail = StoreProduct & {
  /** Fixed face values, or the range a customer may enter (minor units of `face_currency`). */
  denominations: number[] | null;
  range: { min: number; max: number } | null;
  recipient_type: string | null;
};

export type NetworkDetection = { object: 'network_detection'; detected: boolean; brand?: string; product: StoreProduct | null };

export type CheckoutPreview = {
  object: 'checkout_preview';
  quote_id: string;
  amount: number;
  currency: string;
  tax: { name: string; amount: number } | null;
  expires_at: string;
  wallet_balance: number;
  wallet_options: { currency: string; amount: number; balance: number; enough: boolean }[];
};

export type CheckoutStatus = 'awaiting_payment' | 'paid' | 'completed' | 'failed' | 'refund_pending' | 'refunded';

export type Checkout = {
  object: 'checkout';
  id: string;
  mode: 'live' | 'test';
  status: CheckoutStatus;
  product: { id: string; key: string; name: string; category: string; brand: string };
  face_value: number;
  face_currency: string;
  quantity: number;
  amount: number;
  currency: string;
  charged: { amount: number; currency: string } | null;
  method: { id: string; label: string };
  /** The gateway's payment page while it waits to be paid (never for wallet payments). */
  checkout_url: string | null;
  recipient: { phone?: string; email?: string; account_number?: string } | null;
  order: { id: string; status: string; receipt_number: string | null; completed_at: string | null } | null;
  failure_reason: string | null;
  refunded_at: string | null;
  created_at: string;
};

export type Page<T> = { object: 'list'; data: T[]; has_more: boolean };

export type AccountSummary = {
  object: 'customer_summary';
  orders_total: { amount: number; currency: string }[];
  orders: { total: number; in_progress: number };
  delivered_this_month: number;
};

/** A gift card's rate at checkout: per unit of the card's currency (minor units of `currency`), and each value's price. */
export type StoreRate = { object: 'store_rate'; currency: string; face_currency: string; rate: number; values: { face_value: number; price: number }[] } | { object: 'store_rate'; rate: null };

/** What a delivered order holds: a gift card's code and PIN, a licence key, a token. Shown only on its own order. */
export type Delivery = { kind: string; code: string | null; pin: string | null; serial: string | null; details: Record<string, unknown> };

export type CheckoutWithCodes = Checkout & {
  order: (NonNullable<Checkout['order']> & { deliveries?: Delivery[]; redeem_instructions?: string | null }) | null;
};

export type SellOffer = { id: string; name: string; form: 'physical' | 'ecode' | 'both' | string; minimum: number; maximum: number; currency: string; rate: number; terms: string | null };

export type SellOptions = { object: 'gift_card_sell_options'; available: boolean; reason: string | null; currency: string | null; offers: SellOffer[] };

export type SaleQuote = { object: 'gift_card_sale_quote'; offer_id: string; amount: number; currency: string; payout: number };

export type GiftCardSale = {
  object: 'gift_card_sale';
  id: string;
  number: string;
  mode: 'live' | 'test';
  status: 'pending' | 'completed' | 'rejected' | 'failed';
  card: { name: string; brand: string | null; brand_slug: string | null; country: string | null };
  form: 'physical' | 'ecode';
  /** Whole units of the card's value. */
  amount: number;
  currency: string;
  quoted: number;
  paid: number | null;
  code_hint: string | null;
  reason: string | null;
  created_at: string;
};

/** The customer's confirmed mobile numbers (up to `limit`), the default first; `unconfirmed` is a number still waiting for its code. */
export type CustomerPhones = { object: 'list'; data: { object: 'customer_phone'; phone: string; default: boolean; verified_at: string }[]; limit: number; default: string | null; unconfirmed: string | null };

export type AirtimeNetwork = {
  object: 'airtime_network';
  network: string;
  name: string;
  /** Traded now: the exchange open there and a collector line on the network. */
  open: boolean;
  /** What sellers get and buyers pay, in basis points of the airtime's value. */
  sell_rate_bps: number;
  buy_rate_bps: number;
  min_amount: number;
  max_amount: number;
  available: number;
  bought_total: number;
  sold_total: number;
  bought_24h: number;
  sold_24h: number;
};

export type AirtimePool = {
  object: 'airtime_pool';
  country: string;
  currency: string | null;
  mode: 'live' | 'test';
  open: boolean;
  networks: AirtimeNetwork[];
  totals: { available: number; bought_total: number; sold_total: number; bought_24h: number; sold_24h: number };
  updated_at: string | null;
};

export type AirtimeSeller = {
  object: 'airtime_seller';
  completed_sales: number;
  strikes: number;
  strike_limit: number;
  paused: boolean;
  strikes_expire_at: string | null;
  sold_today: number;
  networks: { network: string; new_seller: boolean; established_after: number; daily_limit: number; seller_daily: number }[];
};

export type AirtimeSaleQuote = { object: 'airtime_sale_quote'; network: string; amount: number; currency: string; rate_bps: number; payout: number; from_phone: string };

export type AirtimeSale = {
  object: 'airtime_sale';
  id: string;
  number: string;
  mode: 'live' | 'test';
  network: string;
  amount: number;
  currency: string;
  rate_bps: number;
  payout: number;
  from_phone: string;
  status: 'awaiting_transfer' | 'sent' | 'received' | 'credited' | 'expired' | 'cancelled' | 'not_received' | 'reversed';
  /** Where to send the airtime, and how (the network's transfer code filled in), while the seller still has to. */
  collector_number: string | null;
  transfer_steps: string | null;
  expires_at: string;
  sent_at: string | null;
  received_at: string | null;
  credit_at: string | null;
  credited_at: string | null;
  note: string | null;
  created_at: string;
};

export type AirtimePurchaseQuote = { object: 'airtime_purchase_quote'; network: string; amount: number; currency: string; rate_bps: number; price: number; phone: string; available: number };

export type AirtimePurchase = {
  object: 'airtime_purchase';
  id: string;
  number: string;
  mode: 'live' | 'test';
  network: string;
  phone: string;
  amount: number;
  currency: string;
  rate_bps: number;
  price: number;
  status: 'paid' | 'delivering' | 'delivered' | 'refunded';
  expires_at: string;
  delivered_at: string | null;
  refunded_at: string | null;
  note: string | null;
  created_at: string;
};

/** A notice in the customer's inbox. `link` is a bitocard.com path (`src/lib/links.ts` opens it in the app). */
export type Notice = {
  object: 'notification';
  id: string;
  type: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  body: string;
  link: string | null;
  mode: 'live' | 'test' | null;
  read: boolean;
  read_at: string | null;
  created_at: string;
};

export type NoticePage = { object: 'list'; data: Notice[]; has_more: boolean; unread_count: number };

export type NoticePreference = { object: 'notification_preference'; type: string; label: string; severity: string; push: boolean; default: boolean; locked: boolean };

/** Whether push can reach this customer: browsers (VAPID) and, for the app, phones by platform. */
export type PushSettings = { enabled: boolean; phones?: { android: boolean; ios: boolean } };

/** `GET /v1/app/config`: whether this version must or may be updated, and where. */
export type AppConfig = {
  object: 'app_config';
  platform: 'ios' | 'android';
  version: string;
  update: 'none' | 'available' | 'required';
  min_version: string | null;
  latest_version: string | null;
  store_url: string | null;
  site_url: string;
  legal: { terms: string; privacy: string };
};

export type ChatAttachment = { id: string; name: string; content_type: 'image/jpeg' | 'image/png' | 'application/pdf'; size: number; width: number | null; height: number | null };
export type ChatMessage = { id: string; author: 'customer' | 'reseller' | 'bitocard' | 'bot' | 'system'; author_name: string | null; author_avatar_url: string | null; body: string; attachments: ChatAttachment[]; created_at: string };

/** The customer's live chat with BitoCard: an assistant (`bot`), waiting for a person, a person answering, or closed. */
export type SupportChat = { object: 'support_chat'; id: string; status: 'bot' | 'waiting' | 'with_staff' | 'closed'; ticket_reference: string | null; created_at: string; closed_at: string | null; messages: ChatMessage[] };

export type SupportChatCurrent = { object: 'support_chat_current'; chat: SupportChat | null; assistant: { name: string; avatar_url: string | null; greeting: string | null } | null };

export type ChatSince = { object: 'list'; status: SupportChat['status']; data: ChatMessage[] };

export type TicketCategory = 'order' | 'payment' | 'account' | 'product' | 'technical' | 'other';

/** A question to BitoCard: `open` waits for BitoCard, `pending` for the customer. */
export type SupportTicket = {
  object: 'support_ticket';
  id: string;
  reference: string;
  status: 'open' | 'pending' | 'resolved';
  category: TicketCategory;
  subject: string;
  checkout_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  messages?: { id: string; author: ChatMessage['author']; author_name: string | null; author_avatar_url: string | null; visibility: 'all'; body: string; created_at: string }[];
};

export type SpinAllowance = { won_usd: string; spins_used: number; today_left: number; daily_limit: number; next_spin_at: string | null; finished: boolean };

/** `GET /v1/store/spins`: the wheel, whether the customer can spin (and why not), their allowance and latest wins. */
export type SpinRewards = {
  object: 'spin_rewards';
  mode: 'live' | 'test';
  enabled: boolean;
  reason: 'not_enabled' | 'email_not_verified' | 'claimed_elsewhere' | null;
  segments: { index: number; usd: string }[];
  daily_limit: number;
  allowance: SpinAllowance | null;
  recent: { id: string; number: number; usd: string; segment: number; created_at: string }[];
  rewards: { usd: string; exchange_currencies: string[] };
};

export type Spin = { object: 'spin'; id: string; number: number; segment: number; usd: string; allowance: SpinAllowance };
export type SpinExchangePreview = { object: 'spin_exchange_preview'; usd: string; currency: string; amount: number; rate: string };
export type SpinExchange = { object: 'spin_exchange'; id: string; usd: string; currency: string; amount: number; rate: string; created_at: string };

export type StoreSearch = { object: 'store_search'; query: string; products: StoreProduct[] };

export type VerificationStatus = {
  object: 'customer_verification_status';
  country: string;
  provider: 'bitocard' | 'didit';
  verified: boolean;
  latest: { status: string; url: string | null; reason: string | null } | null;
};
